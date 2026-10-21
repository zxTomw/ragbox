import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  indexed: false,
  hasTable: false,
  savedMarco: false,
  databaseCount: 0,
  cache: 'missing' as 'missing' | 'installed',
  nfQuery: vi.fn(),
  marcoQuery: vi.fn(),
  registerFileText: vi.fn(),
  dropFile: vi.fn(),
  terminate: vi.fn(),
  connectionClose: vi.fn(),
  marcoClose: vi.fn(),
  release: vi.fn(),
  lock: vi.fn(),
  openMarco: vi.fn(),
  download: vi.fn(),
  fetch: vi.fn(),
  removeEntry: vi.fn(),
  createDatabase: vi.fn(),
}));

function table(values: object[]) { return { toArray: () => values }; }
function statement(query: string, corpus: 'nfcorpus' | 'msmarco') {
  return {
    query: async (value: string) => {
      const fn = corpus === 'nfcorpus' ? h.nfQuery : h.marcoQuery;
      await fn(query, value);
      if (query.includes('AS query_text')) return table([{ query_text: value }]);
      return table(corpus === 'nfcorpus'
        ? [{ id: 'MED-1', title: 'Coffee research', text: 'A research abstract', score: 4 }]
        : [{ id: 42, contents: 'An MS MARCO passage', score: 3 }]);
    },
    close: vi.fn(async () => {}),
  };
}
const nfConnection = {
  query: async (sql: string) => {
    if (sql.includes('information_schema.schemata')) return table([{ n: h.indexed ? 1 : 0 }]);
    if (sql.includes('information_schema.tables')) return table([{ n: h.hasTable ? 1 : 0 }]);
    if (sql.includes('information_schema.columns')) return table(['id', 'title', 'text', 'contents'].map(column_name => ({ column_name })));
    if (sql.includes('CREATE TABLE nfcorpus')) h.hasTable = true;
    if (sql.includes('create_fts_index')) h.indexed = true;
    return table([]);
  },
  prepare: async (sql: string) => statement(sql, 'nfcorpus'),
  close: h.connectionClose,
};
const marcoConnection = { prepare: async (sql: string) => statement(sql, 'msmarco') };

vi.mock('../src/duckdb-bundle.ts', () => ({ createLocalDuckDB: h.createDatabase }));
vi.mock('../src/open-local-database.ts', () => ({ openLocalDatabase: vi.fn(async () => {}) }));
vi.mock('../src/database-lock.ts', () => ({ acquireDatabaseLock: h.lock }));
vi.mock('../src/prebuilt-msmarco.ts', () => ({ PREBUILT_NAME: 'msmarco-prebuilt.duckdb', openPrebuilt: h.openMarco }));
vi.mock('../src/download-prebuilt.ts', () => ({ downloadPrebuilt: h.download }));
vi.mock('../src/model-readiness.ts', () => ({ inspectModelCache: async () => ({ availability: h.cache }) }));

import { createAppRuntime } from '../src/app-runtime.ts';

const runtimes: ReturnType<typeof createAppRuntime>[] = [];
function runtime() { const value = createAppRuntime(); runtimes.push(value); return value; }

