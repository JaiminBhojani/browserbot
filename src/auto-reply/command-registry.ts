import type { UnifiedMessage } from '../channels/base/message.types.js';
import { createChildLogger } from '../infra/logger.js';

const log = createChildLogger('commands');

export type CommandHandler = (args: string, message: UnifiedMessage) => Promise<string>;

interface RegisteredCommand {
  name: string;
  description: string;
  handler: CommandHandler;
}

/**
 * Command Registry — manages all /slash commands.
 */
export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();

  /**
   * Register a slash command.
   */
  register(name: string, description: string, handler: CommandHandler): void {
    this.commands.set(name.toLowerCase(), { name, description, handler });
    log.debug(`Command registered: /${name}`);
  }

  /**
   * Execute a command.
   */
  async execute(command: string, args: string, message: UnifiedMessage): Promise<string> {
    const registered = this.commands.get(command.toLowerCase());
    if (!registered) {
      return `Unknown command: /${command}\n\nType /help to see available commands.`;
    }

    try {
      return await registered.handler(args, message);
    } catch (err) {
      log.error({ err, command }, 'Command execution failed');
      return `Error executing /${command}. Please try again.`;
    }
  }

  /**
   * Get all registered commands (for /help).
   */
  getAll(): { name: string; description: string }[] {
    return Array.from(this.commands.values()).map(({ name, description }) => ({
      name,
      description,
    }));
  }

  /**
   * Register built-in commands.
   */
  registerBuiltins(): void {
    this.register('help', 'Show available commands', async () => {
      const commands = this.getAll();
      const lines = commands.map((c) => `  /${c.name} — ${c.description}`);
      return `Available commands:\n\n${lines.join('\n')}`;
    });

    this.register('status', 'Show bot status', async () => {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const memUsage = process.memoryUsage();
      const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      return [
        '🤖 *BrowseBot Status*',
        '',
        `⏱ Uptime: ${hours}h ${minutes}m`,
        `💾 Memory: ${memMB} MB`,
        `📡 Node.js: ${process.version}`,
      ].join('\n');
    });

    this.register('ping', 'Check if bot is alive', async () => {
      return 'Pong! 🏓';
    });

    this.register('reset', 'Reset conversation', async () => {
      // TODO: Clear session history when agent is implemented
      return '🔄 Conversation reset. Starting fresh!';
    });
  }
}
