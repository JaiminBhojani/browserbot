import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'credential-vault' });

const VAULT_DIR = join(homedir(), '.browsbot', 'vault');
const ALGORITHM = 'aes-256-gcm';

/**
 * CredentialVault — stores usernames/passwords encrypted at rest.
 *
 * The encryption key is derived from a master secret (from config or
 * auto-generated on first run). Credentials are never stored in plain text.
 *
 * Usage: The agent asks the user for credentials once, stores them here,
 * and reuses them silently on future sessions.
 *
 * NOTE: Phase 3 will add per-credential TTL and hardware key support.
 */

export interface Credential {
    userId: string;
    domain: string;
    username: string;
    password: string;
    savedAt: number;
}

export class CredentialVault {
    private masterKey: Buffer | null = null;

    /** Must call this before using the vault */
    async init(secret?: string): Promise<void> {
        await fs.mkdir(VAULT_DIR, { recursive: true });

        // Derive a 32-byte key from the secret
        const secretStr = secret ?? await this.getOrCreateSecret();
        this.masterKey = scryptSync(secretStr, 'browsbot-salt', 32);

        log.info('Credential vault initialized');
    }

    private async getOrCreateSecret(): Promise<string> {
        const secretPath = join(VAULT_DIR, '.master');
        try {
            return await fs.readFile(secretPath, 'utf-8');
        } catch {
            // First run — generate and save a random secret
            const secret = randomBytes(32).toString('hex');
            await fs.writeFile(secretPath, secret, { mode: 0o600 }); // owner-only
            log.info('Generated new vault master secret');
            return secret;
        }
    }

    async save(userId: string, domain: string, username: string, password: string): Promise<void> {
        if (!this.masterKey) throw new Error('Vault not initialized');

        const credential: Credential = {
            userId, domain, username, password, savedAt: Date.now(),
        };

        const plaintext = JSON.stringify(credential);
        const iv = randomBytes(16);
        const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);

        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf-8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        const payload = JSON.stringify({
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            data: encrypted.toString('hex'),
        });

        await fs.writeFile(this.vaultPath(userId, domain), payload, { mode: 0o600 });
        log.info({ userId, domain, username }, 'Credential saved');
    }

    async get(userId: string, domain: string): Promise<Credential | null> {
        if (!this.masterKey) throw new Error('Vault not initialized');

        try {
            const raw = await fs.readFile(this.vaultPath(userId, domain), 'utf-8');
            const { iv, authTag, data } = JSON.parse(raw);

            const decipher = createDecipheriv(
                ALGORITHM,
                this.masterKey,
                Buffer.from(iv, 'hex')
            );
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));

            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(data, 'hex')),
                decipher.final(),
            ]);

            return JSON.parse(decrypted.toString('utf-8')) as Credential;
        } catch {
            return null;
        }
    }

    async delete(userId: string, domain: string): Promise<void> {
        try {
            await fs.unlink(this.vaultPath(userId, domain));
            log.info({ userId, domain }, 'Credential deleted');
        } catch { /* already gone */ }
    }

    async has(userId: string, domain: string): Promise<boolean> {
        try {
            await fs.access(this.vaultPath(userId, domain));
            return true;
        } catch {
            return false;
        }
    }

    private vaultPath(userId: string, domain: string): string {
        const safeUser = userId.replace(/[^a-zA-Z0-9]/g, '_');
        const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
        return join(VAULT_DIR, `${safeUser}_${safeDomain}.enc`);
    }
}

export const credentialVault = new CredentialVault();