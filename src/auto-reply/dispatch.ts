import type { UnifiedMessage, OutboundMessage } from '../channels/base/message.types.js';
import type { ChannelRegistry } from '../channels/base/channel-registry.js';
import type { HookEngine } from '../hooks/hook-engine.js';
import { createChildLogger } from '../infra/logger.js';

const log = createChildLogger('dispatch');

/**
 * Maximum characters per WhatsApp message.
 */
const WHATSAPP_CHAR_LIMIT = 4096;

/**
 * Split a long message into platform-sized chunks.
 * Tries to split at paragraph breaks, then sentence breaks, then word breaks.
 */
export function chunkMessage(text: string, maxLength = WHATSAPP_CHAR_LIMIT): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good break point
    let breakPoint = -1;

    // Try paragraph break
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphBreak > maxLength * 0.3) {
      breakPoint = paragraphBreak;
    }

    // Try line break
    if (breakPoint === -1) {
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * 0.3) {
        breakPoint = lineBreak;
      }
    }

    // Try sentence break
    if (breakPoint === -1) {
      const sentenceBreak = remaining.lastIndexOf('. ', maxLength);
      if (sentenceBreak > maxLength * 0.3) {
        breakPoint = sentenceBreak + 1;
      }
    }

    // Try space
    if (breakPoint === -1) {
      const spaceBreak = remaining.lastIndexOf(' ', maxLength);
      if (spaceBreak > maxLength * 0.3) {
        breakPoint = spaceBreak;
      }
    }

    // Hard break as last resort
    if (breakPoint === -1) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks;
}

/**
 * Checks if a message is a /slash command.
 */
export function isCommand(text: string): boolean {
  return text.trim().startsWith('/');
}

/**
 * Parse a /slash command.
 */
export function parseCommand(text: string): { command: string; args: string } {
  const trimmed = text.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: '' };
  }
  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

export interface DispatchOptions {
  channelRegistry: ChannelRegistry;
  hookEngine: HookEngine;
  onAgentMessage: (message: UnifiedMessage) => Promise<string>;
  onCommand: (command: string, args: string, message: UnifiedMessage) => Promise<string>;
}

/**
 * The main dispatch function — routes inbound messages to the right handler.
 * This is the message processing pipeline entry point.
 */
export async function dispatch(
  message: UnifiedMessage,
  options: DispatchOptions
): Promise<void> {
  const { channelRegistry, hookEngine, onAgentMessage, onCommand } = options;

  log.info(
    { sender: message.senderName, channel: message.channelType, text: message.content.text?.slice(0, 50) },
    'Inbound message'
  );

  // Fire inbound hook
  await hookEngine.fire('onMessageInbound', { message });

  const text = message.content.text?.trim() || '';

  let responseText: string;

  if (isCommand(text)) {
    // Handle slash command
    const { command, args } = parseCommand(text);
    log.info({ command, args }, 'Slash command detected');
    responseText = await onCommand(command, args, message);
  } else {
    // Route to agent
    responseText = await onAgentMessage(message);
  }

  // Chunk the response for the platform
  const chunks = chunkMessage(responseText);

  // Send each chunk
  for (const chunk of chunks) {
    const outbound: OutboundMessage = {
      channelType: message.channelType,
      channelId: message.channelId,
      text: chunk,
      replyTo: chunks.length === 1 ? message.id : undefined, // Only reply-to on single messages
    };

    await channelRegistry.sendMessage(outbound);
  }

  log.info(
    { sender: message.senderName, chunks: chunks.length },
    'Response delivered'
  );
}
