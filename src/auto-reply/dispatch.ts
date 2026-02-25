import { UnifiedMessage } from '../channels/base/message.types.js';
import { getAgentLoop } from '../agent/runner/agent-loop.js';
import { logger } from '../infra/logger.js';

const log = logger.child({ module: 'dispatch' });

/**
 * In-memory conversation history per user.
 * Key: userId (e.g. "919726235948@s.whatsapp.net")
 * Value: array of AgentMessage turns
 *
 * Phase 3 will migrate this to SQLite for persistence across restarts.
 */
const conversationHistories = new Map<string, any[]>();

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

  // Get or create conversation history for this user
  if (!conversationHistories.has(userId)) {
    conversationHistories.set(userId, []);
  }
  const history = conversationHistories.get(userId)!;

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

    // Update conversation history, keep it bounded
    history.push(
      { role: 'user', content: userText },
      ...result.updatedHistory.filter((m: any) => m.role === 'assistant')
    );

    // Trim history if too long
    if (history.length > MAX_HISTORY_TURNS * 2) {
      history.splice(0, history.length - MAX_HISTORY_TURNS * 2);
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
  conversationHistories.delete(userId);
  log.info({ userId }, 'Conversation history cleared');
}