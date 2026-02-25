import { RefEntry } from './snapshot.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'ref-store' });

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface UserRefData {
    refs: Map<string, RefEntry>;
    timestamp: number;
}

// ─── REF STORE ────────────────────────────────────────────────────────────────

/**
 * Per-user ref storage with stale detection.
 *
 * Critical rule from OpenClaw: refs become invalid after ANY DOM change.
 * The agent must re-snapshot after every action. If it tries to use a stale
 * ref, we throw a helpful error telling it to take a new snapshot.
 */
class RefStore {
    private store = new Map<string, UserRefData>();

    /**
     * Save refs from a snapshot for a user.
     * Replaces any existing refs (previous snapshot is now stale).
     */
    saveRefs(userId: string, refs: Map<string, RefEntry>): void {
        this.store.set(userId, {
            refs,
            timestamp: Date.now(),
        });
        log.debug({ userId, refCount: refs.size }, 'Refs saved');
    }

    /**
     * Get a ref entry for a user.
     * Throws a helpful error if the ref doesn't exist.
     */
    getRef(userId: string, refId: string): RefEntry {
        const userData = this.store.get(userId);

        if (!userData) {
            throw new Error(
                `No snapshot taken yet. Call browser_snapshot first to see the page elements.`
            );
        }

        const entry = userData.refs.get(refId);
        if (!entry) {
            const available = Array.from(userData.refs.keys()).slice(0, 10).join(', ');
            throw new Error(
                `Ref "${refId}" not found. This ref may be stale — take a new browser_snapshot. ` +
                `Available refs: ${available}${userData.refs.size > 10 ? '...' : ''}`
            );
        }

        return entry;
    }

    /**
     * Check if a user has any refs stored.
     */
    hasRefs(userId: string): boolean {
        return this.store.has(userId);
    }

    /**
     * Clear refs for a user (e.g., on context cleanup).
     */
    clearRefs(userId: string): void {
        this.store.delete(userId);
        log.debug({ userId }, 'Refs cleared');
    }

    /**
     * Get the age of the current refs in milliseconds.
     */
    getRefAge(userId: string): number | null {
        const userData = this.store.get(userId);
        if (!userData) return null;
        return Date.now() - userData.timestamp;
    }
}

// Singleton
export const refStore = new RefStore();
