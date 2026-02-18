import express, { type Express, type Request, type Response } from 'express';
import { createChildLogger } from '../infra/logger.js';

const log = createChildLogger('http-server');

/**
 * Create and configure the Express HTTP server.
 * Serves: health check, status API, webhooks, and future Web UI.
 */
export function createHttpApp(): Express {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req: Request, _res: Response, next) => {
    log.debug({ method: req.method, path: req.path }, 'HTTP request');
    next();
  });

  // --- Health & Status Routes ---

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/status', (_req: Request, res: Response) => {
    const memUsage = process.memoryUsage();
    res.json({
      status: 'running',
      version: '0.1.0',
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      },
      node: process.version,
      timestamp: new Date().toISOString(),
    });
  });

  // --- Placeholder for future routes ---

  // POST /api/chat — send a message via HTTP (for Web UI / CLI)
  app.post('/api/chat', (req: Request, res: Response) => {
    const { message } = req.body as { message?: string };
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // TODO: Route through dispatch pipeline when agent is ready
    res.json({
      reply: `Echo: ${message}`,
      note: 'Agent not yet connected. This is the echo bot.',
    });
  });

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  log.info('HTTP routes configured');
  return app;
}
