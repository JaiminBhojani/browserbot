import { z } from 'zod';

// --- Gateway Config ---
const gatewaySchema = z.object({
  port: z.number().default(18789),
  host: z.string().default('0.0.0.0'),
  auth: z.object({
    token: z.string().default('change-me'),
  }).default({}),
});

// --- AI Provider Config ---
const providerSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'ollama', 'google']),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

const providersSchema = z.object({
  primary: providerSchema.default({
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  }),
  fallback: providerSchema.optional(),
}).default({});

// --- Browser Config ---
const browserSchema = z.object({
  headless: z.boolean().default(true),
  maxContexts: z.number().min(1).max(20).default(5),
  defaultTimeout: z.number().default(30000),
  screenshotQuality: z.number().min(10).max(100).default(80),
  stealth: z.boolean().default(true),
  userDataDir: z.string().default('~/.browsbot/browser-data'),
}).default({});

// --- Channel Configs ---
const whatsappSchema = z.object({
  enabled: z.boolean().default(true),
  allowedNumbers: z.array(z.string()).default([]),
  sessionDir: z.string().default('~/.browsbot/whatsapp-session'),
}).default({});

const channelsSchema = z.object({
  whatsapp: whatsappSchema,
}).default({});

// --- Security Config ---
const securitySchema = z.object({
  approvalRequired: z.array(z.string()).default(['payment', 'login', 'form_submit']),
  blockedDomains: z.array(z.string()).default([]),
  maxActionsPerRequest: z.number().default(25),
  approvalTimeout: z.number().default(300), // seconds
}).default({});

// --- Memory Config ---
const memorySchema = z.object({
  enabled: z.boolean().default(true),
  dbPath: z.string().default('~/.browsbot/memory.db'),
  maxHistory: z.number().default(100),
}).default({});

// --- Plugin Config ---
const pluginsSchema = z.object({
  autoEnable: z.boolean().default(true),
  directory: z.string().default('~/.browsbot/plugins'),
}).default({});

// --- Root Config Schema ---
export const configSchema = z.object({
  gateway: gatewaySchema.default({}),
  providers: providersSchema,
  browser: browserSchema,
  channels: channelsSchema,
  security: securitySchema,
  memory: memorySchema,
  plugins: pluginsSchema,
});

export type BrowsBotConfig = z.infer<typeof configSchema>;
export type GatewayConfig = z.infer<typeof gatewaySchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
export type BrowserConfig = z.infer<typeof browserSchema>;
export type WhatsAppConfig = z.infer<typeof whatsappSchema>;
export type SecurityConfig = z.infer<typeof securitySchema>;
