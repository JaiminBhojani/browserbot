import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';
import { refStore } from '../snapshot/ref-store.js';

const log = logger.child({ module: 'action:click' });

export interface ClickOptions {
    /** Ref ID from a snapshot (e.g. "e5") — preferred method */
    ref?: string;
    /** User ID — required when using ref */
    userId?: string;
    /** CSS selector (fallback) */
    selector?: string;
    /** Visible text content of the element (fallback) */
    text?: string;
    /** Absolute coordinates (fallback) */
    x?: number;
    y?: number;
    timeoutMs?: number;
}

export interface ClickResult {
    success: boolean;
    error?: string;
}

export async function click(
    page: Page,
    options: ClickOptions
): Promise<ClickResult> {
    const { timeoutMs = 10_000 } = options;

    try {
        // Priority 1: Ref-based targeting (OpenClaw-style)
        if (options.ref && options.userId) {
            const entry = refStore.getRef(options.userId, options.ref);
            log.info({ ref: options.ref, role: entry.role, name: entry.name }, 'Clicking by ref');
            await page.getByRole(entry.role as any, { name: entry.name }).first().click({ timeout: timeoutMs });

        } else if (options.selector) {
            log.info({ selector: options.selector }, 'Clicking by selector');
            await page.click(options.selector, { timeout: timeoutMs });

        } else if (options.text) {
            log.info({ text: options.text }, 'Clicking by text');
            await page.getByText(options.text, { exact: false }).first().click({ timeout: timeoutMs });

        } else if (options.x !== undefined && options.y !== undefined) {
            log.info({ x: options.x, y: options.y }, 'Clicking by coordinates');
            await page.mouse.click(options.x, options.y);

        } else {
            return { success: false, error: 'Must provide ref, selector, text, or coordinates' };
        }

        return { success: true };
    } catch (err: any) {
        log.error({ error: err.message }, 'Click failed');
        return { success: false, error: err.message };
    }
}