import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerShutdown } from '../src/shutdown.js';

afterEach(() => { vi.useRealTimers(); });

const setup = (over: { closeNeverReturns?: boolean; endRejects?: boolean; timeoutMs?: number } = {}) => {
  const order: string[] = [];
  const proc = new EventEmitter();
  const server = {
    close: (cb: (err?: Error) => void) => { order.push('server.close'); if (!over.closeNeverReturns) cb(); },
    closeIdleConnections: () => { order.push('server.closeIdleConnections'); },
  };
  const mkPool = (name: string) => ({
    end: () => { order.push(`${name}.end`); return over.endRejects ? Promise.reject(new Error('already ended')) : Promise.resolve(); },
  });
  const exit = vi.fn((code: number) => { order.push(`exit ${code}`); });
  const log = vi.fn((m: string) => { order.push(`log: ${m}`); });
  registerShutdown({ server, pools: [mkPool('a'), mkPool('b')], proc, exit, log, timeoutMs: over.timeoutMs });
  return { order, proc, exit, log };
};
const flush = () => new Promise((r) => setImmediate(r));

describe('registerShutdown', () => {
  it.each(['SIGTERM', 'SIGINT'])('on %s stops accepting connections, ends the pools and exits 0', async (signal) => {
    const { order, proc, exit } = setup();
    proc.emit(signal);
    await flush();
    expect(order).toEqual([
      `log: shutting down (${signal})`,
      'server.close',
      'server.closeIdleConnections',
      'a.end',
      'b.end',
      'exit 0',
    ]);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits 0 even when a pool refuses to end', async () => {
    const { proc, exit } = setup({ endRejects: true });
    proc.emit('SIGTERM');
    await flush();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('forces an exit after 5 seconds when connections do not drain', async () => {
    vi.useFakeTimers();
    const { proc, exit, log } = setup({ closeNeverReturns: true });
    proc.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(4999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/forcing exit/));
  });

  it('ignores a second signal while shutting down', async () => {
    const { proc, exit } = setup();
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    await flush();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('does not hold the process open with its timer', async () => {
    // The timer must be unref'd so a clean exit is not delayed by it.
    const spy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const { proc } = setup();
      proc.emit('SIGTERM');
      await flush();
      const t = spy.mock.results.at(-1)?.value as NodeJS.Timeout;
      expect(t.hasRef()).toBe(false);
    } finally { spy.mockRestore(); }
  });
});
