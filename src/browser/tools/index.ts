import { Page } from 'playwright';
import { navigate } from '../actions/navigate.js';
import { click } from '../actions/click.js';
import { typeText } from '../actions/type.js';
import { scroll } from '../actions/scroll.js';
import { selectOption, wait, goBack } from '../actions/select-wait-back.js';
import { extractPageText, extractPrice, extractReviews } from '../extraction/extraction.js';
import { takeScreenshot } from '../vision/screenshot.js';
import { getTabManager } from '../tabs/tab-manager.js';
import { tabRouter } from '../tabs/tab-router.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'browser-tools' });

// ─── SHARED TYPES ─────────────────────────────────────────────────────────────

/** Every tool the agent calls receives this context */
export interface ToolContext {
    userId: string;
    page: Page;
}

/** Every tool returns this shape */
export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
    /** Attached automatically on failure if screenshotOnError=true */
    screenshot?: string;
}

/** Shape of a tool definition — what the agent sees + what executes it */
export interface BrowserTool {
    name: string;
    description: string;
    parameters: Record<string, ToolParameter>;
    execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolParameter {
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
    enum?: string[];
    default?: unknown;
}

// ─── HELPER ───────────────────────────────────────────────────────────────────

async function withScreenshotOnError(
    ctx: ToolContext,
    fn: () => Promise<ToolResult>
): Promise<ToolResult> {
    const result = await fn();
    if (!result.success) {
        try {
            const ss = await takeScreenshot(ctx.page);
            if (ss.base64) result.screenshot = ss.base64;
        } catch { /* best-effort */ }
    }
    return result;
}

// ─── TOOL 1: browser_navigate ─────────────────────────────────────────────────

export const browserNavigate: BrowserTool = {
    name: 'browser_navigate',
    description:
        'Navigate the browser to a URL. Use this to open websites, product pages, search results, etc.',
    parameters: {
        url: {
            type: 'string',
            description: 'The URL to navigate to. Can be a full URL or just a domain like "amazon.in"',
            required: true,
        },
        wait_until: {
            type: 'string',
            description: 'When to consider navigation complete',
            required: false,
            enum: ['load', 'domcontentloaded', 'networkidle'],
            default: 'domcontentloaded',
        },
    },
    async execute(params, ctx) {
        return withScreenshotOnError(ctx, async () => {
            const result = await navigate(
                ctx.page,
                params.url as string,
                { waitUntil: (params.wait_until as any) ?? 'domcontentloaded' }
            );
            return {
                success: result.success,
                data: { url: result.url, title: result.title },
                error: result.error,
            };
        });
    },
};

// ─── TOOL 2: browser_click ────────────────────────────────────────────────────

export const browserClick: BrowserTool = {
    name: 'browser_click',
    description:
        'Click an element on the page. Use selector (CSS) for precise targeting, or text for buttons/links with visible labels.',
    parameters: {
        selector: {
            type: 'string',
            description: 'CSS selector of the element to click (e.g. "#add-to-cart", ".buy-now-btn")',
            required: false,
        },
        text: {
            type: 'string',
            description: 'Visible text of the element to click (e.g. "Add to Cart", "Buy Now")',
            required: false,
        },
        x: {
            type: 'number',
            description: 'X coordinate to click (use with y, only if selector/text unavailable)',
            required: false,
        },
        y: {
            type: 'number',
            description: 'Y coordinate to click (use with x)',
            required: false,
        },
    },
    async execute(params, ctx) {
        return withScreenshotOnError(ctx, async () => {
            const result = await click(ctx.page, {
                selector: params.selector as string | undefined,
                text: params.text as string | undefined,
                x: params.x as number | undefined,
                y: params.y as number | undefined,
            });
            return { success: result.success, error: result.error };
        });
    },
};

// ─── TOOL 3: browser_type ─────────────────────────────────────────────────────

export const browserType: BrowserTool = {
    name: 'browser_type',
    description:
        'Type text into an input field, search box, or form field. Clears the field first by default.',
    parameters: {
        selector: {
            type: 'string',
            description: 'CSS selector of the input field (e.g. "#search", "input[name=q]")',
            required: true,
        },
        text: {
            type: 'string',
            description: 'The text to type',
            required: true,
        },
        clear: {
            type: 'boolean',
            description: 'Clear existing text before typing (default: true)',
            required: false,
        },
    },
    async execute(params, ctx) {
        return withScreenshotOnError(ctx, async () => {
            const result = await typeText(ctx.page, {
                selector: params.selector as string,
                text: params.text as string,
                clear: (params.clear as boolean) ?? true,
            });
            return { success: result.success, error: result.error };
        });
    },
};

// ─── TOOL 4: browser_scroll ───────────────────────────────────────────────────

export const browserScroll: BrowserTool = {
    name: 'browser_scroll',
    description:
        'Scroll the page up or down to reveal more content. Useful for loading more reviews or reaching page sections.',
    parameters: {
        direction: {
            type: 'string',
            description: 'Scroll direction',
            required: true,
            enum: ['up', 'down'],
        },
        amount: {
            type: 'number',
            description: 'Pixels to scroll (default: 600 = roughly one screen)',
            required: false,
        },
        selector: {
            type: 'string',
            description: 'CSS selector of a scrollable container (leave empty to scroll the whole page)',
            required: false,
        },
    },
    async execute(params, ctx) {
        return withScreenshotOnError(ctx, async () => {
            const result = await scroll(ctx.page, {
                direction: params.direction as 'up' | 'down',
                amount: params.amount as number | undefined,
                selector: params.selector as string | undefined,
            });
            return { success: result.success, error: result.error };
        });
    },
};

// ─── TOOL 5: browser_select ───────────────────────────────────────────────────

export const browserSelect: BrowserTool = {
    name: 'browser_select',
    description: 'Select an option from a dropdown/select element.',
    parameters: {
        selector: {
            type: 'string',
            description: 'CSS selector of the <select> element',
            required: true,
        },
        value: {
            type: 'string',
            description: 'Option value attribute to select',
            required: false,
        },
        label: {
            type: 'string',
            description: 'Visible label text of the option to select',
            required: false,
        },
    },
    async execute(params, ctx) {
        return withScreenshotOnError(ctx, async () => {
            const result = await selectOption(ctx.page, {
                selector: params.selector as string,
                value: params.value as string | undefined,
                label: params.label as string | undefined,
            });
            return {
                success: result.success,
                data: { selectedValue: result.selectedValue },
                error: result.error,
            };
        });
    },
};

// ─── TOOL 6: browser_wait ─────────────────────────────────────────────────────

export const browserWait: BrowserTool = {
    name: 'browser_wait',
    description:
        'Wait for an element to appear, for network activity to finish, or for a fixed time. Use after clicking buttons that trigger page loads.',
    parameters: {
        selector: {
            type: 'string',
            description: 'Wait until this CSS selector is visible on the page',
            required: false,
        },
        network_idle: {
            type: 'boolean',
            description: 'Wait until network requests have stopped',
            required: false,
        },
        ms: {
            type: 'number',
            description: 'Wait a fixed number of milliseconds (max 5000)',
            required: false,
        },
    },
    async execute(params, ctx) {
        return withScreenshotOnError(ctx, async () => {
            const ms = params.ms ? Math.min(params.ms as number, 5000) : undefined;
            const result = await wait(ctx.page, {
                selector: params.selector as string | undefined,
                networkIdle: params.network_idle as boolean | undefined,
                ms,
            });
            return { success: result.success, error: result.error };
        });
    },
};

// ─── TOOL 7: browser_back ─────────────────────────────────────────────────────

export const browserBack: BrowserTool = {
    name: 'browser_back',
    description: 'Go back to the previous page in browser history.',
    parameters: {},
    async execute(_params, ctx) {
        return withScreenshotOnError(ctx, async () => {
            const result = await goBack(ctx.page);
            return {
                success: result.success,
                data: { url: result.url },
                error: result.error,
            };
        });
    },
};

// ─── TOOL 8: browser_screenshot ───────────────────────────────────────────────

export const browserScreenshot: BrowserTool = {
    name: 'browser_screenshot',
    description:
        'Take a screenshot of the current page. Use this to visually inspect the page, verify actions worked, or when unsure what to click next.',
    parameters: {
        mode: {
            type: 'string',
            description: '"viewport" for visible area only (fast), "full" for entire page (slow)',
            required: false,
            enum: ['viewport', 'full'],
        },
        selector: {
            type: 'string',
            description: 'CSS selector to screenshot just one element',
            required: false,
        },
    },
    async execute(params, ctx) {
        const result = await takeScreenshot(ctx.page, {
            mode: (params.mode as 'viewport' | 'full') ?? 'viewport',
            selector: params.selector as string | undefined,
        });
        return {
            success: result.success,
            data: { base64: result.base64 },
            error: result.error,
        };
    },
};

// ─── TOOL 9: browser_extract ──────────────────────────────────────────────────

export const browserExtract: BrowserTool = {
    name: 'browser_extract',
    description:
        'Extract structured data from the current page: price, reviews, or arbitrary DOM elements.',
    parameters: {
        type: {
            type: 'string',
            description: 'What to extract',
            required: true,
            enum: ['price', 'reviews', 'dom'],
        },
        selector: {
            type: 'string',
            description: 'CSS selector (only used when type is "dom")',
            required: false,
        },
    },
    async execute(params, ctx) {
        try {
            const type = params.type as string;

            if (type === 'price') {
                const result = await extractPrice(ctx.page);
                return { success: true, data: result };

            } else if (type === 'reviews') {
                const result = await extractReviews(ctx.page);
                return { success: true, data: result };

            } else if (type === 'dom') {
                if (!params.selector) {
                    return { success: false, error: 'selector required for dom extraction' };
                }
                const { extractDOM } = await import('../extraction/extraction.js');
                const result = await extractDOM(ctx.page, params.selector as string);
                return { success: true, data: { items: result } };

            } else {
                return { success: false, error: `Unknown extraction type: ${type}` };
            }
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },
};

// ─── TOOL 10: browser_read_page ───────────────────────────────────────────────

export const browserReadPage: BrowserTool = {
    name: 'browser_read_page',
    description:
        'Read the full visible text content of the current page. Use this to understand what is on a page before deciding what to click, or to read product descriptions and reviews.',
    parameters: {
        max_words: {
            type: 'number',
            description: 'Truncate output to this many words (default: 1000)',
            required: false,
        },
    },
    async execute(params, ctx) {
        try {
            const result = await extractPageText(ctx.page);
            const maxWords = (params.max_words as number) ?? 1000;

            const words = result.text.split(/\s+/);
            const truncated = words.length > maxWords
                ? words.slice(0, maxWords).join(' ') + `\n\n[...${words.length - maxWords} more words]`
                : result.text;

            return {
                success: true,
                data: {
                    text: truncated,
                    url: result.url,
                    title: result.title,
                    wordCount: result.wordCount,
                },
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },
};

// ─── TOOL 11: browser_tab_new ─────────────────────────────────────────────────

export const browserTabNew: BrowserTool = {
    name: 'browser_tab_new',
    description: 'Open a new browser tab, optionally navigating to a URL.',
    parameters: {
        url: {
            type: 'string',
            description: 'URL to open in the new tab (optional)',
            required: false,
        },
    },
    async execute(params, ctx) {
        try {
            const tabManager = getTabManager(ctx.userId);
            const tab = await tabManager.newTab(params.url as string | undefined);
            // Update ctx.page to the new tab
            ctx.page = await tabRouter.getActivePage(ctx.userId);
            return { success: true, data: tab };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },
};

// ─── TOOL 12: browser_tab_switch ──────────────────────────────────────────────

export const browserTabSwitch: BrowserTool = {
    name: 'browser_tab_switch',
    description: 'Switch to a different open tab by its index number (0 = first tab).',
    parameters: {
        index: {
            type: 'number',
            description: 'Zero-based tab index to switch to',
            required: true,
        },
    },
    async execute(params, ctx) {
        try {
            const tabManager = getTabManager(ctx.userId);
            const tab = await tabManager.switchTab(params.index as number);
            ctx.page = await tabRouter.getActivePage(ctx.userId);
            return { success: true, data: tab };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },
};

// ─── TOOL 13: browser_tab_close ───────────────────────────────────────────────

export const browserTabClose: BrowserTool = {
    name: 'browser_tab_close',
    description: 'Close the current active tab.',
    parameters: {},
    async execute(_params, ctx) {
        try {
            const tabManager = getTabManager(ctx.userId);
            await tabManager.closeTab();
            ctx.page = await tabRouter.getActivePage(ctx.userId);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },
};

// ─── REGISTRY ─────────────────────────────────────────────────────────────────

/** All 13 browser tools in one array — register these into the agent's tool registry */
export const ALL_BROWSER_TOOLS: BrowserTool[] = [
    browserNavigate,
    browserClick,
    browserType,
    browserScroll,
    browserSelect,
    browserWait,
    browserBack,
    browserScreenshot,
    browserExtract,
    browserReadPage,
    browserTabNew,
    browserTabSwitch,
    browserTabClose,
];

/** Quick lookup by tool name */
export const BROWSER_TOOLS_MAP = new Map<string, BrowserTool>(
    ALL_BROWSER_TOOLS.map((t) => [t.name, t])
);

log.info({ count: ALL_BROWSER_TOOLS.length }, 'Browser tools loaded');