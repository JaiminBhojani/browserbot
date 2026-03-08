/**
 * Unit tests for MemoryStore.
 *
 * better-sqlite3 is a native addon that requires C++ build tools to compile.
 * Instead of needing the compiled binary, we inject a pure-JS mock DB via the
 * `setDbForTest()` seam exported from memory-db.ts.
 *
 * This tests all of MemoryStore's pure-JS logic (query routing, pruning,
 * context building, disabled-mode guards) without touching the file system
 * or the native SQLite engine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setDbForTest, closeDb } from '../../src/agent/memory/memory-db.js';
import { MemoryStore } from '../../src/agent/memory/memory-store.js';

// ─── MOCK DB ─────────────────────────────────────────────────────────────────

interface Row { [key: string]: unknown }

/**
 * Builds a minimal in-process Database-like object that mirrors the
 * better-sqlite3 API surface used by MemoryStore.
 */
function createMockDb() {
    const tables: { conversations: Row[]; preferences: Row[]; searches: Row[] } = {
        conversations: [],
        preferences: [],
        searches: [],
    };
    let nextId = 1;

    function prepare(sql: string) {
        const s = sql.trim().toLowerCase();

        const run = (...args: unknown[]) => {
            // INSERT INTO conversations
            if (s.includes('insert into conversations')) {
                const [userId, role, content] = args as [string, string, string];
                tables.conversations.push({ id: nextId++, user_id: userId, role, content, created_at: Date.now() });
                return { changes: 1 };
            }
            // DELETE FROM conversations WHERE user_id = ? AND id NOT IN (...)
            if (s.includes('delete from conversations') && s.includes('not in')) {
                const [userId, , limit] = args as [string, string, number];
                const rows = tables.conversations.filter(r => r.user_id === userId);
                const keep = new Set(rows.slice(-limit).map(r => r.id));
                tables.conversations = tables.conversations.filter(
                    r => r.user_id !== userId || keep.has(r.id)
                );
                return { changes: 1 };
            }
            // DELETE FROM conversations (clearHistory)
            if (s.includes('delete from conversations')) {
                const userId = args[0] as string;
                tables.conversations = tables.conversations.filter(r => r.user_id !== userId);
                return { changes: 1 };
            }
            // INSERT INTO preferences (upsert)
            if (s.includes('insert into preferences')) {
                const [userId, key, value] = args as [string, string, string];
                const existing = tables.preferences.find(r => r.user_id === userId && r.pref_key === key);
                if (existing) { existing.pref_value = value; }
                else { tables.preferences.push({ user_id: userId, pref_key: key, pref_value: value }); }
                return { changes: 1 };
            }
            // INSERT INTO searches
            if (s.includes('insert into searches')) {
                const [userId, query, url] = args as [string, string, string | null];
                tables.searches.push({ user_id: userId, query, url: url ?? null });
                return { changes: 1 };
            }
            return { changes: 0 };
        };

        const all = (...args: unknown[]): Row[] => {
            if (s.includes('from conversations')) {
                const [userId, limit] = args as [string, number];
                // Match SQL: ORDER BY created_at DESC LIMIT ?
                // MemoryStore.getHistory() then reverses to get chronological order
                const filtered = tables.conversations.filter(r => r.user_id === userId);
                return filtered.slice(-limit).reverse();
            }
            if (s.includes('select pref_key')) {
                const [userId] = args as [string];
                return tables.preferences.filter(r => r.user_id === userId);
            }
            if (s.includes('from searches')) {
                const [userId, limit] = args as [string, number];
                return [...tables.searches.filter(r => r.user_id === userId)].reverse().slice(0, limit);
            }
            return [];
        };

        const get = (...args: unknown[]): Row | undefined => {
            if (s.includes('select pref_value')) {
                const [userId, key] = args as [string, string];
                return tables.preferences.find(r => r.user_id === userId && r.pref_key === key);
            }
            return undefined;
        };

        return { run, all, get };
    }

    return { prepare, exec: () => { }, pragma: () => { }, close: () => { } } as any;
}

// ─── SETUP ────────────────────────────────────────────────────────────────────

