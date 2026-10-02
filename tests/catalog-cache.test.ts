import { describe, it, expect, vi } from 'vitest';
import { catalogCache } from '../apps/ordering/src/catalog-cache';
import type { Product } from '@lab/contracts';
function setup() {
  let revision = '1';
  const stored = new Map<string, string>();
  const observe = vi.fn(),
    load = vi.fn(async () => [{ name: 'sample' }] as Product[]);
  const cache = catalogCache({
    revision: async () => revision,
    load,
    get: async (key) => stored.get(key) ?? null,
    set: async (key, value) => {
      stored.set(key, value);
    },
    remove: async (key) => {
      stored.delete(key);
    },
    valid: (value): value is Product[] =>
      Array.isArray(value) && value.every((x) => x && typeof x.name === 'string'),
    observe,
  });
  return {
    cache,
    stored,
    load,
    observe,
    advance: () => {
      revision = '2';
    },
  };
}
describe('revisioned catalog cache', () => {
  it('fills a cold key and serves a hit without another catalog load', async () => {
    const s = setup();
    await s.cache.read('first');
    await s.cache.read('second');
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(s.cache.inspect().counts.hit).toBe(1);
  });
  it('cannot select a stale revision after a late fill completes', async () => {
    const s = setup();
    let finish!: (value: Product[]) => void;
    s.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = s.cache.read('old');
    await vi.waitFor(() => expect(s.load).toHaveBeenCalledOnce());
    s.advance();
    await s.cache.read('new');
    finish([{ name: 'old' }] as Product[]);
    await old;
    expect((await s.cache.read('next'))[0]?.name).toBe('sample');
    expect(s.cache.inspect().lastKey).toBe('lab:catalog:v2');
  });
  it('coalesces overlapping loads within this ordering process', async () => {
    const s = setup();
    let finish!: (value: Product[]) => void;
    s.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const a = s.cache.read('a'),
      b = s.cache.read('b');
    await vi.waitFor(() => expect(s.cache.inspect().counts.coalesced).toBe(1));
    finish([{ name: 'shared' }] as Product[]);
    expect(await a).toEqual(await b);
    expect(s.load).toHaveBeenCalledOnce();
  });
  it('rejects corrupt cached JSON and replaces it with validated database data', async () => {
    const s = setup();
    s.stored.set('lab:catalog:v1', '{bad');
    expect((await s.cache.read('request'))[0]?.name).toBe('sample');
    expect(s.cache.inspect().counts.invalid).toBe(1);
  });
  it('falls back when cache lookup fails without masking database failure', async () => {
    const s = setup();
    const cache = catalogCache({
      revision: async () => '1',
      load: s.load,
      get: async () => {
        throw Error('offline');
      },
      set: async () => {},
      remove: async () => {},
      valid: (v): v is Product[] => Array.isArray(v),
      observe: s.observe,
    });
    await cache.read('a');
    expect(cache.inspect().counts.fallback).toBe(1);
    s.load.mockRejectedValueOnce(Error('database down'));
    await expect(cache.read('b')).rejects.toThrow('database down');
  });
  it('cleans failed fills so a later request can recover', async () => {
    const s = setup();
    s.load.mockRejectedValueOnce(Error('database down'));
    await expect(s.cache.read('a')).rejects.toThrow();
    expect(s.cache.inspect().activeFills).toBe(0);
    await s.cache.read('b');
    expect(s.cache.inspect().counts.filled).toBe(1);
  });
});
