import { Page } from 'playwright';
import { navigate } from '../actions/navigate.js';
import { click } from '../actions/click.js';
import { typeText } from '../actions/type.js';
import { scroll } from '../actions/scroll.js';
import { selectOption, wait, goBack } from '../actions/select-wait-back.js';
import { extractPrice, extractReviews } from '../extraction/extraction.js';
import { takeScreenshot } from '../vision/screenshot.js';
import { takeSnapshot } from '../snapshot/snapshot.js';
import { refStore } from '../snapshot/ref-store.js';
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

// NOTE: withScreenshotOnError removed — auto-attaching screenshots on every
// error wastes tokens. The agent can explicitly use browser_screenshot to debug.

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
    },
};

// ─── TOOL 2: browser_click ────────────────────────────────────────────────────

export const browserClick: BrowserTool = {
    name: 'browser_click',
    description:
        'Click an element on the page. PREFERRED: use "ref" from browser_snapshot (e.g. "e5"). Fallbacks: CSS selector, visible text, or coordinates.',
    parameters: {
        ref: {
            type: 'string',
            description: 'Ref ID from browser_snapshot (e.g. "e5") — preferred method',
            required: false,
        },
        selector: {
            type: 'string',
            description: 'CSS selector (fallback if ref unavailable)',
            required: false,
        },
        text: {
            type: 'string',
            description: 'Visible text of the element to click (fallback)',
            required: false,
        },
        x: {
            type: 'number',
            description: 'X coordinate to click (use with y, last resort)',
            required: false,
        },
        y: {
            type: 'number',
            description: 'Y coordinate to click (use with x)',
            required: false,
        },
    },
    async execute(params, ctx) {
        const result = await click(ctx.page, {
            ref: params.ref as string | undefined,
            userId: ctx.userId,
            selector: params.selector as string | undefined,
            text: params.text as string | undefined,
            x: params.x as number | undefined,
            y: params.y as number | undefined,
        });
        return { success: result.success, error: result.error };
    },
};

// ─── TOOL 3: browser_type ─────────────────────────────────────────────────────

export const browserType: BrowserTool = {
    name: 'browser_type',
    description:
        'Type text into an input field, search box, or form field. PREFERRED: use "ref" from browser_snapshot. Clears the field first by default.',
    parameters: {
        ref: {
            type: 'string',
            description: 'Ref ID from browser_snapshot (e.g. "e1") — preferred method',
            required: false,
        },
        selector: {
            type: 'string',
            description: 'CSS selector of the input field (fallback if ref unavailable)',
            required: false,
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
        const result = await typeText(ctx.page, {
            ref: params.ref as string | undefined,
            userId: ctx.userId,
            selector: params.selector as string | undefined,
            text: params.text as string,
            clear: (params.clear as boolean) ?? true,
        });
        return { success: result.success, error: result.error };
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
        const result = await scroll(ctx.page, {
            direction: params.direction as 'up' | 'down',
            amount: params.amount as number | undefined,
            selector: params.selector as string | undefined,
        });
        return { success: result.success, error: result.error };
    },
};

// ─── TOOL 5: browser_select ───────────────────────────────────────────────────

export const browserSelect: BrowserTool = {
    name: 'browser_select',
    description: 'Select an option from a dropdown/select element. Use ref from snapshot or CSS selector.',
    parameters: {
        ref: {
            type: 'string',
            description: 'Ref ID from browser_snapshot (preferred)',
            required: false,
        },
        selector: {
            type: 'string',
            description: 'CSS selector of the <select> element (fallback)',
            required: false,
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
        // If using ref, resolve to selector via getByRole
        let selectorToUse = params.selector as string | undefined;
        if (params.ref) {
            const entry = refStore.getRef(ctx.userId, params.ref as string);
            // For select, we need to use getByRole which returns a locator, not a selector
            // Fall back to page.getByRole().selectOption() directly
            try {
                const locator = ctx.page.getByRole(entry.role as any, { name: entry.name }).first();
                const selected = await locator.selectOption(
                    params.value ? { value: params.value as string } : { label: params.label as string }
                );
                return {
                    success: true,
                    data: { selectedValue: selected[0] },
                };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        }

        if (!selectorToUse) {
            return { success: false, error: 'Must provide ref or selector' };
        }

        const result = await selectOption(ctx.page, {
            selector: selectorToUse,
            value: params.value as string | undefined,
            label: params.label as string | undefined,
        });
        return {
            success: result.success,
            data: { selectedValue: result.selectedValue },
            error: result.error,
        };
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
        const ms = params.ms ? Math.min(params.ms as number, 5000) : undefined;
        const result = await wait(ctx.page, {
            selector: params.selector as string | undefined,
            networkIdle: params.network_idle as boolean | undefined,
            ms,
        });
        return { success: result.success, error: result.error };
    },
};

// ─── TOOL 7: browser_back ─────────────────────────────────────────────────────

export const browserBack: BrowserTool = {
    name: 'browser_back',
    description: 'Go back to the previous page in browser history.',
    parameters: {},
    async execute(_params, ctx) {
        const result = await goBack(ctx.page);
        return {
            success: result.success,
            data: { url: result.url },
            error: result.error,
        };
    },
};

// ─── TOOL 8: browser_screenshot ───────────────────────────────────────────────

export const browserScreenshot: BrowserTool = {
    name: 'browser_screenshot',
    description:
        'Take a screenshot of the current page. Use sparingly — prefer browser_snapshot for understanding page structure. Only use for visual verification.',
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
        // Use JPEG with quality 80 to save ~70% tokens compared to PNG
        const mode = (params.mode as 'viewport' | 'full') ?? 'viewport';
        try {
            let buffer: Buffer;
            if (params.selector) {
                buffer = await ctx.page.locator(params.selector as string).screenshot({
                    type: 'jpeg',
                    quality: 80,
                });
            } else {
                buffer = await ctx.page.screenshot({
                    type: 'jpeg',
                    quality: 80,
                    fullPage: mode === 'full',
                });
            }
            const base64 = buffer.toString('base64');
            return {
                success: true,
                data: { base64: `data:image/jpeg;base64,${base64}` },
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
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

// ─── TOOL 10: browser_snapshot ────────────────────────────────────────────────

export const browserSnapshot: BrowserTool = {
    name: 'browser_snapshot',
    description:
        'Take an accessibility snapshot of the current page. Returns a structured tree of all interactive elements (buttons, links, inputs, etc.) with ref IDs that you can use with browser_click, browser_type, and browser_select. ALWAYS call this after navigating or any action that changes the page.',
    parameters: {},
    async execute(_params, ctx) {
        try {
            const result = await takeSnapshot(ctx.page, { maxChars: 12_000 });

            // Save refs for this user so click/type/select can use them
            refStore.saveRefs(ctx.userId, result.refs);

            return {
                success: true,
                data: {
                    snapshot: result.text,
                    url: result.url,
                    title: result.title,
                    refCount: result.refs.size,
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
    browserSnapshot,
    browserTabNew,
    browserTabSwitch,
    browserTabClose,
];

/** Quick lookup by tool name */
export const BROWSER_TOOLS_MAP = new Map<string, BrowserTool>(
    ALL_BROWSER_TOOLS.map((t) => [t.name, t])
);

log.info({ count: ALL_BROWSER_TOOLS.length }, 'Browser tools loaded');