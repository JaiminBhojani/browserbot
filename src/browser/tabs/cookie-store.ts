import { BrowserContext } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'cookie-store' });

/**
 * CookieStore — saves and restores cookies for a user+domain pair.
 *
 * Why this matters: Without this, every time a user's browser context
 * is destroyed (idle timeout), they'd be logged out of Amazon, Flipkart,
 * etc. and would need to log in again.
 *
 * Storage: We use a simple JSON file per user for now.
 * Phase 3 can migrate this to SQLite with encryption.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORE_DIR = join(homedir(), '.browsbot', 'cookies');

export interface StoredCookies {
    userId: string;
    domain: string;
    cookies: any[];
    savedAt: number;
}

export class CookieStore {
    private async ensureDir(): Promise<void> {
        await fs.mkdir(STORE_DIR, { recursive: true });
    }

    private cookiePath(userId: string, domain: string): string {
        // Sanitize for filesystem
        const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
        const safeUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
        return join(STORE_DIR, `${safeUserId}_${safeDomain}.json`);
    }

    /** Save all cookies from a browser context for a specific domain */
    async save(userId: string, domain: string, context: BrowserContext): Promise<void> {
        try {
            await this.ensureDir();
            const allCookies = await context.cookies();

            // Only save cookies relevant to this domain
            const domainCookies = allCookies.filter(
                (c) => c.domain.includes(domain) || domain.includes(c.domain.replace(/^\./, ''))
            );

            if (domainCookies.length === 0) {
                log.debug({ userId, domain }, 'No cookies to save for domain');
                return;
            }

            const stored: StoredCookies = {
                userId,
                domain,
                cookies: domainCookies,
                savedAt: Date.now(),
            };

            await fs.writeFile(this.cookiePath(userId, domain), JSON.stringify(stored, null, 2));
            log.info({ userId, domain, count: domainCookies.length }, 'Cookies saved');
        } catch (err: any) {
            log.error({ userId, domain, error: err.message }, 'Failed to save cookies');
        }
    }

    /** Restore cookies into a browser context */
    async restore(userId: string, domain: string, context: BrowserContext): Promise<boolean> {
        try {
            const path = this.cookiePath(userId, domain);
            const raw = await fs.readFile(path, 'utf-8');
            const stored: StoredCookies = JSON.parse(raw);

            // Don't restore cookies older than 7 days
            const AGE_LIMIT = 7 * 24 * 60 * 60 * 1000;
            if (Date.now() - stored.savedAt > AGE_LIMIT) {
                log.info({ userId, domain }, 'Cookies expired, not restoring');
                await fs.unlink(path).catch(() => { });
                return false;
            }

            await context.addCookies(stored.cookies);
            log.info({ userId, domain, count: stored.cookies.length }, 'Cookies restored');
            return true;
        } catch {
            // File doesn't exist or is invalid — that's fine
            return false;
        }
    }

    /** Clear saved cookies for a user+domain */
    async clear(userId: string, domain: string): Promise<void> {
        try {
            await fs.unlink(this.cookiePath(userId, domain));
            log.info({ userId, domain }, 'Cookies cleared');
        } catch {
            // Already gone
        }
    }

    /** List all domains that have saved cookies for a user */
    async listDomains(userId: string): Promise<string[]> {
        try {
            await this.ensureDir();
            const files = await fs.readdir(STORE_DIR);
            const safeUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
            return files
                .filter((f) => f.startsWith(safeUserId) && f.endsWith('.json'))
                .map((f) => f.replace(`${safeUserId}_`, '').replace('.json', ''));
        } catch {
            return [];
        }
    }
}

export const cookieStore = new CookieStore();