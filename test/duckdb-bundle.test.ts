import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ select: vi.fn(), instantiate: vi.fn(), detach: vi.fn(), terminate: vi.fn(), workerURLs: [] as string[] }));
vi.mock('@duckdb/duckdb-wasm', () => ({
  selectBundle: h.select,
  ConsoleLogger: class {},
  AsyncDuckDB: class { instantiate = h.instantiate; detach = h.detach; terminate = h.terminate; },
}));

import { createLocalDuckDB, LOCAL_DUCKDB_BUNDLES } from '../src/duckdb-bundle.ts';

let worker: EventTarget & { terminate: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  h.workerURLs.length = 0;
  h.select.mockImplementation(async bundles => ({ ...bundles.eh, pthreadWorker: null }));
  h.instantiate.mockResolvedValue(null);
  h.terminate.mockResolvedValue(undefined);
  vi.stubGlobal('Worker', class extends EventTarget {
    terminate = vi.fn();
    constructor(url: string) { super(); h.workerURLs.push(url); worker = this; }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('selects local dependency assets for both supported WebAssembly variants', async () => {
  for (const variant of ['mvp', 'eh'] as const) {
    const bundle = LOCAL_DUCKDB_BUNDLES[variant]!;
    expect(bundle.mainModule).toContain(`duckdb-${variant}.wasm`);
    expect(bundle.mainWorker).toContain(`duckdb-browser-${variant}.worker.js`);
    expect(bundle.mainModule).not.toMatch(/^https?:/);
    expect(bundle.mainWorker).not.toMatch(/^https?:/);
  }
  await createLocalDuckDB();
  expect(h.select).toHaveBeenCalledWith(LOCAL_DUCKDB_BUNDLES);
  expect(h.workerURLs).toEqual([LOCAL_DUCKDB_BUNDLES.eh!.mainWorker]);
  expect(h.instantiate).toHaveBeenCalledWith(LOCAL_DUCKDB_BUNDLES.eh!.mainModule, null);
  expect(h.terminate).not.toHaveBeenCalled();
});

it('reports worker startup errors and cleans up instead of leaving initialization pending', async () => {
  h.instantiate.mockImplementation(() => new Promise(() => {}));
  const result = createLocalDuckDB();
  const rejected = expect(result).rejects.toThrow('The local database worker could not start');
  await Promise.resolve();
  worker.dispatchEvent(new Event('error'));
  await rejected;
  expect(worker.terminate).toHaveBeenCalled();
  expect(h.detach).toHaveBeenCalledOnce();
  expect(h.terminate).not.toHaveBeenCalled();
});

it('bounds initialization when the worker never responds', async () => {
  vi.useFakeTimers();
  h.instantiate.mockImplementation(() => new Promise(() => {}));
  const result = createLocalDuckDB();
  const rejected = expect(result).rejects.toThrow('took too long to start');
  await vi.advanceTimersByTimeAsync(45000);
  await rejected;
  expect(worker.terminate).toHaveBeenCalled();
  expect(h.detach).toHaveBeenCalledOnce();
  expect(h.terminate).not.toHaveBeenCalled();
});
