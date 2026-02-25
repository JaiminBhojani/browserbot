import { ALL_BROWSER_TOOLS, BrowserTool, ToolContext, ToolResult } from '../../browser/tools/index.js';
import { ToolDefinition } from '../providers/base.js';
import { tabRouter } from '../../browser/tabs/tab-router.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'tool-registry' });

/**
 * ToolRegistry — central registry of every tool the agent can call.
 *
 * Deliberately provider-agnostic. It exposes tools as ToolDefinition[]
 * (our own common format). Each provider converts these to its own
 * wire format (Anthropic input_schema, OpenAI function.parameters, etc.)
 * inside the provider implementation — not here.
 */
class ToolRegistry {
    private tools = new Map<string, BrowserTool>();

    registerAll(tools: BrowserTool[]): void {
        for (const tool of tools) {
            this.tools.set(tool.name, tool);
            log.debug({ tool: tool.name }, 'Tool registered');
        }
        log.info({ count: tools.length }, 'Tools registered');
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }

    getAll(): BrowserTool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tools in common ToolDefinition format.
     * Providers convert this to their specific wire format.
     */
    getToolDefinitions(): ToolDefinition[] {
        return this.getAll().map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        }));
    }

    /**
     * Execute a tool by name for a specific user.
     */
    async dispatch(
        toolName: string,
        params: Record<string, unknown>,
        userId: string
    ): Promise<ToolResult> {
        const tool = this.tools.get(toolName);

        if (!tool) {
            log.warn({ toolName }, 'Unknown tool called');
            return { success: false, error: `Unknown tool: ${toolName}` };
        }

        log.info({ toolName, userId }, 'Dispatching tool');

        try {
            const page = await tabRouter.getActivePage(userId);
            const ctx: ToolContext = { userId, page };
            const result = await tool.execute(params, ctx);

            log.info(
                { toolName, success: result.success, hasError: !!result.error },
                'Tool completed'
            );
            return result;
        } catch (err: any) {
            log.error({ toolName, error: err.message }, 'Tool threw unexpected error');
            return { success: false, error: err.message };
        }
    }
}

// Singleton
export const toolRegistry = new ToolRegistry();
toolRegistry.registerAll(ALL_BROWSER_TOOLS);