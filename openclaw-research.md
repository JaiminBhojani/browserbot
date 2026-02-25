# OpenClaw Deep Research: Browser Automation, Prompts & Images
## Implementation Plan for BrowseBot

---

## 1. Executive Summary

OpenClaw (196k★ GitHub) is the most battle-tested open-source AI assistant with browser automation. Their **key insight** that directly solves BrowseBot's 206K token overflow:

> **Use accessibility tree snapshots instead of raw page text + screenshots.**
> A text snapshot is ~100x smaller than a screenshot and far more actionable for an LLM.

OpenClaw's browser module has been extracted as a standalone library called **browserclaw** (`npm install browserclaw`), which we can directly integrate.

---

## 2. How OpenClaw Handles Browser Pages (The Snapshot System)

### 2.1 The Problem (Same as BrowseBot's)
- Flipkart's page text = ~200K+ characters → ~50K+ tokens
- Screenshot base64 = ~264KB → ~70K+ tokens
- Combined = 206K tokens → **exceeds Anthropic's 200K limit**

### 2.2 OpenClaw's Solution: ARIA Snapshots + Refs

Instead of sending raw `page.innerText()` + screenshots, OpenClaw uses Playwright's **accessibility tree snapshot**:

```
# What the LLM sees (compact, ~500 tokens for an entire page):
- heading "Flipkart" [level=1]
- search box "Search for products, brands and more" [ref=e1]
- button "Search" [ref=e2]  
- link "Login" [ref=e3]
- link "Become a Seller" [ref=e4]
- navigation "Categories"
  - link "Electronics" [ref=e5]
  - link "Mobiles" [ref=e6]
  - link "Fashion" [ref=e7]
```

**Key properties:**
- Each **interactive element** gets a numbered `ref` (e.g., `e1`, `e2`)
- The LLM says `click e1` → deterministic targeting via Playwright locator
- **No CSS selectors** — refs resolve to exact elements
- **No screenshots needed** for most interactions
- **~100x fewer tokens** than raw page text

### 2.3 Snapshot Modes

| Mode | Description | Token Usage |
|------|-------------|-------------|
| `--interactive` | Only interactive elements (buttons, links, inputs) | **Lowest** (~200-500 tokens) |
| `--compact` | Minimal tree structure | Low |
| `--efficient` | Preset: interactive + compact + depth limit | **Recommended default** |
| Full AI snapshot | Complete accessibility tree with all elements | Medium |
| Raw text (current BrowseBot) | `page.innerText()` | **Highest** (50K+ tokens) |

### 2.4 The Ref Lifecycle

```
1. Agent calls: browser_snapshot (mode: efficient)
2. Snapshot returns: list of elements with refs [e1, e2, e3...]
3. Agent decides: "I need to type in the search box"
4. Agent calls: browser_type(ref: "e1", text: "laptops under 50000")
5. ⚠️ Refs are NOW STALE (DOM changed)
6. Agent must re-snapshot before next action
```

**Critical rule:** Refs become invalid after ANY DOM change. Always re-snapshot after each action.

---

## 3. How OpenClaw Handles Images/Screenshots

### 3.1 Screenshots Are Secondary, Not Primary

OpenClaw's philosophy: **"direct code execution, not visual inference"**

- Screenshots are used only for **verification/debugging**, NOT for element targeting
- The snapshot text is the primary way the LLM "sees" the page
- This eliminates the massive token cost of base64 images

### 3.2 When Screenshots ARE Used

1. **Labeled screenshots** (`--labels`): Overlay ref numbers on a viewport screenshot
2. **Element screenshots** (`--ref 12`): Screenshot a specific element only
3. **Verification**: After actions, to confirm visual state

### 3.3 Image Resize Strategy

