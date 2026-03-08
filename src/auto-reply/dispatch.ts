import { UnifiedMessage } from '../channels/base/message.types.js';
import { getAgentLoop } from '../agent/runner/agent-loop.js';
import { memoryStore } from '../agent/memory/memory-store.js';
import { logger } from '../infra/logger.js';

const log = logger.child({ module: 'dispatch' });

/**
 * Conversation history is now persisted in SQLite via memoryStore.
 * The in-memory Map is removed — history survives bot restarts.
 *
 * For users with memory disabled, getHistory() returns [] and saveMessage()
 * is a no-op, so behaviour is identical to the old in-memory approach.
 */
const MAX_HISTORY_TURNS = 20;

/**
 * dispatch — receives a UnifiedMessage from any channel adapter
 * and routes it through the agent loop.
 */
export async function dispatch(
  message: UnifiedMessage,
  sendReply: (text: string) => Promise<void>
): Promise<void> {
  const userId = message.senderId;
  const userText = message.content.text?.trim() ?? '';

  log.info(
    { sender: message.senderName, channel: message.channelType, text: userText.slice(0, 80) },
    'Inbound message'
  );

  // Skip empty messages
  if (!userText) {
    log.debug({ userId }, 'Empty message, skipping');
    return;
  }

  // Load persisted conversation history from SQLite
  const history = memoryStore.getHistory(userId, MAX_HISTORY_TURNS);

  try {
    // Let the user know we're working on it
    await sendReply('🔍 On it...');

    const agentLoop = getAgentLoop();

    const result = await agentLoop.run({
      userId,
      userMessage: userText,
      conversationHistory: history,
      onToolCall: (toolName) => {
        log.info({ userId, tool: toolName }, 'Tool called');
      },
    });

    // Persist the user message and final assistant response to SQLite.
    // We only store text turns (not raw tool call objects) to keep the
    // DB lean and provider-agnostic.
    memoryStore.saveMessage(userId, 'user', userText);
    if (result.finalResponse) {
      memoryStore.saveMessage(userId, 'assistant', result.finalResponse);
    }

    // Send final response
    await sendReply(result.finalResponse);

    log.info(
      {
        sender: message.senderName,
        toolCalls: result.toolCallCount,
        responseLength: result.finalResponse.length,
      },
      'Response delivered'
    );
  } catch (err: any) {
    log.error({ userId, error: err.message }, 'Agent loop error');
    await sendReply('❌ Something went wrong. Please try again.');
  }
}

/** Clear conversation history for a user (e.g. on /reset command) */
export function clearHistory(userId: string): void {
  memoryStore.clearHistory(userId);
  log.info({ userId }, 'Conversation history cleared');
}