import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'action:click' });

export interface ClickOptions {
    /** CSS selector */
    selector?: string;
    /** Visible text content of the element */
    text?: string;
    /** Absolute coordinates */
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
        if (options.selector) {
            log.info({ selector: options.selector }, 'Clicking by selector');
            await page.click(options.selector, { timeout: timeoutMs });

        } else if (options.text) {
            log.info({ text: options.text }, 'Clicking by text');
            // Use getByText for resilient text-based clicking
            await page.getByText(options.text, { exact: false }).first().click({ timeout: timeoutMs });

        } else if (options.x !== undefined && options.y !== undefined) {
            log.info({ x: options.x, y: options.y }, 'Clicking by coordinates');
            await page.mouse.click(options.x, options.y);

        } else {
            return { success: false, error: 'Must provide selector, text, or coordinates' };
        }

        return { success: true };
    } catch (err: any) {
        log.error({ error: err.message }, 'Click failed');
        return { success: false, error: err.message };
    }
}