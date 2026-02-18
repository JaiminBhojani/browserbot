import type { UnifiedMessage, OutboundMessage, ChannelType } from './message.types.js';

/**
 * Abstract Channel interface — every platform adapter must implement this.
 * This is the contract between the Gateway and any messaging platform.
 */
export interface Channel {
  /** Channel type identifier */
  readonly type: ChannelType;

  /** Human-readable name */
  readonly name: string;

  /** Whether this channel is currently connected */
  readonly isConnected: boolean;

  /**
   * Initialize and connect the channel.
   * For WhatsApp: starts Baileys, shows QR code.
   * For Telegram: connects to Bot API.
   */
  connect(): Promise<void>;

  /**
   * Disconnect and clean up.
   */
  disconnect(): Promise<void>;

  /**
   * Send a message through this channel.
   */
  sendMessage(message: OutboundMessage): Promise<void>;

  /**
   * Register a handler for incoming messages.
   * The Channel Manager will set this up during initialization.
   */
  onMessage(handler: (message: UnifiedMessage) => Promise<void>): void;
}
