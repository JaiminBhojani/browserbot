# 🕸️ BrowseBot

**AI-powered browser automation agent via WhatsApp.**

BrowseBot is a self-hosted AI assistant that receives instructions via WhatsApp, controls a real Chrome browser using Playwright, and reports results back. It can shop, read reviews, compare products, fill forms, and perform any web task you describe in natural language.

## Quick Start

### Prerequisites
- **Node.js** >= 22
- **pnpm** (install: `npm install -g pnpm`)
- **Anthropic API key** (for Claude AI)

### Setup

```bash
# Clone the repo
git clone https://github.com/yourusername/browsbot.git
cd browsbot

# Install dependencies
pnpm install

# Copy env template and add your API keys
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# Start in development mode
pnpm dev
```

On first start:
1. A QR code will appear in your terminal
2. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
3. Scan the QR code
4. Send a message to yourself — BrowseBot will reply!

### Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/status` | Bot status and uptime |
| `/ping` | Check if bot is alive |
| `/reset` | Reset conversation |

## Project Structure

```
src/
  index.ts              # Entry point
  gateway/              # Central server (HTTP + WebSocket)
  channels/             # Messaging platform adapters (WhatsApp, etc.)
  agent/                # AI brain (coming in Phase 3)
  browser/              # Playwright browser engine (coming in Phase 2)
  security/             # Approval pipeline, safety checks
  plugins/              # Plugin system
  hooks/                # Lifecycle event system
  config/               # Zod-validated configuration
  auto-reply/           # Message dispatch pipeline
  infra/                # Logger, database, utilities
```

## Architecture

BrowseBot follows a **gateway-centric modular monolith** pattern:

- **Gateway Server** — Single process owning all state (port 18789)
- **Channel Layer** — Platform adapters (WhatsApp via Baileys)
- **Agent Runtime** — AI think-act-observe loop (Phase 3)
- **Browser Engine** — Playwright-based Chrome automation (Phase 2)
- **Security Layer** — Action approval, payment guards
- **Plugin System** — npm-based extensions with lifecycle hooks

## Development

```bash
pnpm dev          # Start with live reload
pnpm build        # Production build
pnpm test         # Run tests
pnpm typecheck    # Type checking
```

## Configuration

Config file: `~/.browsbot/browsbot.json`

Environment variables override config values. See `.env.example` for all options.

## Development Phases

- [x] **Phase 1** — Foundation (Gateway, Config, WhatsApp, Echo Bot)
- [ ] **Phase 2** — Browser Engine (Playwright, Actions, Screenshots)
- [ ] **Phase 3** — Agent Brain (LLM Integration, Tool Dispatch)
- [ ] **Phase 4** — Intelligence (Vision, Review Analysis, Memory)
- [ ] **Phase 5** — Security (Approval Pipeline, Payment Guard)
- [ ] **Phase 6** — Extensibility (Plugins, Hooks, Web UI)

## License

MIT

```
browsbot
├─ package.json
├─ pnpm-lock.yaml
├─ README.md
├─ src
│  ├─ agent
│  │  ├─ memory
│  │  ├─ prompt
│  │  │  └─ templates
│  │  ├─ providers
│  │  ├─ runner
│  │  └─ tools
│  ├─ auto-reply
│  │  ├─ command-registry.ts
│  │  ├─ dispatch.test.ts
│  │  └─ dispatch.ts
│  ├─ browser
│  │  ├─ actions
│  │  ├─ pool
│  │  └─ vision
│  ├─ channels
│  │  ├─ base
│  │  │  ├─ channel-registry.ts
│  │  │  ├─ channel.interface.ts
│  │  │  └─ message.types.ts
│  │  └─ whatsapp
│  │     ├─ in-memory-store.ts
│  │     └─ whatsapp-adapter.ts
│  ├─ config
│  │  ├─ io.ts
│  │  ├─ schema.test.ts
│  │  └─ schema.ts
│  ├─ gateway
│  │  ├─ protocol
│  │  ├─ server-http.ts
│  │  ├─ server-ws.ts
│  │  └─ server.ts
│  ├─ hooks
│  │  ├─ bundled
│  │  ├─ hook-engine.test.ts
│  │  └─ hook-engine.ts
│  ├─ index.ts
│  ├─ infra
│  │  └─ logger.ts
│  ├─ plugins
│  ├─ security
│  └─ types
│     └─ vendor.d.ts
├─ test
│  ├─ e2e
│  └─ unit
├─ tsconfig.json
└─ vitest.config.ts

```