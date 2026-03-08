import { openDbSync, getDb, closeDb } from './memory-db.js';
import { logger } from '../../infra/logger.js';
import type { AgentMessage } from '../providers/base.js';

const log = logger.child({ module: 'memory-store' });

export interface MemoryConfig {
    enabled: boolean;
    dbPath: string;
    maxHistory: number;
}

// ─── ROW TYPES ────────────────────────────────────────────────────────────────

interface ConversationRow {
    role: string;
    content: string;
    created_at: number;
}

interface PreferenceRow {
    pref_key: string;
    pref_value: string;
}

interface SearchRow {
    query: string;
    url: string | null;
    created_at: number;
}

// ─── MEMORY STORE ─────────────────────────────────────────────────────────────

export class MemoryStore {
    private enabled = false;
    private maxHistory = 100;

    /** Initialize the store — opens the DB and creates tables if needed. */
    init(config: MemoryConfig): void {
        this.enabled = config.enabled;
        this.maxHistory = config.maxHistory;

        if (!this.enabled) {
            log.info('Memory store disabled — skipping DB init');
            return;
        }

        openDbSync(config.dbPath);
        log.info({ dbPath: config.dbPath, maxHistory: config.maxHistory }, 'Memory store initialized');
    }

    /** Gracefully close the DB (called on shutdown). */
    close(): void {
        closeDb();
    }

    // ─── CONVERSATIONS ───────────────────────────────────────────────────────

    /**
     * Persist a single turn message. Only 'user' and 'assistant' roles are
     * stored — tool call details are intentionally dropped to keep storage lean.
     */
    saveMessage(userId: string, role: 'user' | 'assistant', content: string): void {
        if (!this.enabled) return;
        const db = getDb();

        db.prepare(`
            INSERT INTO conversations (user_id, role, content)
            VALUES (?, ?, ?)
        `).run(userId, role, content);

        // Prune old messages to stay within maxHistory per user
        db.prepare(`
            DELETE FROM conversations
            WHERE user_id = ? AND id NOT IN (
                SELECT id FROM conversations
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            )
        `).run(userId, userId, this.maxHistory);
    }

    /**
     * Load the recent conversation history for a user, in chronological order.
     * Returns AgentMessages suitable for passing directly to the LLM.
     */
    getHistory(userId: string, limit?: number): AgentMessage[] {
        if (!this.enabled) return [];

        const maxRows = limit ?? this.maxHistory;
        const rows = getDb().prepare(`
            SELECT role, content, created_at
            FROM conversations
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `).all(userId, maxRows) as ConversationRow[];

        // Reverse to get chronological order (oldest first)
        return rows.reverse().map((r) => ({
            role: r.role as 'user' | 'assistant',
            content: r.content,
        }));
    }

    /**
     * Delete all stored messages for a user (e.g. /reset command).
     */
    clearHistory(userId: string): void {
        if (!this.enabled) return;
        getDb().prepare('DELETE FROM conversations WHERE user_id = ?').run(userId);
        log.info({ userId }, 'Conversation history cleared from DB');
    }

    // ─── PREFERENCES ─────────────────────────────────────────────────────────

    /**
     * Store or update a user preference (key/value).
     * The LLM calls memory_set_preference to record things like preferred
     * currency, language, or delivery address discovered during a session.
     */
    setPreference(userId: string, key: string, value: string): void {
        if (!this.enabled) return;
        getDb().prepare(`
            INSERT INTO preferences (user_id, pref_key, pref_value, updated_at)
            VALUES (?, ?, ?, unixepoch())
            ON CONFLICT (user_id, pref_key) DO UPDATE
                SET pref_value = excluded.pref_value,
                    updated_at = excluded.updated_at
        `).run(userId, key, value);
        log.debug({ userId, key, value }, 'Preference saved');
    }

    getPreference(userId: string, key: string): string | null {
        if (!this.enabled) return null;
        const row = getDb().prepare(`
            SELECT pref_value FROM preferences
            WHERE user_id = ? AND pref_key = ?
        `).get(userId, key) as PreferenceRow | undefined;
        return row?.pref_value ?? null;
    }

    getAllPreferences(userId: string): Record<string, string> {
        if (!this.enabled) return {};
        const rows = getDb().prepare(`
            SELECT pref_key, pref_value FROM preferences
            WHERE user_id = ?
        `).all(userId) as PreferenceRow[];
        return Object.fromEntries(rows.map((r) => [r.pref_key, r.pref_value]));
    }

    // ─── SEARCHES ────────────────────────────────────────────────────────────

    /**
     * Log a search/navigation that the agent performed.
     * Pruned to maxHistory entries per user to prevent unbounded growth.
     */
    saveSearch(userId: string, query: string, url?: string): void {
        if (!this.enabled) return;
        const db = getDb();

        db.prepare(`
            INSERT INTO searches (user_id, query, url)
            VALUES (?, ?, ?)
        `).run(userId, query, url ?? null);

        // Keep only the most recent maxHistory searches per user
        db.prepare(`
            DELETE FROM searches
            WHERE user_id = ? AND id NOT IN (
                SELECT id FROM searches
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            )
        `).run(userId, userId, this.maxHistory);
    }

    getRecentSearches(userId: string, limit = 10): Array<{ query: string; url: string | null }> {
        if (!this.enabled) return [];
        const rows = getDb().prepare(`
            SELECT query, url FROM searches
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `).all(userId, limit) as SearchRow[];
        return rows.map((r) => ({ query: r.query, url: r.url }));
    }

    // ─── CONTEXT SUMMARY ─────────────────────────────────────────────────────

    /**
     * Build a compact memory context block to inject at the start of every
     * agent session. This is how the LLM "knows" about the user's history
     * without needing to call a tool first.
     *
     * Injected into the system prompt in agent-loop.ts.
     * Returns `null` if memory is disabled or the user has no stored data.
     */
    buildContextBlock(userId: string): string | null {
        if (!this.enabled) return null;

        const prefs = this.getAllPreferences(userId);
        const searches = this.getRecentSearches(userId, 5);

        const lines: string[] = [];

        if (Object.keys(prefs).length > 0) {
            lines.push('## User Preferences');
            for (const [k, v] of Object.entries(prefs)) {
                lines.push(`- **${k}**: ${v}`);
            }
        }

        if (searches.length > 0) {
            lines.push('## Recent Activity');
            for (const s of searches) {
                const suffix = s.url ? ` (${s.url})` : '';
                lines.push(`- ${s.query}${suffix}`);
            }
        }

        if (lines.length === 0) return null;

        return [
            '---',
            '### Memory Context (from past sessions)',
            ...lines,
            '---',
        ].join('\n');
    }
}

export const memoryStore = new MemoryStore();
