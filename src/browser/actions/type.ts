import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';
import { refStore } from '../snapshot/ref-store.js';

const log = logger.child({ module: 'action:type' });

export interface TypeOptions {
    /** Ref ID from a snapshot (e.g. "e1") — preferred method */
    ref?: string;
    /** User ID — required when using ref */
    userId?: string;
    /** CSS selector (fallback) */
    selector?: string;
    text: string;
    /** Clear the field before typing (default: true) */
    clear?: boolean;
    /** Delay between keystrokes in ms — more human-like (default: 50) */
    delayMs?: number;
    timeoutMs?: number;
}

export interface TypeResult {
    success: boolean;
    error?: string;
}

export async function typeText(
    page: Page,
    options: TypeOptions
): Promise<TypeResult> {
    const { text, clear = true, delayMs = 50, timeoutMs = 10_000 } = options;

    try {
        // Priority 1: Ref-based targeting (OpenClaw-style)
        if (options.ref && options.userId) {
            const entry = refStore.getRef(options.userId, options.ref);
            log.info({ ref: options.ref, role: entry.role, name: entry.name, textLength: text.length }, 'Typing by ref');

            const locator = page.getByRole(entry.role as any, { name: entry.name }).first();

            if (clear) {
                await locator.fill(text);
            } else {
                await locator.click({ timeout: timeoutMs });
                await page.keyboard.type(text, { delay: delayMs });
            }

            log.info({ ref: options.ref }, 'Typing complete');
            return { success: true };
        }

        // Priority 2: CSS selector (fallback)
        const selector = options.selector;
        if (!selector) {
            return { success: false, error: 'Must provide ref or selector' };
        }

        log.info({ selector, textLength: text.length }, 'Typing into field');

        await page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });
        await page.click(selector);

        if (clear) {
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Delete');
        }

        await page.type(selector, text, { delay: delayMs });

        log.info({ selector }, 'Typing complete');
        return { success: true };
    } catch (err: any) {
        log.error({ error: err.message }, 'Type failed');
        return { success: false, error: err.message };
    }
}