beforeEach(() => {
  vi.clearAllMocks();
  h.indexed = false; h.hasTable = false; h.savedMarco = false; h.databaseCount = 0; h.cache = 'missing';
  h.createDatabase.mockImplementation(async () => {
    h.databaseCount++;
    return { connect: async () => nfConnection, registerFileText: h.registerFileText,
      dropFile: h.dropFile, terminate: h.terminate };
  });
  h.lock.mockResolvedValue(h.release);
  h.openMarco.mockImplementation(async () => ({ conn: marcoConnection, count: 8841823, close: h.marcoClose }));
  h.download.mockImplementation(async () => { h.savedMarco = true; });
  h.nfQuery.mockResolvedValue(undefined); h.marcoQuery.mockResolvedValue(undefined);
  h.registerFileText.mockResolvedValue(undefined); h.dropFile.mockResolvedValue(undefined);
  h.connectionClose.mockResolvedValue(undefined); h.terminate.mockResolvedValue(undefined); h.marcoClose.mockResolvedValue(undefined);
  const directory = {
    getFileHandle: async (name: string) => {
      if (name === 'msmarco-prebuilt.duckdb' && !h.savedMarco) throw new DOMException('Missing', 'NotFoundError');
      return {};
    },
    removeEntry: h.removeEntry.mockImplementation(async (name: string) => {
      if (name === 'analytics.duckdb') { h.indexed = false; h.hasTable = false; }
      if (name === 'msmarco-prebuilt.duckdb') h.savedMarco = false;
    }),
  };
  vi.stubGlobal('window', Object.assign(new EventTarget(), { isSecureContext: true }));
  vi.stubGlobal('navigator', { locks: {}, storage: {
    getDirectory: async () => directory,
    estimate: async () => ({ quota: 10e9, usage: 0 }),
  } });
  vi.stubGlobal('Worker', class { terminate() {} });
  vi.stubGlobal('fetch', h.fetch);
  vi.stubGlobal('caches', { keys: async () => [] });
});
afterEach(async () => {
  for (const value of runtimes.splice(0)) await value.dispose();
  vi.unstubAllGlobals();
});

it('initializes once and never starts large downloads automatically', async () => {
  const app = runtime();
  await Promise.all([app.initialize(), app.initialize()]);
  expect(h.lock).toHaveBeenCalledOnce();
  expect(h.databaseCount).toBe(1);
  expect(app.conversations.initialized).toBe(true);
  expect(app.states.get('nfcorpus').phase).toBe('missing');
  expect(app.states.get('msmarco').phase).toBe('missing');
  expect(h.download).not.toHaveBeenCalled();
  expect(h.openMarco).not.toHaveBeenCalled();
  await app.dispose();
  await app.dispose();
  expect(h.release).toHaveBeenCalledOnce();
  expect(h.terminate).toHaveBeenCalledOnce();
});

it('connects both real retrieval paths to chat and lazily opens the saved MS MARCO index', async () => {
  h.indexed = true; h.hasTable = true; h.savedMarco = true;
  const app = runtime();
  await app.initialize();
  expect(app.states.get('nfcorpus').phase).toBe('ready');
  expect(app.states.get('msmarco').phase).toBe('saved');
  await app.chat.send('coffee');
  expect(app.conversations.current().turns[0].results[0]).toMatchObject({ id: 'MED-1', title: 'Coffee research' });
  expect(h.nfQuery).toHaveBeenCalledWith(expect.stringContaining('fts_main_nfcorpus.match_bm25'), 'coffee');
  app.chat.select('msmarco');
  await app.openMSMarco();
  expect(h.openMarco).toHaveBeenCalledOnce();
  await app.chat.send('capital of France');
  expect(app.conversations.current().turns[0].results[0]).toMatchObject({ id: 'MARCO-42', text: 'An MS MARCO passage' });
  expect(h.marcoQuery).toHaveBeenCalledWith(expect.stringContaining('fts_main_msmarco.match_bm25'), 'capital of France');
  expect(app.states.busy).toBe(false);
});

it('validates and persists NFCorpus before enabling chat', async () => {
  const text = Array.from({ length: 3633 }, (_, i) => JSON.stringify({ id: `MED-${i}`, title: 'Title', text: 'Evidence' })).join('\n');
  h.fetch.mockResolvedValue(new Response(text, { headers: { 'content-type': 'application/jsonl' } }));
  const app = runtime();
  await app.prepareNFCorpus();
  expect(h.registerFileText).toHaveBeenCalledWith('nfcorpus-import.jsonl', text);
  expect(h.dropFile).toHaveBeenCalledWith('nfcorpus-import.jsonl');
  expect(h.indexed).toBe(true);
  expect(app.states.get('nfcorpus').phase).toBe('ready');
  expect(app.chat.canSend()).toBe(true);
});

