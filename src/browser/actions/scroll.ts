import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'action:scroll' });

export interface ScrollOptions {
    /** Scroll the whole page (default) or a specific element */
    selector?: string;
    direction: 'up' | 'down';
    /** Pixels to scroll (default: 600 — one viewport) */
    amount?: number;
}

export interface ScrollResult {
    success: boolean;
    error?: string;
}

export async function scroll(
    page: Page,
    options: ScrollOptions
): Promise<ScrollResult> {
    const { direction, amount = 600, selector } = options;
    const delta = direction === 'down' ? amount : -amount;

    try {
        if (selector) {
            log.info({ selector, direction, amount }, 'Scrolling element');
            await page.$eval(
                selector,
                (el, d) => el.scrollBy(0, d),
                delta
            );
        } else {
            log.info({ direction, amount }, 'Scrolling page');
            await page.evaluate((d) => window.scrollBy(0, d), delta);
        }
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}