From OpenClaw's releases and issues:
- **Collapse resize diagnostics** to one line per image with visible pixel/byte size
- **Auto-resize large images** before sending to model
- Config options (from issue #8080):
  ```json
  {
    "tools": {
      "read": {
        "imageMaxBytes": 2097152,
        "imageMaxDimension": 1024,
        "imageQuality": 85
      }
    }
  }
  ```

---

## 4. How OpenClaw Manages Context/Prompts

### 4.1 Context Budget Architecture

OpenClaw tracks context in this hierarchy:
```
Total Context Window (e.g., 200K tokens)
├── System Prompt (~9,600 tokens)
│   ├── Rules + Identity
│   ├── Tool Schemas (~8,000 tokens)
│   ├── Skills List
│   └── Workspace files (AGENTS.md, SOUL.md, etc.)
├── Conversation History (grows over time)
│   ├── User messages
│   ├── Assistant messages
│   └── Tool call results ← THIS IS THE DANGER ZONE
└── Reserve (for model output)
```

### 4.2 Tool Output Truncation (Critical for BrowseBot)

From recent releases:
> "preemptively guard accumulated tool-result context before model calls by 
> **truncating oversized outputs** and **compacting oldest tool-result messages**
> to avoid context-window overflow crashes"

Strategy:
- **Scale output budget from model contextWindow** — larger context models get more per-tool output
- **Truncate oversized outputs** with markers: `[truncated: output exceeded context limit]`
- **Compact oldest tool results** with: `[compacted: tool output removed to free context]`
- **Guide the agent to recover** from truncated content by re-reading with smaller chunks

### 4.3 Bootstrap File Truncation

For large files injected into system prompt:
- **70/20/10 split**: 70% from head, 20% from tail, 10% for truncation marker
- **Per-file cap**: `bootstrapMaxChars` (default 20,000 chars)
- **Total cap**: `bootstrapTotalMaxChars` (default 150,000 chars)

### 4.4 Auto-Compaction

When context grows too large during tool loops:
```typescript
// Pseudocode from OpenClaw's run.ts
while (true) {
  const attempt = await runAttempt({ sessionId, prompt, model, tools });
  
  if (attempt.success) break;
  
  if (attempt.contextOverflow) {
    await compactSession(); // Summarize old messages
    continue;
  }
  
  break; // Other errors exit
}
```

**Proactive check** (from issue #24800):
```typescript
const currentTokens = attempt.usage?.input ?? 0;
const compactionThreshold = contextWindow - reserveTokensFloor;
if (currentTokens > compactionThreshold) {
  await compactSession();
}
```

---

## 5. Implementation Plan for BrowseBot

### Phase 1: Replace Page Reading with ARIA Snapshots (CRITICAL — fixes the 206K overflow)

#### 5A. Install browserclaw or implement snapshot directly

**Option A: Use browserclaw library** (recommended — battle-tested)
```bash
pnpm add browserclaw
```

**Option B: Implement with Playwright directly** (lighter, no extra dep)
```typescript
// src/browser/extraction/snapshot.ts
import type { Page } from 'playwright';

export interface SnapshotOptions {
  interactive?: boolean;  // Only interactive elements
  compact?: boolean;      // Minimal output
  maxDepth?: number;      // Tree depth limit
  maxChars?: number;      // Output character limit
}

export async function takeSnapshot(
  page: Page, 
  options: SnapshotOptions = {}
): Promise<{ text: string; refs: Map<string, any> }> {
  const { interactive = true, compact = true, maxDepth = 6, maxChars = 8000 } = options;
  
  // Use Playwright's built-in accessibility snapshot
  const snapshot = await page.accessibility.snapshot({ interestingOnly: interactive });
  
  const refs = new Map<string, any>();
  let refCounter = 0;
  let output = '';
  
  function walk(node: any, depth: number) {
    if (depth > maxDepth || output.length > maxChars) return;
    
    const indent = '  '.repeat(depth);
    const isInteractive = ['button', 'link', 'textbox', 'checkbox', 'combobox', 'menuitem']
      .includes(node.role);
    
    if (isInteractive || !compact) {
      const ref = isInteractive ? `e${++refCounter}` : null;
      if (ref) refs.set(ref, { role: node.role, name: node.name, node });
      
      const refStr = ref ? ` [ref=${ref}]` : '';
      const name = node.name ? ` "${node.name}"` : '';
      output += `${indent}- ${node.role}${name}${refStr}\n`;
    }
    
    if (node.children) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  }
  
  if (snapshot) walk(snapshot, 0);
  
  return { text: output || 'No interactive elements found on page.', refs };
}
```

#### 5B. Replace browser_read_page tool

```typescript
// Replace current extraction that returns page.innerText()
// with snapshot-based extraction

export async function browserReadPage(page: Page): Promise<string> {
  const { text } = await takeSnapshot(page, {
    interactive: true,
    compact: true,
    maxDepth: 6,
    maxChars: 8000  // ~2K tokens — safe for any model
  });
  
  // Also get the page title and URL for context
  const title = await page.title();
  const url = page.url();
  
  return `Page: ${title}\nURL: ${url}\n\nInteractive Elements:\n${text}`;
}
```

#### 5C. Implement ref-based actions

```typescript
// src/browser/actions/ref-actions.ts

// Store refs per-user context
const refStore = new Map<string, Map<string, any>>();

export async function clickRef(page: Page, userId: string, ref: string) {
  const refs = refStore.get(userId);
  if (!refs?.has(ref)) {
    throw new Error(`Ref ${ref} not found. Take a new snapshot first.`);
  }
  
  const { role, name } = refs.get(ref);
  // Use Playwright's getByRole for deterministic targeting
  await page.getByRole(role, { name }).click();
}

export async function typeRef(page: Page, userId: string, ref: string, text: string) {
  const refs = refStore.get(userId);
  if (!refs?.has(ref)) {
    throw new Error(`Ref ${ref} not found. Take a new snapshot first.`);
  }
  
  const { role, name } = refs.get(ref);
  await page.getByRole(role, { name }).fill(text);
}
```

### Phase 2: Screenshot Optimization

#### 2A. Resize before encoding

```typescript
// src/browser/vision/screenshot.ts
import sharp from 'sharp';  // pnpm add sharp

export async function takeOptimizedScreenshot(
  page: Page,
  options: {
    maxWidth?: number;
    quality?: number;
    format?: 'jpeg' | 'png';
  } = {}
): Promise<{ base64: string; sizeKb: number }> {
  const { maxWidth = 1024, quality = 60, format = 'jpeg' } = options;
  
  // Take screenshot as buffer
  const rawBuffer = await page.screenshot({ type: 'png' });
  
  // Resize and compress with sharp
  const optimized = await sharp(rawBuffer)
    .resize(maxWidth, null, { fit: 'inside', withoutEnlargement: true })
    .toFormat(format, { quality })
    .toBuffer();
  
  const base64 = optimized.toString('base64');
  const sizeKb = Math.round(optimized.length / 1024);
  
  return { base64, sizeKb };
}
```

#### 2B. Make screenshots optional (not automatic)

Current BrowseBot sends screenshot on every read. Change to:
- `browser_snapshot` → returns text only (default, cheap)
- `browser_screenshot` → returns image only (explicit, expensive)
- `browser_snapshot_with_labels` → returns image with ref overlays (advanced)

### Phase 3: Context Guard in Agent Loop

#### 3A. Token estimation

```typescript
// src/agent/context-guard.ts

// Rough: 1 token ≈ 4 chars for English
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// For base64 images: Anthropic charges ~1 token per 750 bytes
function estimateImageTokens(base64: string): number {
  const bytes = Buffer.from(base64, 'base64').length;
  return Math.ceil(bytes / 750);
}
```

#### 3B. Tool output truncation

```typescript
// src/agent/tool-output-guard.ts

const MAX_TOOL_OUTPUT_CHARS = 16_000; // ~4K tokens

export function truncateToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_CHARS) return output;
  
  // 70/20/10 split like OpenClaw
  const headSize = Math.floor(MAX_TOOL_OUTPUT_CHARS * 0.7);
  const tailSize = Math.floor(MAX_TOOL_OUTPUT_CHARS * 0.2);
  
  const head = output.slice(0, headSize);
  const tail = output.slice(-tailSize);
  
  return `${head}\n\n[... truncated ${output.length - headSize - tailSize} characters ...]\n\n${tail}`;
}
```

#### 3C. Proactive context check in agent loop

```typescript
// In your agent loop (src/agent/agent-loop.ts)

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-haiku-4-5-20251001': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'gemini-2.5-flash': 1_000_000,
};

const RESERVE_TOKENS = 30_000; // Leave room for model output

async function runAgentLoop(userId: string, message: string) {
  let contextTokens = 0;
  const maxTokens = MODEL_CONTEXT_LIMITS[model] ?? 200_000;
  const threshold = maxTokens - RESERVE_TOKENS;
  
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Estimate current context size before calling LLM
    contextTokens = estimateContextSize(messages);
    
    if (contextTokens > threshold) {
      // Compact: summarize older tool results
      messages = compactOldToolResults(messages);
      log.warn('Context approaching limit, compacted old tool results', {
        before: contextTokens,
        after: estimateContextSize(messages),
      });
    }
    
    try {
      const response = await llm.call(messages, tools);
      // ... handle response
    } catch (err) {
      if (isContextOverflow(err)) {
        // Emergency: remove screenshots from history
        messages = stripImagesFromHistory(messages);
        continue;
      }
      throw err;
    }
  }
}
```

### Phase 4: System Prompt Optimization

#### 4A. Browser-specific guidance

Add to your system prompt:
```
## Browser Automation Rules

1. ALWAYS use browser_snapshot first to see the page. This returns a compact 
   list of interactive elements with ref IDs.

2. Use refs for ALL interactions:
   - browser_click(ref: "e5") — NOT CSS selectors
   - browser_type(ref: "e1", text: "search query")

3. Refs become STALE after any action. Always re-snapshot after clicking, 
   typing, or navigating.

4. Only use browser_screenshot when you need to VERIFY visual layout. 
   The snapshot is your primary way to "see" the page.

5. Prefer simple, targeted searches:
   - Navigate directly to search URLs when possible
   - Example: https://www.flipkart.com/search?q=laptops+under+50000
   - This avoids needing to find and interact with search boxes
```

---

## 6. Updated Tool Definitions

Replace current 13 tools with this optimized set:

| Tool | Description | Token Cost |
|------|-------------|------------|
| `browser_navigate` | Go to URL | Low (returns title + URL) |
| `browser_snapshot` | Get interactive elements with refs | **Low (~500 tokens)** |
| `browser_click` | Click element by ref | Low |
| `browser_type` | Type into element by ref | Low |
| `browser_select` | Select dropdown option by ref | Low |
| `browser_scroll` | Scroll page up/down | Low |
| `browser_screenshot` | Take viewport screenshot (optional) | **High (~5K tokens)** |
| `browser_wait` | Wait for element/condition | Low |
| `browser_back` | Navigate back | Low |
| `browser_evaluate` | Run JS in page context | Medium |

**Removed/merged:**
- `browser_read_page` → replaced by `browser_snapshot`
- No more raw CSS selector-based actions

---

## 7. Migration Checklist

- [ ] Install `sharp` for image optimization: `pnpm add sharp`
- [ ] Implement `takeSnapshot()` using Playwright accessibility API
- [ ] Implement ref store per user context
- [ ] Replace `browser_read_page` with `browser_snapshot`  
- [ ] Replace CSS-selector actions with ref-based actions
- [ ] Add screenshot optimization (resize to 1024px, JPEG quality 60)
- [ ] Add tool output truncation (max 16K chars per tool result)
- [ ] Add proactive context guard in agent loop
- [ ] Update system prompt with browser automation rules
- [ ] Update tool definitions (remove CSS selector params, add ref params)
- [ ] Test with Flipkart search flow end-to-end

---

## 8. Expected Impact

| Metric | Before (Current) | After (OpenClaw-style) |
|--------|-------------------|------------------------|
| Page read tokens | 50K+ | ~500 |
| Screenshot tokens | 70K+ | ~5K (compressed) or 0 (skip) |
| Total per-iteration | 120K+ | ~1-5K |
| Context overflow risk | **Very High** | **Very Low** |
| Action accuracy | Low (brittle CSS selectors) | High (deterministic refs) |
| Actions per session | ~4 before overflow | 50+ comfortably |

The snapshot approach is a **100x improvement** in token efficiency.
