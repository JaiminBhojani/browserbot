import { LLMProvider, LLMProviderConfig } from './base.js';
import { AnthropicProvider } from './anthropic.js';
import { GroqProvider } from './groq.js';
import { GoogleProvider } from './google.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'provider-factory' });

export type ProviderName = 'anthropic' | 'groq' | 'openai' | 'google';

/**
 * ProviderFactory — creates the right LLMProvider from config.
 *
 * To add a new provider:
 *   1. Create src/agent/providers/myprovider.ts implementing LLMProvider
 *   2. Import it here and add a case in createProvider()
 *   3. Add it to browsbot.json as fallback, fallback2, fallback3...
 *   Zero other files need to change.
 */
export function createProvider(
    providerName: ProviderName | string,
    config: LLMProviderConfig
): LLMProvider {
    log.info({ provider: providerName, model: config.model }, 'Creating LLM provider');

    switch (providerName) {
        case 'anthropic':
            return new AnthropicProvider(config);

        case 'groq':
            return new GroqProvider(config);

        case 'google':
            return new GoogleProvider(config);

        case 'openai':
            throw new Error(
                'OpenAI provider not yet implemented. Create src/agent/providers/openai.ts'
            );

        default:
            throw new Error(
                `Unknown provider: "${providerName}". ` +
                `Check your browsbot.json providers config.`
            );
    }
}

/**
 * createProviderFromConfig — reads BrowsBotConfig providers section
 * and creates the full provider chain: primary + all fallbacks.
 *
 * Config supports unlimited fallbacks via fallback, fallback2, fallback3...
 * Example browsbot.json:
 * {
 *   "providers": {
 *     "primary":   { "provider": "google",    "model": "gemini-2.5-flash" },
 *     "fallback":  { "provider": "anthropic", "model": "claude-haiku-4-5-20251001" },
 *     "fallback2": { "provider": "groq",      "model": "llama-3.3-70b-versatile" }
 *   }
 * }
 */
export function createProviderFromConfig(config: {
    providers: {
        primary: { provider: string; model: string; apiKey?: string };
        fallback?: { provider: string; model: string; apiKey?: string };
        fallback2?: { provider: string; model: string; apiKey?: string };
        [key: string]: { provider: string; model: string; apiKey?: string } | undefined;
    };
}): { primary: LLMProvider; fallbacks: LLMProvider[] } {
    // ── Primary ──────────────────────────────────────────────────────────────
    const primaryApiKey =
        config.providers.primary.apiKey ??
        getEnvKey(config.providers.primary.provider);

    if (!primaryApiKey) {
        throw new Error(
            `No API key for primary provider "${config.providers.primary.provider}". ` +
            `Set providers.primary.apiKey in browsbot.json or ` +
            `${getEnvVarName(config.providers.primary.provider)} env var.`
        );
    }

    const primary = createProvider(config.providers.primary.provider, {
        apiKey: primaryApiKey,
        model: config.providers.primary.model,
    });

    // ── Fallback chain: fallback, fallback2, fallback3, ... ──────────────────
    const fallbackKeys = Object.keys(config.providers)
        .filter((k) => k === 'fallback' || k.match(/^fallback\d+$/))
        .sort(); // fallback, fallback2, fallback3 in order

    const fallbacks: LLMProvider[] = [];

    for (const key of fallbackKeys) {
        const fb = config.providers[key];
        if (!fb) continue;

        const fbKey = fb.apiKey ?? getEnvKey(fb.provider);
        if (!fbKey) {
            log.warn(
                { provider: fb.provider, key },
                `No API key for fallback provider — skipping`
            );
            continue;
        }

        try {
            const fbProvider = createProvider(fb.provider, {
                apiKey: fbKey,
                model: fb.model,
            });
            fallbacks.push(fbProvider);
            log.info({ provider: fb.provider, key }, 'Fallback provider ready');
        } catch (err: any) {
            log.warn({ provider: fb.provider, error: err.message }, 'Fallback provider failed to initialize');
        }
    }

    return { primary, fallbacks };
}

/** Map provider name → env var name */
function getEnvKey(provider: string): string | undefined {
    const envVar = getEnvVarName(provider);
    return envVar ? process.env[envVar] : undefined;
}

function getEnvVarName(provider: string): string {
    const envMap: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        groq: 'GROQ_API_KEY',
        openai: 'OPENAI_API_KEY',
        google: 'GOOGLE_API_KEY',
    };
    return envMap[provider] ?? '';
}