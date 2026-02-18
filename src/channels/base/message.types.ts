/**
 * Unified message format — every channel adapter translates
 * platform-specific messages into this format.
 */
export interface UnifiedMessage {
  /** Unique message ID */
  id: string;

  /** Which platform this message came from */
  channelType: ChannelType;

  /** Platform-specific channel identifier (e.g., WhatsApp phone, Slack channel ID) */
  channelId: string;

  /** Sender identifier */
  senderId: string;

  /** Human-readable sender name */
  senderName: string;

  /** Message content */
  content: MessageContent;

  /** ID of message being replied to, if any */
  replyTo?: string;

  /** Unix timestamp in milliseconds */
  timestamp: number;

  /** Whether this is from a group chat */
  isGroup: boolean;

  /** Group ID if applicable */
  groupId?: string;

  /** Platform-specific metadata */
  metadata: Record<string, unknown>;
}

export interface MessageContent {
  text?: string;
  images?: MessageMedia[];
  documents?: MessageMedia[];
  audio?: MessageMedia[];
  video?: MessageMedia[];
}

export interface MessageMedia {
  buffer: Buffer;
  mimetype: string;
  filename?: string;
  caption?: string;
}

export type ChannelType = 'whatsapp' | 'telegram' | 'slack' | 'discord' | 'webchat';

/**
 * Outbound message — what the system sends back to channels.
 */
export interface OutboundMessage {
  /** Target channel type */
  channelType: ChannelType;

  /** Target channel/chat ID */
  channelId: string;

  /** Text content */
  text?: string;

  /** Image to attach */
  image?: Buffer;

  /** Reply to a specific message */
  replyTo?: string;

  /** Platform-specific options */
  options?: Record<string, unknown>;
}