it('leaves chat unavailable when the NFCorpus input is incomplete', async () => {
  h.fetch.mockResolvedValue(new Response('{"id":"MED-1","title":"Title","text":"Evidence"}'));
  const app = runtime();
  await app.prepareNFCorpus();
  expect(app.states.get('nfcorpus')).toMatchObject({ phase: 'error', message: expect.stringContaining('3,633 unique') });
  expect(h.registerFileText).not.toHaveBeenCalled();
  expect(app.chat.canSend()).toBe(false);
  expect(app.states.busy).toBe(false);
});

it('waits for an in-flight retrieval before opening another index', async () => {
  h.indexed = true; h.hasTable = true; h.savedMarco = true;
  let release!: () => void;
  h.nfQuery.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const app = runtime();
  await app.initialize();
  const search = app.chat.send('coffee');
  await vi.waitFor(() => expect(app.states.busy).toBe(true));
  app.chat.select('msmarco');
  const opening = app.openMSMarco();
  await Promise.resolve();
  expect(h.openMarco).not.toHaveBeenCalled();
  release();
  await search;
  await opening;
  expect(h.openMarco).toHaveBeenCalledOnce();
  expect(app.states.get('msmarco').phase).toBe('ready');
});

it('preserves a saved MS MARCO index when its replacement download is cancelled', async () => {
  h.savedMarco = true;
  h.download.mockImplementation(({ signal, onProgress }: { signal: AbortSignal; onProgress: (received: number, total: number) => void }) => {
    onProgress(100, 3346542592);
    return new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))));
  });
  const app = runtime();
  await app.initialize();
  const download = app.downloadMSMarco();
  await vi.waitFor(() => expect(h.download).toHaveBeenCalledOnce());
  app.cancelDownload();
  await download;
  expect(app.states.get('msmarco')).toMatchObject({ phase: 'saved', savedAvailable: true });
  await app.openMSMarco();
  expect(app.states.get('msmarco').phase).toBe('ready');
});

it('can cancel a download before its network request starts', async () => {
  const app = runtime();
  await app.initialize();
  const download = app.downloadMSMarco();
  app.cancelDownload();
  await download;
  expect(h.download).not.toHaveBeenCalled();
  expect(app.states.get('msmarco').phase).toBe('missing');
});

it('releases the database lock and reports startup failure when database construction fails', async () => {
  h.lock.mockRejectedValueOnce(new Error('Another RAGbox tab owns the database.'));
  const app = runtime();
  await app.initialize();
  expect(h.databaseCount).toBe(0);
  expect(app.states.get('nfcorpus')).toMatchObject({ phase: 'error', message: expect.stringContaining('Another RAGbox tab') });
  expect(app.states.get('msmarco').phase).toBe('error');
  expect(app.states.busy).toBe(false);
});

it('removes NFCorpus and its WAL files while leaving an open MS MARCO collection usable', async () => {
  h.indexed = true; h.hasTable = true; h.savedMarco = true;
  const app = runtime();
  await app.initialize();
  app.chat.select('msmarco');
  await app.openMSMarco();
  await expect(app.removeCollection('nfcorpus')).resolves.toBe(true);
  expect(h.connectionClose).toHaveBeenCalledOnce();
  expect(h.databaseCount).toBe(2);
  expect(h.removeEntry.mock.calls.map(([name]) => name)).toEqual([
    'analytics.duckdb.wal', 'analytics.duckdb.wal.checkpoint', 'analytics.duckdb.wal.recovery', 'analytics.duckdb',
  ]);
  expect(h.marcoClose).not.toHaveBeenCalled();
  expect(app.states.get('nfcorpus').phase).toBe('missing');
  expect(app.chat.canSend()).toBe(true);
  await app.chat.send('France');
  expect(app.conversations.current().turns[0].results[0].id).toBe('MARCO-42');
});

