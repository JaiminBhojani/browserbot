import type { Channel } from './channel.interface.js';
import type { ChannelType, OutboundMessage } from './message.types.js';
import { createChildLogger } from '../../infra/logger.js';

const log = createChildLogger('channel-registry');

/**
 * Channel Registry — tracks all registered channel adapters.
 * The Gateway uses this to route messages to the right channel.
 */
export class ChannelRegistry {
  private channels: Map<ChannelType, Channel> = new Map();

  /**
   * Register a channel adapter.
   */
  register(channel: Channel): void {
    this.channels.set(channel.type, channel);
    log.info(`Channel registered: ${channel.name} (${channel.type})`);
  }

  /**
   * Get a channel by type.
   */
  get(type: ChannelType): Channel | undefined {
    return this.channels.get(type);
  }

  /**
   * Get all registered channels.
   */
  getAll(): Channel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Send a message through the appropriate channel.
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    const channel = this.channels.get(message.channelType);
    if (!channel) {
      log.warn(`No channel found for type: ${message.channelType}`);
      return;
    }
    if (!channel.isConnected) {
      log.warn(`Channel ${message.channelType} is not connected`);
      return;
    }
    await channel.sendMessage(message);
  }

  /**
   * Connect all enabled channels.
   */
  async connectAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      try {
        await channel.connect();
        log.info(`Channel connected: ${channel.name}`);
      } catch (err) {
        log.error({ err }, `Failed to connect channel: ${channel.name}`);
      }
    }
  }

  /**
   * Disconnect all channels.
   */
  async disconnectAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      try {
        await channel.disconnect();
        log.info(`Channel disconnected: ${channel.name}`);
      } catch (err) {
        log.error({ err }, `Failed to disconnect channel: ${channel.name}`);
      }
    }
  }
}
