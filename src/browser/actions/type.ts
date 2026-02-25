import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'action:type' });

export interface TypeOptions {
    selector: string;
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
    const { selector, text, clear = true, delayMs = 50, timeoutMs = 10_000 } = options;

    try {
        log.info({ selector, textLength: text.length }, 'Typing into field');

        // Wait for the element to be visible
        await page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });

        // Click to focus
        await page.click(selector);

        if (clear) {
            // Select all + delete to clear any existing content
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Delete');
        }

        await page.type(selector, text, { delay: delayMs });

        log.info({ selector }, 'Typing complete');
        return { success: true };
    } catch (err: any) {
        log.error({ selector, error: err.message }, 'Type failed');
        return { success: false, error: err.message };
    }
}