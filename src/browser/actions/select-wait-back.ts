import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'action:select' });

// ─── SELECT ───────────────────────────────────────────────────────────────────

export interface SelectOptions {
    selector: string;
    /** Match by value attribute */
    value?: string;
    /** Match by visible label text */
    label?: string;
    timeoutMs?: number;
}

export interface SelectResult {
    success: boolean;
    selectedValue?: string;
    error?: string;
}

export async function selectOption(
    page: Page,
    options: SelectOptions
): Promise<SelectResult> {
    const { selector, value, label, timeoutMs = 10_000 } = options;

    try {
        await page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });

        let selected: string[];
        if (value) {
            log.info({ selector, value }, 'Selecting by value');
            selected = await page.selectOption(selector, { value });
        } else if (label) {
            log.info({ selector, label }, 'Selecting by label');
            selected = await page.selectOption(selector, { label });
        } else {
            return { success: false, error: 'Must provide value or label' };
        }

        return { success: true, selectedValue: selected[0] };
    } catch (err: any) {
        log.error({ selector, error: err.message }, 'Select failed');
        return { success: false, error: err.message };
    }
}

// ─── WAIT ─────────────────────────────────────────────────────────────────────

export interface WaitOptions {
    /** Wait for a CSS selector to appear */
    selector?: string;
    /** Wait for network to be idle */
    networkIdle?: boolean;
    /** Wait a fixed number of ms */
    ms?: number;
    timeoutMs?: number;
}

export interface WaitResult {
    success: boolean;
    error?: string;
}

export async function wait(
    page: Page,
    options: WaitOptions
): Promise<WaitResult> {
    try {
        if (options.selector) {
            log.info({ selector: options.selector }, 'Waiting for selector');
            await page.waitForSelector(options.selector, {
                state: 'visible',
                timeout: options.timeoutMs ?? 15_000,
            });
        } else if (options.networkIdle) {
            log.info('Waiting for network idle');
            await page.waitForLoadState('networkidle', { timeout: options.timeoutMs ?? 15_000 });
        } else if (options.ms) {
            log.info({ ms: options.ms }, 'Waiting fixed time');
            await page.waitForTimeout(options.ms);
        }
        return { success: true };
    } catch (err: any) {
        log.error({ error: err.message }, 'Wait failed');
        return { success: false, error: err.message };
    }
}

// ─── BACK ─────────────────────────────────────────────────────────────────────

export interface BackResult {
    success: boolean;
    url: string;
    error?: string;
}

export async function goBack(page: Page): Promise<BackResult> {
    try {
        log.info('Going back');
        await page.goBack({ waitUntil: 'domcontentloaded' });
        return { success: true, url: page.url() };
    } catch (err: any) {
        log.error({ error: err.message }, 'Back navigation failed');
        return { success: false, url: page.url(), error: err.message };
    }
}