import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'vision:screenshot' });

export interface ScreenshotOptions {
    /** 'viewport' = visible area only (default), 'full' = full page */
    mode?: 'viewport' | 'full';
    /** Only capture a specific element */
    selector?: string;
}

export interface ScreenshotResult {
    success: boolean;
    /** Base64 encoded PNG */
    base64?: string;
    /** Data URL ready to send to Claude vision API */
    dataUrl?: string;
    error?: string;
}

export async function takeScreenshot(
    page: Page,
    options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
    const { mode = 'viewport', selector } = options;

    try {
        log.info({ mode, selector }, 'Taking screenshot');
        let buffer: Buffer;

        if (selector) {
            const element = await page.$(selector);
            if (!element) return { success: false, error: `Element not found: ${selector}` };
            buffer = await element.screenshot({ type: 'png' });
        } else {
            buffer = await page.screenshot({
                type: 'png',
                fullPage: mode === 'full',
            });
        }

        const base64 = buffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;

        log.info({ sizeKb: Math.round(buffer.length / 1024) }, 'Screenshot captured');
        return { success: true, base64, dataUrl };
    } catch (err: any) {
        log.error({ error: err.message }, 'Screenshot failed');
        return { success: false, error: err.message };
    }
}