import express from 'express';
export interface AppDeps {}
export function createApp(_deps: Partial<AppDeps> = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  return app;
}
