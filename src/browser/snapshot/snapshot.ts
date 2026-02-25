import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'snapshot' });

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface SnapshotOptions {
    /** Maximum characters in the output (default: 12000 ≈ 3K tokens) */
    maxChars?: number;
}

export interface RefEntry {
    role: string;
    name: string;
}

export interface SnapshotResult {
    /** ARIA snapshot with ref IDs injected for interactive elements */
    text: string;
    /** Map of ref IDs to element metadata for later targeting */
    refs: Map<string, RefEntry>;
    /** Page title */
    title: string;
    /** Current page URL */
    url: string;
}

// ─── INTERACTIVE ROLES ────────────────────────────────────────────────────────

/**
 * ARIA roles that represent interactive elements — these get ref IDs.
 * The agent uses these refs with browser_click / browser_type / browser_select.
 */
const INTERACTIVE_ROLES = new Set([
    'button',
    'link',
    'textbox',
    'checkbox',
    'radio',
    'combobox',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'searchbox',
    'slider',
    'spinbutton',
    'switch',
    'tab',
    'treeitem',
]);

// ─── SNAPSHOT ─────────────────────────────────────────────────────────────────

/**
 * Regex to match ARIA snapshot lines like:
 *   - link "Home"
 *   - button "Submit" [disabled]
 *   - textbox "Search" [value="hello"]
 *   - heading "Title" [level=2]
 * 
 * Captures: indent, role, optional name in quotes
 */
const LINE_PATTERN = /^(\s*-\s+)(\w+)(?:\s+"([^"]*)")?(.*)$/;

/**
 * Take an accessibility snapshot of the page using Playwright's built-in
 * locator.ariaSnapshot() API (Playwright 1.49+).
 *
 * The output is the YAML-formatted ARIA tree from Playwright, with ref IDs
 * injected next to interactive elements. This is ~100x smaller than raw
 * page.innerText() and gives the agent structured, actionable data.
 *
 * Example output:
 *   - navigation "Main":
 *     - link "Home" [ref=e1]
 *     - link "About" [ref=e2]
 *   - main:
 *     - heading "Welcome" [level=1]
 *     - textbox "Search" [ref=e3]
 *     - button "Go" [ref=e4]
 */
export async function takeSnapshot(
    page: Page,
    options: SnapshotOptions = {}
): Promise<SnapshotResult> {
    const { maxChars = 12_000 } = options;

    // Use Playwright's native ariaSnapshot (returns YAML string)
    const [rawSnapshot, title, url] = await Promise.all([
        page.locator(':root').ariaSnapshot({ timeout: 10_000 }),
        page.title(),
        Promise.resolve(page.url()),
    ]);

    const refs = new Map<string, RefEntry>();
    let refCounter = 0;

    // Process each line: inject ref IDs for interactive elements
    const lines = rawSnapshot.split('\n');
    const processedLines: string[] = [];

    for (const line of lines) {
        const match = line.match(LINE_PATTERN);

        if (match) {
            const [, indent, role, name, rest] = match;
            const isInteractive = INTERACTIVE_ROLES.has(role);

            if (isInteractive) {
                const ref = `e${++refCounter}`;
                refs.set(ref, { role, name: name ?? '' });
                // Inject ref before any existing attributes
                const refTag = ` [ref=${ref}]`;
                processedLines.push(`${indent}${role}${name ? ` "${name}"` : ''}${refTag}${rest}`);
            } else {
                processedLines.push(line);
            }
        } else {
            processedLines.push(line);
        }
    }

    let text = processedLines.join('\n');

    // Truncate if needed
    if (text.length > maxChars) {
        text = text.slice(0, maxChars) + '\n[... snapshot truncated due to size limit ...]';
    }

    if (!text.trim()) {
        text = 'No accessible elements found on this page.';
    }

    log.info(
        { url, refCount: refs.size, outputChars: text.length },
        'Snapshot captured'
    );

    return { text, refs, title, url };
}
