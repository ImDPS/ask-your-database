import { describe, it, expect } from 'vitest';
import { RateLimiter, DailyCap } from '../src/guards.js';

describe('RateLimiter', () => {
  it('allows up to the limit per minute per key, then blocks, then recovers', () => {
    let t = 0; const rl = new RateLimiter(2, () => t);
    expect(rl.allow('a')).toBe(true); expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(false);
    expect(rl.allow('b')).toBe(true);
    t = 61_000; expect(rl.allow('a')).toBe(true);
  });
  it('does not let the key map grow without bound', () => {
    let t = 0; const rl = new RateLimiter(5, () => t);
    for (let i = 0; i < 1000; i++) rl.allow(`ip-${i}`);
    expect(rl.size()).toBe(1000);
    t = 61_000; // the window has passed for every key above
    rl.allow('fresh');
    expect(rl.size()).toBe(1);
    for (let i = 0; i < 1000; i++) rl.allow(`other-${i}`);
    t = 130_000; rl.allow('fresh');
    expect(rl.size()).toBe(1);
  });
  it('rejects a non-positive or non-finite limit at construction', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => new RateLimiter(bad)).toThrow(/per-minute limit/i);
    }
  });
});
describe('DailyCap', () => {
  it('stops after max calls and resets on the next UTC day', () => {
    let t = Date.UTC(2026, 9, 5, 10); const cap = new DailyCap(2, () => t);
    expect(cap.tryTake()).toBe(true); expect(cap.tryTake()).toBe(true);
    expect(cap.tryTake()).toBe(false); expect(cap.remaining()).toBe(0);
    t = Date.UTC(2026, 9, 6, 0, 1); expect(cap.tryTake()).toBe(true);
  });
  it('allows a cap of zero (nothing can be taken)', () => {
    const cap = new DailyCap(0);
    expect(cap.tryTake()).toBe(false); expect(cap.remaining()).toBe(0);
  });
  it('rejects a negative or non-finite cap at construction', () => {
    for (const bad of [-1, NaN, Infinity, -Infinity]) {
      expect(() => new DailyCap(bad)).toThrow(/daily cap/i);
    }
  });
});
