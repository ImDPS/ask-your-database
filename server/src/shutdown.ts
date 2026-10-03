// Graceful shutdown for SIGTERM (what `docker stop` and Cloud Run send) and SIGINT
// (Ctrl+C): stop accepting connections, close the database pools, exit 0. If that
// has not finished within the time limit, exit anyway so a stuck connection cannot
// keep the process alive until the platform kills it.
interface Closable {
  close(cb: (err?: Error) => void): unknown;
  closeIdleConnections?: () => void;
}
interface Endable {
  end(): Promise<void>;
}

export function registerShutdown(o: {
  server: Closable;
  pools: Endable[];
  proc?: NodeJS.EventEmitter;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  timeoutMs?: number;
}): void {
  const proc = o.proc ?? process;
  const exit = o.exit ?? ((code: number) => process.exit(code));
  const log = o.log ?? ((m: string) => console.log(m));
  const timeoutMs = o.timeoutMs ?? 5000;
  let started = false;

  const shutdown = async (signal: string) => {
    if (started) return;
    started = true;
    log(`shutting down (${signal})`);
    const timer = setTimeout(() => {
      log('shutdown took too long, forcing exit');
      exit(1);
    }, timeoutMs);
    timer.unref();
    const closed = new Promise<void>((resolve) => o.server.close(() => resolve()));
    // Keep-alive connections that are idle would otherwise hold close() open.
    o.server.closeIdleConnections?.();
    await closed;
    await Promise.allSettled(o.pools.map((p) => p.end()));
    clearTimeout(timer);
    exit(0);
  };

  for (const signal of ['SIGTERM', 'SIGINT']) proc.on(signal, () => void shutdown(signal));
}
