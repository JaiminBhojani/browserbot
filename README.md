<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Playwright-1.58-2EAD33?logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License" />
</p>

# 🕸️ BrowseBot — AI-Powered Browser Automation via WhatsApp

> **Control a real Chrome browser with natural language — right from WhatsApp.**

BrowseBot is a **self-hosted AI assistant** that receives instructions via WhatsApp, automates a real Chrome browser using [Playwright](https://playwright.dev/), and reports results back to you. It can shop, read reviews, compare products, fill forms, capture screenshots, and perform any web task you describe in plain English.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 💬 **WhatsApp Control** | Send natural-language instructions from WhatsApp; get results back instantly |
| 🌐 **Real Browser Automation** | Powered by Playwright — clicks, types, scrolls, navigates real Chrome pages |
| 🤖 **Multi-Provider AI** | Supports **Anthropic Claude**, **Google Gemini**, and **Groq** as AI backends |
| 📸 **Screenshots & Extraction** | Capture viewport/full-page screenshots and extract prices, reviews, or DOM content |
| 🔀 **Multi-Tab Browsing** | Open, switch, and close browser tabs — just like you would |
| 🔑 **Credential Vault** | Securely store and recall site credentials for login flows |
| 🍪 **Cookie Persistence** | Maintain sessions across tasks with automatic cookie storage |
| ⚙️ **Gateway Architecture** | Single-process gateway server with HTTP + WebSocket support |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 22
- **pnpm** — install via `npm install -g pnpm`
- An **AI provider API key** (Anthropic / Google / Groq — at least one)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/JaiminBhojani/browserbot.git
cd browserbot

# 2. Install dependencies
pnpm install

# 3. Configure environment variables
cp .env.example .env
# Open .env and fill in your API keys (see Configuration section below)

# 4. Start the development server
pnpm dev
```

### First Run — Connect WhatsApp

1. A **QR code** will appear in your terminal.
2. Open **WhatsApp** on your phone → **Settings** → **Linked Devices** → **Link a Device**.
3. Scan the QR code.
4. Send a message to yourself — **BrowseBot will reply!** 🎉

---

## 💬 WhatsApp Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/status` | Display bot status and uptime |
| `/ping` | Check if the bot is responsive |
| `/reset` | Reset the current conversation |

For everything else, just type naturally: *"Go to Amazon and find the best laptop under ₹50,000"*.

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file from the template and configure:

```env
# Gateway
BROWSBOT_PORT=18789
BROWSBOT_AUTH_TOKEN=change-me-to-a-secret-token

# AI Providers (set at least one)
ANTHROPIC_API_KEY=your-anthropic-api-key
OPENAI_API_KEY=your-openai-api-key

# WhatsApp
WHATSAPP_ENABLED=true
WHATSAPP_ALLOWED_NUMBERS=+91XXXXXXXXXX

# Browser
BROWSER_HEADLESS=true
BROWSER_MAX_CONTEXTS=5

# Logging
LOG_LEVEL=info
```

### Config File

You can also use a JSON config file at `~/.browsbot/browsbot.json`. Environment variables take precedence over the config file.

---

## 🏗️ Architecture

BrowseBot follows a **gateway-centric modular monolith** design:

```
┌────────────────────────────────────────────────────┐
│                  Gateway Server                     │
│              (HTTP + WebSocket :18789)               │
├──────────┬──────────┬──────────┬───────────────────┤
│ Channel  │  Agent   │ Browser  │    Security       │
│  Layer   │  Brain   │  Engine  │     Layer         │
│          │          │          │                   │
│ WhatsApp │ Claude   │Playwright│  (coming soon)    │
│ (Baileys)│ Gemini   │ Actions  │                   │
│          │ Groq     │ Vision   │                   │
├──────────┴──────────┴──────────┴───────────────────┤
│    Config (Zod)  │  Hooks  │  Logger (Pino)        │
└──────────────────┴─────────┴───────────────────────┘
```

### Core Subsystems

- **Gateway Server** — Single process managing all state, serving HTTP endpoints and WebSocket connections on port `18789`
- **Channel Layer** — Platform adapters (currently WhatsApp via [Baileys](https://github.com/WhiskeySockets/Baileys)) with a registry pattern for future channels
- **Agent Brain** — AI think-act-observe loop with a provider abstraction supporting Anthropic Claude, Google Gemini, and Groq
- **Browser Engine** — Playwright-based Chrome automation with browser pooling, context isolation, lifecycle management, and 13 built-in tools
- **Auto-Reply / Dispatch** — Message routing pipeline with a command registry for slash commands
- **Hook Engine** — Lifecycle event system for extensible startup/shutdown/message hooks
- **Config** — Zod-validated configuration with env var overrides

---

## 🔧 Browser Engine — What's Inside

The Browser Engine (Phase 2) provides a rich set of automation primitives:

### 13 Built-in Browser Tools

| Tool | What It Does |
|------|-------------|
| `browser_navigate` | Navigate to any URL with configurable wait strategies |
| `browser_click` | Click elements by CSS selector or `(x, y)` coordinates |
| `browser_type` | Type text into input fields with optional clear |
| `browser_scroll` | Scroll pages or specific containers up/down |
| `browser_select` | Select dropdown options by value or label |
| `browser_wait` | Wait for elements or a fixed delay |
| `browser_back` | Go back in browser history |
| `browser_screenshot` | Capture viewport or full-page screenshots |
| `browser_extract` | Extract prices, reviews, or raw DOM content |
| `browser_read_page` | Get the full readable text of a page |
| `browser_tab_new` | Open a new browser tab |
| `browser_tab_switch` | Switch between open tabs |
| `browser_tab_close` | Close the current tab |

### Supporting Infrastructure

- **Browser Pool** — Shared Playwright browser instance with configurable headless mode
- **Context Manager** — Per-user isolated browser contexts with session persistence
- **Lifecycle Manager** — Automatic idle timeout and context limits to manage resources
- **Tab Manager & Router** — Multi-tab support with active tab tracking
- **Cookie Store** — Persistent cookie storage per user via SQLite
- **Credential Vault** — Encrypted credential storage for site logins
- **Content Extraction** — Structured data extraction (prices, reviews, DOM)
- **Screenshot Capture** — Viewport, full-page, and element-level screenshots

---

## 📁 Project Structure

```
src/
├── index.ts                 # Application entry point
├── gateway/                 # Central server (HTTP + WebSocket)
│   ├── server.ts            # Gateway orchestration & startup
│   ├── server-http.ts       # Express HTTP routes
│   └── server-ws.ts         # WebSocket server
├── channels/                # Messaging platform adapters
│   ├── base/                # Channel interface & types
│   └── whatsapp/            # WhatsApp adapter (Baileys)
├── agent/                   # AI brain
│   ├── providers/           # LLM provider adapters (Claude, Gemini, Groq)
│   ├── runner/              # Agent loop (think → act → observe)
│   ├── prompt/              # System prompt templates
│   └── tools/               # Agent ↔ Browser tool bridge
├── browser/                 # Playwright browser engine
│   ├── actions/             # Core actions (click, type, scroll, navigate)
│   ├── pool/                # Browser pool, context manager, lifecycle
│   ├── tabs/                # Tab manager, router, cookie store
│   ├── auth/                # Credential vault
│   ├── extraction/          # Content & data extraction
│   ├── vision/              # Screenshot capture
│   └── tools/               # 13 browser tools for the agent
├── auto-reply/              # Message dispatch pipeline
├── hooks/                   # Lifecycle hook engine
├── config/                  # Zod-validated configuration
├── infra/                   # Logger (Pino), utilities
├── plugins/                 # Plugin system (planned)
├── security/                # Security layer (planned)
└── types/                   # TypeScript declarations
```

---

## 🛠️ Development

```bash
pnpm dev          # Start with live reload (tsx watch)
pnpm build        # Production build (tsdown)
pnpm start        # Run production build
pnpm test         # Run test suite (Vitest)
pnpm test:watch   # Run tests in watch mode
pnpm lint         # Lint source code (oxlint)
pnpm typecheck    # TypeScript type checking
```

---

## 📋 Development Roadmap

- [x] **Phase 1** — Foundation *(completed)*
  - Gateway server (HTTP + WebSocket)
  - Zod-validated configuration
  - WhatsApp channel via Baileys
  - Command registry & message dispatch
  - Hook engine & lifecycle events
- [/] **Phase 2** — Browser Engine *(in progress)*
  - Playwright browser pool & context isolation
  - 13 browser tools (navigate, click, type, scroll, select, wait, back, screenshot, extract, read page, tabs)
  - Tab management & cookie persistence
  - Credential vault & content extraction
  - *Remaining: end-to-end integration testing, error recovery, proxy support*
- [/] **Phase 3** — Agent Brain *(in progress)*
  - Multi-provider LLM integration (Anthropic, Google, Groq)
  - Agent loop (think → act → observe cycle)
  - Prompt templates & tool dispatch
  - *Remaining: conversation memory, advanced planning, multi-step task orchestration*
- [ ] **Phase 4** — Intelligence
  - Vision-based page understanding
  - Review analysis & comparison
  - Persistent memory across sessions
- [ ] **Phase 5** — Security
  - Action approval pipeline
  - Payment & transaction guards
  - Rate limiting & sandboxing
- [ ] **Phase 6** — Extensibility
  - npm-based plugin system
  - Custom hooks & event handlers
  - Web-based dashboard UI

---

## 🧰 Tech Stack

| Category | Technology |
|----------|-----------|
| **Runtime** | Node.js 22+ |
| **Language** | TypeScript 5.7 |
| **Browser Automation** | Playwright |
| **WhatsApp** | @whiskeysockets/baileys |
| **AI Providers** | Anthropic SDK, Google Generative AI, OpenAI SDK |
| **Web Server** | Express 5 |
| **WebSocket** | ws |
| **Validation** | Zod |
| **Database** | better-sqlite3 |
| **Logging** | Pino + pino-pretty |
| **Build** | tsdown |
| **Testing** | Vitest |
| **Linting** | oxlint |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m "feat: add amazing feature"`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/JaiminBhojani">Jaimin Bhojani</a>
</p>