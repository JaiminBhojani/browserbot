import http from 'node:http';
import { createHttpApp } from './server-http.js';
import { GatewayWSServer } from './server-ws.js';
import { ChannelRegistry } from '../channels/base/channel-registry.js';
import { WhatsAppChannel } from '../channels/whatsapp/whatsapp-adapter.js';
import { HookEngine } from '../hooks/hook-engine.js';
import { CommandRegistry } from '../auto-reply/command-registry.js';
import { dispatch } from '../auto-reply/dispatch.js';
import { loadConfig } from '../config/io.js';
import type { BrowsBotConfig } from '../config/schema.js';
import type { UnifiedMessage } from '../channels/base/message.types.js';
import { createChildLogger } from '../infra/logger.js';
import { browserEngine } from '../browser/index.js';
import { initAgentLoop } from '../agent/runner/agent-loop.js';
import { memoryStore } from '../agent/memory/memory-store.js';

const log = createChildLogger('gateway');

export interface GatewayContext {
  config: BrowsBotConfig;
  hookEngine: HookEngine;
  channelRegistry: ChannelRegistry;
  commandRegistry: CommandRegistry;
  wsServer: GatewayWSServer;
}

export async function startGateway(configPath?: string): Promise<GatewayContext> {
  log.info('=== BrowseBot Gateway Starting ===');

  // Step 1: Load config
  log.info('Loading configuration...');
  const config = loadConfig(configPath);
  log.info({ port: config.gateway.port }, 'Config loaded');

  // Step 2: Memory Store
  log.info('Initializing memory store...');
  memoryStore.init(config.memory);

  // Step 3: Hook Engine
  log.info('Initializing hook engine...');
  const hookEngine = new HookEngine();

  // Step 3: Command Registry
  log.info('Registering commands...');
  const commandRegistry = new CommandRegistry();
  commandRegistry.registerBuiltins();

  // Step 4: HTTP + WebSocket
  log.info('Starting HTTP + WebSocket servers...');
  const app = createHttpApp();
  const httpServer = http.createServer(app);
  const wsServer = new GatewayWSServer();
  wsServer.attach(httpServer);

  // Step 5: Browser Engine
  log.info('Starting browser engine...');
  await browserEngine.start({
    headless: config.browser.headless,
    maxContexts: config.browser.maxContexts,
    navigationTimeoutMs: config.browser.defaultTimeout,
    idleTimeoutMs: 300_000,
  });

  // Step 6: Agent Loop — pass full providers config, not just an API key
  log.info(
    { provider: config.providers.primary.provider, model: config.providers.primary.model },
    'Initializing agent loop...'
  );
  initAgentLoop({ providers: config.providers });

  // Step 7: Channels
  log.info('Initializing channels...');
  const channelRegistry = new ChannelRegistry();

  if (config.channels.whatsapp.enabled) {
    const whatsapp = new WhatsAppChannel(config.channels.whatsapp);

    whatsapp.onMessage(async (message: UnifiedMessage) => {
      const sendReply = async (text: string) => {
        await whatsapp.sendMessage({
          channelId: message.senderId,
          channelType: 'whatsapp',
          text,
        });

        wsServer.broadcast({
          type: 'message',
          from: message.senderName,
          channel: message.channelType,
          text: text.slice(0, 200),
          timestamp: Date.now(),
        });
      };

      await dispatch(message, sendReply);
    });

    channelRegistry.register(whatsapp);
  }

  // Step 8: Connect channels
  log.info('Connecting channels...');
  await channelRegistry.connectAll();

  // Step 9: Start HTTP server
  const { port, host } = config.gateway;
  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => resolve());
  });

  // Step 10: Fire startup hook
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
    await browserEngine.stop();
    memoryStore.close();
    httpServer.close();
    log.info('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { config, hookEngine, channelRegistry, commandRegistry, wsServer };
}