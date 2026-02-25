import makeWASocket, {
  // makeInMemoryStore,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys';
import { makeInMemoryStore } from './in-memory-store.js';
import P from 'pino';
import QRCode from 'qrcode-terminal';
import fs from 'node:fs';
import os from 'node:os';
import type { Channel } from '../base/channel.interface.js';
import type { UnifiedMessage, OutboundMessage, MessageContent } from '../base/message.types.js';
import type { WhatsAppConfig } from '../../config/schema.js';
import { createChildLogger } from '../../infra/logger.js';

const log = createChildLogger('whatsapp');

type WASocket = ReturnType<typeof makeWASocket>;

// Silent logger to suppress Baileys internal noise
const silentLogger = P({ level: 'silent', enabled: false }) as any;

export class WhatsAppChannel implements Channel {
  readonly type = 'whatsapp' as const;
  readonly name = 'WhatsApp';

  private socket: WASocket | null = null;
  private messageHandler: ((message: UnifiedMessage) => Promise<void>) | null = null;
  private _isConnected = false;
  private config: WhatsAppConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    const sessionDir = this.config.sessionDir.replace(/^~/, os.homedir());

    // Ensure session directory exists
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Fetch the latest WA web version to avoid protocol mismatch errors
    let version: any;
    try {
      const versionInfo = await fetchLatestBaileysVersion();
      version = versionInfo.version;
      log.info({ version: version.join('.') }, 'Using WhatsApp Web version');
    } catch (err) {
      log.warn({ err }, 'Could not fetch latest version, using default');
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    // Create store for message history (in-memory)
    const store = makeInMemoryStore({ logger: silentLogger });

    // Build socket config
    const socketConfig: any = {
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      // printQRInTerminal is deprecated in v7, we handle QR manually      logger: silentLogger,
      browser: Browsers.ubuntu('BrowseBot'),
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    };

    if (version) {
      socketConfig.version = version;
    }

    this.socket = makeWASocket(socketConfig);

    // Bind store to socket events
    store.bind(this.socket.ev);

    // Handle connection updates
    this.socket.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('');
        console.log('========================================');
        console.log('  SCAN THIS QR CODE WITH WHATSAPP');
        console.log('  Phone > Settings > Linked Devices');
        console.log('========================================');
        console.log('');
        QRCode.generate(qr, { small: true });
        console.log('');
      }

      if (connection === 'close') {
        this._isConnected = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        log.warn({ statusCode }, 'WhatsApp connection closed');

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = 3000 * this.reconnectAttempts;
          log.info(`Reconnecting in ${delay / 1000}s... attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          setTimeout(() => this.connect(), delay);
        } else if (!shouldReconnect) {
          log.error('Logged out from WhatsApp. Deleting session — please re-scan QR code.');
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } else {
          log.error('Max reconnect attempts reached. Please restart the bot.');
        }
      }

      if (connection === 'open') {
        this._isConnected = true;
        this.reconnectAttempts = 0;
        log.info('WhatsApp connected successfully!');
      }
    });

    // Save credentials on update
    this.socket.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    this.socket.ev.on('messages.upsert', async (event: any) => {
      log.info({ type: event.type, count: event.messages?.length }, 'messages.upsert received');

      if (event.type !== 'notify') {
        log.debug({ type: event.type }, 'Skipping non-notify upsert');
        return;
      }

      for (const msg of event.messages) {
        log.info({ fromMe: msg.key.fromMe, remoteJid: msg.key.remoteJid, id: msg.key.id }, 'Processing message');

        // ── FILTERS ──────────────────────────────────────────────────────────
        // Skip our own sent messages
        if (msg.key.fromMe) {
          log.debug('Skipping own message');
          continue;
        }

        // Skip WhatsApp Status updates (remoteJid is exactly 'status@broadcast')
        if (msg.key.remoteJid === 'status@broadcast') {
          log.debug('Skipping status broadcast');
          continue;
        }

        // Skip any other broadcast lists (remoteJid ends with '@broadcast')
        if (msg.key.remoteJid?.endsWith('@broadcast')) {
          log.debug({ remoteJid: msg.key.remoteJid }, 'Skipping broadcast list message');
          continue;
        }

        // Skip messages with no remoteJid at all (malformed)
        if (!msg.key.remoteJid) {
          log.debug('Skipping message with no remoteJid');
          continue;
        }
        // ─────────────────────────────────────────────────────────────────────

        if (!this.messageHandler) {
          log.warn('No message handler registered!');
          continue;
        }

        try {
          const unified = this.toUnifiedMessage(msg);
          if (!unified) {
            log.debug('Message converted to null, skipping');
            continue;
          }

          // Check allowlist
          if (this.config.allowedNumbers.length > 0) {
            const senderNumber = unified.senderId
              .replace('@s.whatsapp.net', '')
              .replace('@g.us', '');
            const isAllowed = this.config.allowedNumbers.some(
              (num) => senderNumber.includes(num.replace('+', ''))
            );
            if (!isAllowed) {
              log.warn({ senderNumber }, 'Blocked by allowlist');
              continue;
            }
          }

          log.info({ sender: unified.senderName, text: unified.content.text?.slice(0, 50) }, 'Dispatching message');
          await this.messageHandler(unified);
        } catch (err) {
          log.error({ err, msgId: msg.key.id }, 'Error processing WhatsApp message');
        }
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
      this._isConnected = false;
      log.info('WhatsApp disconnected');
    }
  }

  onMessage(handler: (message: UnifiedMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.socket || !this._isConnected) {
      log.warn('Cannot send message — WhatsApp not connected');
      return;
    }

    const jid = message.channelId;

    try {
      if (message.image) {
        await this.socket.sendMessage(jid, {
          image: message.image,
          caption: message.text || '',
        });
      } else if (message.text) {
        await this.socket.sendMessage(jid, { text: message.text });
      }

      log.debug({ jid }, 'Message sent');
    } catch (err) {
      log.error({ err, jid }, 'Failed to send WhatsApp message');
      throw err;
    }
  }

  /**
   * Convert a Baileys message to our UnifiedMessage format.
   */
  private toUnifiedMessage(msg: any): UnifiedMessage | null {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return null;

    const isGroup = remoteJid.endsWith('@g.us');
    const senderId = isGroup ? (msg.key.participant || remoteJid) : remoteJid;

    const textContent =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    if (!textContent && !msg.message?.imageMessage && !msg.message?.documentMessage) {
      return null;
    }

    const content: MessageContent = {
      text: textContent || undefined,
    };

    const senderName = msg.pushName || senderId.split('@')[0];

    return {
      id: msg.key.id || `wa-${Date.now()}`,
      channelType: 'whatsapp',
      channelId: remoteJid,
      senderId,
      senderName,
      content,
      replyTo: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || undefined,
      timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
      isGroup,
      groupId: isGroup ? remoteJid : undefined,
      metadata: {
        pushName: msg.pushName,
        rawKey: msg.key,
      },
    };
  }
}