function makeStore(enabled = true): MemoryStore {
    const store = new MemoryStore();
    // Inject mock DB *before* calling init so openDb() is never called
    setDbForTest(createMockDb());
    store.init({ enabled, dbPath: ':memory:', maxHistory: 10 });
    return store;
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

describe('MemoryStore — conversations', () => {
    it('saves a message and retrieves it', () => {
        const store = makeStore();
        store.saveMessage('user1', 'user', 'Hello bot');
        const history = store.getHistory('user1');
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ role: 'user', content: 'Hello bot' });
    });

    it('returns messages in chronological order', () => {
        const store = makeStore();
        store.saveMessage('user1', 'user', 'First');
        store.saveMessage('user1', 'assistant', 'Reply');
        store.saveMessage('user1', 'user', 'Second');
        const history = store.getHistory('user1');
        expect(history.map(m => m.content)).toEqual(['First', 'Reply', 'Second']);
    });

    it('isolates history per user', () => {
        const store = makeStore();
        store.saveMessage('alice', 'user', 'Hi from Alice');
        store.saveMessage('bob', 'user', 'Hi from Bob');
        expect(store.getHistory('alice')).toHaveLength(1);
        expect(store.getHistory('bob')).toHaveLength(1);
        expect(store.getHistory('alice')[0].content).toBe('Hi from Alice');
    });

    it('clearHistory wipes only the target user', () => {
        const store = makeStore();
        store.saveMessage('alice', 'user', 'hi');
        store.saveMessage('bob', 'user', 'hey');
        store.clearHistory('alice');
        expect(store.getHistory('alice')).toHaveLength(0);
        expect(store.getHistory('bob')).toHaveLength(1);
    });
});

describe('MemoryStore — preferences', () => {
    it('saves and retrieves a preference', () => {
        const store = makeStore();
        store.setPreference('user1', 'currency', 'INR');
        expect(store.getPreference('user1', 'currency')).toBe('INR');
    });

    it('returns null for missing preference', () => {
        const store = makeStore();
        expect(store.getPreference('user1', 'language')).toBeNull();
    });

    it('updates an existing preference (upsert)', () => {
        const store = makeStore();
        store.setPreference('user1', 'currency', 'USD');
        store.setPreference('user1', 'currency', 'INR');
        expect(store.getPreference('user1', 'currency')).toBe('INR');
    });

    it('getAllPreferences returns all key/value pairs', () => {
        const store = makeStore();
        store.setPreference('user1', 'currency', 'INR');
        store.setPreference('user1', 'language', 'English');
        const prefs = store.getAllPreferences('user1');
        expect(prefs).toEqual({ currency: 'INR', language: 'English' });
    });

    it('isolates preferences per user', () => {
        const store = makeStore();
        store.setPreference('alice', 'currency', 'INR');
        store.setPreference('bob', 'currency', 'USD');
        expect(store.getPreference('alice', 'currency')).toBe('INR');
        expect(store.getPreference('bob', 'currency')).toBe('USD');
    });
});

describe('MemoryStore — searches', () => {
    it('saves and retrieves recent searches', () => {
        const store = makeStore();
        store.saveSearch('user1', 'amazon.in', 'https://www.amazon.in/');
        const searches = store.getRecentSearches('user1');
        expect(searches).toHaveLength(1);
        expect(searches[0]).toMatchObject({ query: 'amazon.in', url: 'https://www.amazon.in/' });
    });

    it('stores url as null when not provided', () => {
        const store = makeStore();
        store.saveSearch('user1', 'flipkart search');
        const s = store.getRecentSearches('user1', 1);
        expect(s[0].url).toBeNull();
    });

    it('respects limit on getRecentSearches', () => {
        const store = makeStore();
        for (let i = 0; i < 8; i++) store.saveSearch('user1', `site${i}.com`);
        expect(store.getRecentSearches('user1', 3)).toHaveLength(3);
    });
});

describe('MemoryStore — buildContextBlock', () => {
    it('returns null when no preferences or searches exist', () => {
        const store = makeStore();
        expect(store.buildContextBlock('user1')).toBeNull();
    });

    it('includes preferences section when preferences exist', () => {
        const store = makeStore();
        store.setPreference('user1', 'currency', 'INR');
        const block = store.buildContextBlock('user1')!;
        expect(block).toContain('User Preferences');
        expect(block).toContain('currency');
        expect(block).toContain('INR');
    });

    it('includes recent activity when searches exist', () => {
        const store = makeStore();
        store.saveSearch('user1', 'amazon.in', 'https://amazon.in');
        const block = store.buildContextBlock('user1')!;
        expect(block).toContain('Recent Activity');
        expect(block).toContain('amazon.in');
    });
});

describe('MemoryStore — disabled mode', () => {
    it('getHistory returns [] when disabled', () => {
        const store = makeStore(false);
        expect(store.getHistory('user1')).toEqual([]);
    });

    it('saveMessage is a no-op when disabled', () => {
        const store = makeStore(false);
        expect(() => store.saveMessage('user1', 'user', 'hi')).not.toThrow();
    });

    it('getPreference returns null when disabled', () => {
        const store = makeStore(false);
        expect(store.getPreference('user1', 'currency')).toBeNull();
    });

    it('buildContextBlock returns null when disabled', () => {
        const store = makeStore(false);
        expect(store.buildContextBlock('user1')).toBeNull();
    });
});
