import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { configSchema, type BrowsBotConfig } from './schema.js';
import { createChildLogger } from '../infra/logger.js';

const log = createChildLogger('config');

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.browsbot');
const DEFAULT_CONFIG_FILE = 'browsbot.json';

/**
 * Expand ~ and ${ENV_VAR} in string values throughout the config.
 */
function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Expand ~ to home directory
    let result = obj.replace(/^~/, os.homedir());
    // Expand ${ENV_VAR} patterns
    result = result.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      return process.env[key] || '';
    });
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const expanded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      expanded[key] = expandEnvVars(value);
    }
    return expanded;
  }
  return obj;
}

/**
 * Ensure the config directory exists.
 */
function ensureConfigDir(configDir: string): void {
  const expanded = configDir.replace(/^~/, os.homedir());
  if (!fs.existsSync(expanded)) {
    fs.mkdirSync(expanded, { recursive: true });
    log.info(`Created config directory: ${expanded}`);
  }
}

/**
 * Load config from file, validate with Zod, expand env vars.
 * If no config file exists, creates one with defaults.
 */
export function loadConfig(configPath?: string): BrowsBotConfig {
  const configDir = DEFAULT_CONFIG_DIR.replace(/^~/, os.homedir());
  const filePath = configPath || path.join(configDir, DEFAULT_CONFIG_FILE);

  ensureConfigDir(configDir);

  let rawConfig: Record<string, unknown> = {};

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      rawConfig = JSON.parse(content);
      log.info(`Loaded config from ${filePath}`);
    } catch (err) {
      log.error({ err }, `Failed to read config file: ${filePath}`);
      throw new Error(`Invalid config file: ${filePath}`);
    }
  } else {
    log.info('No config file found, using defaults');
    // Create default config file
    saveConfig(configSchema.parse({}), filePath);
  }

  // Merge with environment variables for common overrides
  applyEnvOverrides(rawConfig);

  // Expand environment variable references in values
  const expanded = expandEnvVars(rawConfig) as Record<string, unknown>;

  // Validate with Zod
  const result = configSchema.safeParse(expanded);

  if (!result.success) {
    log.error({ errors: result.error.issues }, 'Config validation failed');
    throw new Error(`Config validation failed: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Helper to ensure a nested object exists at a given key.
 */
function ensureObject(obj: Record<string, unknown>, key: string, defaults: Record<string, unknown> = {}): Record<string, unknown> {
  if (!obj[key] || typeof obj[key] !== 'object') {
    obj[key] = { ...defaults };
  }
  return obj[key] as Record<string, unknown>;
}

/**
 * Apply environment variable overrides to raw config.
 */
function applyEnvOverrides(config: Record<string, unknown>): void {
  const env = process.env;

  // Gateway
  if (env.BROWSBOT_PORT) {
    const gateway = ensureObject(config, 'gateway');
    gateway.port = parseInt(env.BROWSBOT_PORT, 10);
  }
  if (env.BROWSBOT_AUTH_TOKEN) {
    const gateway = ensureObject(config, 'gateway');
    const auth = ensureObject(gateway, 'auth');
    auth.token = env.BROWSBOT_AUTH_TOKEN;
  }

  // Providers
  if (env.ANTHROPIC_API_KEY) {
    const providers = ensureObject(config, 'providers');
    const primary = ensureObject(providers, 'primary', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });
    primary.apiKey = env.ANTHROPIC_API_KEY;
  }

  // WhatsApp
  if (env.WHATSAPP_ENABLED) {
    const channels = ensureObject(config, 'channels');
    const whatsapp = ensureObject(channels, 'whatsapp');
    whatsapp.enabled = env.WHATSAPP_ENABLED === 'true';
  }

  // Browser
  if (env.BROWSER_HEADLESS) {
    const browser = ensureObject(config, 'browser');
    browser.headless = env.BROWSER_HEADLESS === 'true';
  }
}

/**
 * Save config to file.
 */
export function saveConfig(config: BrowsBotConfig, configPath?: string): void {
  const configDir = DEFAULT_CONFIG_DIR.replace(/^~/, os.homedir());
  const filePath = configPath || path.join(configDir, DEFAULT_CONFIG_FILE);

  ensureConfigDir(configDir);

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  log.info(`Config saved to ${filePath}`);
}

/**
 * Get the config directory path (expanded).
 */
export function getConfigDir(): string {
  return DEFAULT_CONFIG_DIR.replace(/^~/, os.homedir());
}