import http from 'node:http';
import { createHttpApp } from './server-http.js';
import { GatewayWSServer } from './server-ws.js';
import { ChannelRegistry } from '../channels/base/channel-registry.js';
import { WhatsAppChannel } from '../channels/whatsapp/whatsapp-adapter.js';
import { HookEngine } from '../hooks/hook-engine.js';
import { CommandRegistry } from '../auto-reply/command-registry.js';
import { dispatch } from '../auto-reply/dispatch.js';
import { loadConfig, type BrowsBotConfig } from '../config/io.js';
import type { UnifiedMessage } from '../channels/base/message.types.js';
import { createChildLogger } from '../infra/logger.js';

const log = createChildLogger('gateway');

export interface GatewayContext {
  config: BrowsBotConfig;
  hookEngine: HookEngine;
  channelRegistry: ChannelRegistry;
  commandRegistry: CommandRegistry;
  wsServer: GatewayWSServer;
}

/**
 * Start the BrowseBot Gateway Server.
 * This is the single process that owns all state.
 */
export async function startGateway(configPath?: string): Promise<GatewayContext> {
  log.info('=== BrowseBot Gateway Starting ===');

  // Step 1: Load and validate config
  log.info('Loading configuration...');
  const config = loadConfig(configPath);
  log.info({ port: config.gateway.port }, 'Config loaded');

  // Step 2: Initialize Hook Engine
  log.info('Initializing hook engine...');
  const hookEngine = new HookEngine();

  // Step 3: Initialize Command Registry
  log.info('Registering commands...');
  const commandRegistry = new CommandRegistry();
  commandRegistry.registerBuiltins();

  // Step 4: Create HTTP + WebSocket servers
  log.info('Starting HTTP + WebSocket servers...');
  const app = createHttpApp();
  const httpServer = http.createServer(app);
  const wsServer = new GatewayWSServer();
  wsServer.attach(httpServer);

  // Step 5: Initialize Channel Registry
  log.info('Initializing channels...');
  const channelRegistry = new ChannelRegistry();

  // Register WhatsApp channel if enabled
  if (config.channels.whatsapp.enabled) {
    const whatsapp = new WhatsAppChannel(config.channels.whatsapp);

    // Wire up message handler
    whatsapp.onMessage(async (message: UnifiedMessage) => {
      await dispatch(message, {
        channelRegistry,
        hookEngine,
        onAgentMessage: async (msg) => {
          // TODO: Replace with actual agent when Phase 3 is built
          const text = msg.content.text || '';
          log.info({ text: text.slice(0, 100) }, 'Agent message (echo mode)');

          // Broadcast to WebSocket clients
          wsServer.broadcast({
            type: 'message',
            from: msg.senderName,
            channel: msg.channelType,
            text,
            timestamp: msg.timestamp,
          });

          return `🤖 *Echo Mode*\n\nYou said: "${text}"\n\n_Agent not yet connected. This is Phase 1 — the foundation is working!_`;
        },
        onCommand: async (command, args, msg) => {
          return commandRegistry.execute(command, args, msg);
        },
      });
    });

    channelRegistry.register(whatsapp);
  }

  // Step 6: Connect all channels
  log.info('Connecting channels...');
  await channelRegistry.connectAll();

  // Step 7: Start listening
  const { port, host } = config.gateway;
  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      resolve();
    });
  });

  // Step 8: Fire gateway start hook
  await hookEngine.fire('onGatewayStart', { config });

  log.info('=== BrowseBot Gateway Ready ===');
  log.info(`   HTTP:      http://${host}:${port}`);
  log.info(`   WebSocket: ws://${host}:${port}`);
  log.info(`   Health:    http://${host}:${port}/health`);
  log.info(`   Status:    http://${host}:${port}/api/status`);
  log.info('');
  if (config.channels.whatsapp.enabled) {
    log.info('   WhatsApp:  Waiting for QR scan (check terminal)...');
  }
  log.info('================================');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    await hookEngine.fire('onGatewayStop', {});
    await channelRegistry.disconnectAll();
    httpServer.close();
    log.info('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return {
    config,
    hookEngine,
    channelRegistry,
    commandRegistry,
    wsServer,
  };
}