it('clears model readiness after deleting its cache so it can be installed again', async () => {
  const app = runtime();
  await app.initialize();
  app.model.state = 'ready';
  app.model.model = { cache: 'installed', stage: 'ready', downloadedBytes: 0 };
  app.model.updateControls();
  await expect(app.clearModel()).resolves.toBe(true);
  expect(app.model.ready).toBe(false);
  expect(app.model.model.cache).toBe('missing');
  expect(app.model.loadAction()).toBe('Download model (~1.84 GB)');
  expect(app.states.get('model').phase).toBe('idle');
});

it('reports false for guarded storage actions without claiming deletion', async () => {
  const app = runtime();
  await app.initialize();
  app.states.setBusy(true);
  await expect(app.clearModel()).resolves.toBe(false);
  await expect(app.removeCollection('nfcorpus')).resolves.toBe(false);
  expect(h.removeEntry).not.toHaveBeenCalled();
  expect(app.states.get('nfcorpus').phase).toBe('missing');
  app.states.setBusy(false);
  await app.dispose();
  await expect(app.clearModel()).resolves.toBe(false);
  await expect(app.removeCollection('msmarco')).resolves.toBe(false);
});

it('refuses to remove a collection while an index download is active', async () => {
  h.download.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
  }));
  const app = runtime();
  await app.initialize();
  const download = app.downloadMSMarco();
  await vi.waitFor(() => expect(h.download).toHaveBeenCalledOnce());
  await expect(app.removeCollection('msmarco')).resolves.toBe(false);
  await expect(app.removeCollection('nfcorpus')).resolves.toBe(false);
  expect(h.removeEntry).not.toHaveBeenCalled();
  app.cancelDownload();
  await download;
});

it('returns false and exposes cache deletion errors', async () => {
  const app = runtime();
  await app.initialize();
  vi.stubGlobal('caches', { keys: async () => { throw new Error('Cache storage was denied.'); } });
  await expect(app.clearModel()).resolves.toBe(false);
  expect(app.states.get('model')).toMatchObject({ phase: 'error', message: 'Cache storage was denied.' });
});

it('returns false and exposes collection deletion errors', async () => {
  const app = runtime();
  await app.initialize();
  h.removeEntry.mockRejectedValueOnce(new Error('Collection storage was denied.'));
  await expect(app.removeCollection('msmarco')).resolves.toBe(false);
  expect(app.states.get('msmarco')).toMatchObject({ phase: 'error', message: 'Collection storage was denied.' });
  expect(app.states.busy).toBe(false);
});

it('rejects a second collection removal while the first is queued', async () => {
  const app = runtime();
  await app.initialize();
  const first = app.removeCollection('msmarco');
  await expect(app.removeCollection('nfcorpus')).resolves.toBe(false);
  await expect(first).resolves.toBe(true);
  expect(h.removeEntry.mock.calls.map(([name]) => name)).toEqual([
    'msmarco-prebuilt.duckdb.wal', 'msmarco-prebuilt.duckdb',
  ]);
});

it('initializes and prepares an index while the GPU capability check remains unresolved', async () => {
  const app = runtime();
  vi.spyOn(app.model, 'initializeCapability').mockReturnValue(new Promise(() => {}));
  const text = Array.from({ length: 3633 }, (_, i) => JSON.stringify({ id: `MED-${i}`, title: 'Title', text: 'Evidence' })).join('\n');
  h.fetch.mockResolvedValue(new Response(text, { headers: { 'content-type': 'application/jsonl' } }));
  await app.initialize();
  expect(app.states.get('model').phase).toBe('checking');
  expect(app.conversations.initialized).toBe(true);
  await app.prepareNFCorpus();
  expect(app.states.get('nfcorpus').phase).toBe('ready');
  expect(app.chat.canSend()).toBe(true);
  await app.chat.send('coffee');
  expect(app.conversations.current().turns[0].results[0].id).toBe('MED-1');
  expect(app.conversations.current().turns[0].phase).toBe('waiting');
});
