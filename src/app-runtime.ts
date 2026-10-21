import type * as duckdb from '@duckdb/duckdb-wasm';
import { ChatController } from './chat-controller.ts';
import { createConversationStore } from './conversations.ts';
import { acquireDatabaseLock } from './database-lock.ts';
import { downloadPrebuilt } from './download-prebuilt.ts';
import { createLocalDuckDB } from './duckdb-bundle.ts';
import { errorMessage, errorName } from './errors.ts';
import { LoadCoordinator } from './load-coordinator.ts';
import { deleteModelCacheFiles } from './model-cache.ts';
import { ModelService } from './model-service.ts';
import { openLocalDatabase } from './open-local-database.ts';
import { openPrebuilt, PREBUILT_NAME } from './prebuilt-msmarco.ts';
import { collectionReady, ResourceStates } from './resource-state.ts';
import { DEMO_FILES, deleteDemoFile } from './reset.ts';
import { nfcorpusSearchSQL, retrieveMSMarco, retrieveNFCorpus } from './collection-retrieval.ts';
import type { Corpus, RetrievalResult } from './types.ts';

const MARCO_DOWNLOAD_BYTES = 3346542592;
const MARCO_DOWNLOAD_URL = import.meta.env.VITE_MSMARCO_INDEX_URL ||
  'https://huggingface.co/datasets/DavidzzzZZZ/msmarco-duckdb-fts/resolve/d8b39bc9edc94a16fb77359243163ed80c609c84/msmarco-prebuilt.duckdb';
const NF_INDEX_SQL = "PRAGMA create_fts_index('nfcorpus', 'id', 'contents', overwrite = 1)";

/** Browser services and persistence live outside React's render lifecycle. */
export function createAppRuntime() {
  const states = new ResourceStates();
  const loads = new LoadCoordinator();
  const conversations = createConversationStore();
  const model = new ModelService({ loads,
    onState: (phase, message, status) => states.set('model', phase, message, status),
  });
  let database: duckdb.AsyncDuckDB | undefined;
  let connection: duckdb.AsyncDuckDBConnection | undefined;
  let marco: Awaited<ReturnType<typeof openPrebuilt>> | undefined;
  let releaseLock: (() => void) | undefined;
  let initialization: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  let initialized = false;
  let disposed = false;
  let nfExtensionLoaded = false;
  let preparing = false;
  let clearingModel = false;
  let removingCollection = false;
  let openingMarco: Promise<void> | undefined;
  let downloadingMarco: Promise<void> | undefined;
  let downloadController: AbortController | undefined;

  const chat = new ChatController(conversations, model, {
    ready: corpus => collectionReady(states.state.getState(), corpus),
    busy: () => states.busy || states.shuttingDown,
    subscribe: listener => states.watch(snapshot => [snapshot.busy, snapshot.shuttingDown,
      snapshot.resources.nfcorpus.phase, snapshot.resources.msmarco.phase], listener, false),
    retrieve: async (corpus, query): Promise<RetrievalResult> => {
      if (disposed || states.busy || !collectionReady(states.state.getState(), corpus)) {
        throw new Error('The collection is not ready to search.');
      }
      states.setBusy(true, corpus);
      try {
        if (corpus === 'nfcorpus') {
          if (!connection) throw new Error('NFCorpus is still opening.');
          return await retrieveNFCorpus(connection, query);
        }
        if (!marco) throw new Error('MS MARCO is still opening.');
        return await retrieveMSMarco(marco.conn, query);
      } finally { states.setBusy(false); }
    },
  });

  const unsubscribeSelection = conversations.watch(snapshot => snapshot.selected, selected => {
    if (initialized && selected === 'msmarco' && states.get('msmarco').savedAvailable) void openMSMarco();
  });
  const flush = () => { void conversations.flush(); };

  function root() { return navigator.storage.getDirectory(); }
  function rows<T>(result: { toArray(): unknown[] }) { return result.toArray() as T[]; }
  function reportError(corpus: Corpus, error: unknown) {
    if (disposed) return;
    const previous = states.get(corpus);
    states.set(corpus, 'error', errorMessage(error), undefined, undefined, previous.savedAvailable);
  }
  async function waitForIdle() {
    if (!states.busy || disposed) return;
    await new Promise<void>(resolve => {
      const unsubscribe = states.watch(snapshot => [snapshot.busy, snapshot.shuttingDown], () => {
        if (!states.busy || states.shuttingDown) { unsubscribe(); resolve(); }
      }, false);
    });
  }
  async function loadNFExtension() {
    if (nfExtensionLoaded) return;
    if (!connection) throw new Error('The local database is unavailable.');
    await connection.query('INSTALL fts; LOAD fts');
    nfExtensionLoaded = true;
  }
  async function closeDatabase() {
    const currentConnection = connection;
    const currentDatabase = database;
    connection = undefined;
    database = undefined;
    nfExtensionLoaded = false;
    try {
      if (currentConnection) {
        try { await currentConnection.query('CHECKPOINT'); }
        finally { await currentConnection.close(); }
      }
    } finally { await currentDatabase?.terminate(); }
  }
  async function createDatabase() {
    const next = await createLocalDuckDB();
    database = next;
    await openLocalDatabase(next, await root());
    connection = await next.connect();
  }
  async function reopenNFCorpus() {
    if (!connection) throw new Error('The local database is unavailable.');
    states.set('nfcorpus', 'checking', 'Checking saved NFCorpus index…');
    const result = await connection.query(`SELECT count(*) AS n FROM information_schema.schemata
      WHERE catalog_name = current_database() AND schema_name = 'fts_main_nfcorpus'`);
    if (!Number(rows<{ n: number | bigint }>(result)[0]?.n)) {
      states.set('nfcorpus', 'missing', 'Prepare NFCorpus once to start searching.');
      return;
    }
    await loadNFExtension();
    const statement = await connection.prepare(await nfcorpusSearchSQL(connection));
    await statement.close();
    states.set('nfcorpus', 'ready', '3,633 research documents ready to search.', undefined, undefined, true);
  }
  async function checkMarco() {
    try {
      await (await root()).getFileHandle(PREBUILT_NAME);
      states.set('msmarco', 'saved', 'Saved index available. Opens when selected.', undefined, undefined, true);
    } catch (error) {
      if (errorName(error) === 'NotFoundError') states.set('msmarco', 'missing', 'Download the 3.35 GB index to search MS MARCO.', undefined, undefined, false);
      else reportError('msmarco', error);
    }
  }

  function initialize() {
    if (initialization) return initialization;
    if (disposed) return Promise.resolve();
    initialization = (async () => {
      window.addEventListener('pagehide', flush);
      const conversationsReady = conversations.initialize();
      // Capability discovery can stall in a browser's GPU driver. Retrieval and
      // collection preparation must be usable without waiting for that check.
      const capability = model.initializeCapability().catch(error => {
        if (!disposed) states.set('model', 'error', errorMessage(error), model.model);
        return { supported: false as const, reason: errorMessage(error) };
      });
      if (!window.isSecureContext || !navigator.storage?.getDirectory) {
        for (const corpus of ['nfcorpus', 'msmarco'] as const) {
          states.set(corpus, 'unsupported', 'Browser storage requires a supported browser on HTTPS or localhost.');
        }
        await conversationsReady;
        return;
      }
      try {
        await loads.run(async () => {
          if (disposed) return;
          releaseLock = await acquireDatabaseLock(navigator.locks);
          if (disposed) { releaseLock(); releaseLock = undefined; return; }
          await createDatabase();
          if (disposed) return;
          try { await reopenNFCorpus(); } catch (error) { reportError('nfcorpus', error); }
          await checkMarco();
        });
        await conversationsReady;
        if (disposed) return;
        initialized = true;
        if (conversations.selected === 'msmarco' && states.get('msmarco').savedAvailable) void openMSMarco();
        void capability.then(result => {
          if (result.supported && model.model.cache === 'installed' && !disposed) return model.loadAndWait(true);
        }).catch(error => { if (!disposed) states.set('model', 'error', errorMessage(error), model.model); });
      } catch (error) {
        for (const corpus of ['nfcorpus', 'msmarco'] as const) reportError(corpus, error);
        await closeDatabase().catch(() => {});
        releaseLock?.(); releaseLock = undefined;
      }
    })();
    return initialization;
  }

  async function prepareNFCorpus() {
    await initialize();
    if (disposed || preparing || states.busy || !connection || !database) return;
    preparing = true;
    states.set('nfcorpus', 'preparing', 'Waiting to prepare NFCorpus…');
    try {
      await loads.run(async () => {
        await waitForIdle();
        if (disposed || !connection || !database) return;
        states.setBusy(true);
        try {
          await loadNFExtension();
          const tables = await connection.query(`SELECT count(*) AS n FROM information_schema.tables
            WHERE table_catalog = current_database() AND table_schema = 'main' AND table_name = 'nfcorpus'`);
          if (!Number(rows<{ n: number | bigint }>(tables)[0]?.n)) {
            states.set('nfcorpus', 'preparing', 'Loading 3,633 research documents…');
            const response = await fetch(`${import.meta.env.BASE_URL}data/nfcorpus.jsonl`);
            if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
              throw new Error('NFCorpus data is missing. Run npm run prepare:nfcorpus before building the app.');
            }
            const text = await response.text();
            const documents = text.trim().split(/\r?\n/).map(line => JSON.parse(line) as { id: string });
            if (documents.length !== 3633 || new Set(documents.map(document => document.id)).size !== 3633) {
              throw new Error('NFCorpus must contain 3,633 unique documents.');
            }
            await database.registerFileText('nfcorpus-import.jsonl', text);
            try {
              await connection.query(`CREATE TABLE nfcorpus AS SELECT id, title, text,
                title || ' ' || text AS contents FROM read_json_auto('nfcorpus-import.jsonl', format = 'newline_delimited')`);
            } finally { await database.dropFile('nfcorpus-import.jsonl'); }
          }
          await nfcorpusSearchSQL(connection);
          states.set('nfcorpus', 'preparing', 'Building the search index…');
          await connection.query(NF_INDEX_SQL);
          await connection.query('CHECKPOINT');
          states.set('nfcorpus', 'ready', '3,633 research documents ready to search.', undefined, undefined, true);
        } finally { states.setBusy(false); }
      });
    } catch (error) { reportError('nfcorpus', error); }
    finally { preparing = false; }
  }

  function openMSMarco() {
    if (openingMarco) return openingMarco;
    if (disposed || marco || downloadingMarco || !navigator.storage?.getDirectory) return Promise.resolve();
    openingMarco = (async () => {
      states.set('msmarco', 'opening', 'Opening the saved MS MARCO index…', undefined, undefined, true);
      try {
        await loads.run(async () => {
          await waitForIdle();
          if (disposed) return;
          states.setBusy(true);
          try {
            marco = await openPrebuilt();
            if (!disposed) states.set('msmarco', 'ready', `${marco.count.toLocaleString()} passages ready to search.`, undefined, undefined, true);
          } finally { states.setBusy(false); }
        });
      } catch (error) {
        if (errorName(error) === 'NotFoundError') states.set('msmarco', 'missing', 'No saved index. Download MS MARCO first.', undefined, undefined, false);
        else reportError('msmarco', error);
      } finally { openingMarco = undefined; }
    })();
    return openingMarco;
  }

  function downloadMSMarco() {
    if (downloadingMarco) return downloadingMarco;
    if (disposed || openingMarco || states.busy || !navigator.storage?.getDirectory) return Promise.resolve();
    downloadingMarco = (async () => {
      const controller = new AbortController();
      downloadController = controller;
      const savedAvailable = states.get('msmarco').savedAvailable;
      states.set('msmarco', 'downloading', 'Starting MS MARCO download…', undefined, 0, savedAvailable);
      chat.stop();
      try {
        const previous = marco; marco = undefined;
        await previous?.close();
        const directory = await root();
        const estimate = await navigator.storage.estimate();
        if (estimate.quota != null && estimate.usage != null && estimate.quota - estimate.usage < MARCO_DOWNLOAD_BYTES) {
          throw new Error('Not enough available browser storage for the 3.35 GB index.');
        }
        controller.signal.throwIfAborted();
        let lastUpdate = 0;
        await downloadPrebuilt({ url: MARCO_DOWNLOAD_URL, bytes: MARCO_DOWNLOAD_BYTES,
          root: directory, name: PREBUILT_NAME, signal: controller.signal,
          onProgress(received, total) {
            const now = performance.now();
            if (now - lastUpdate < 150 && received !== total) return;
            lastUpdate = now;
            if (!disposed) states.set('msmarco', 'downloading',
              `${(received / 1e9).toFixed(2)} of ${(total / 1e9).toFixed(2)} GB downloaded`,
              undefined, received / total * 100, savedAvailable);
          },
        });
        if (disposed) return;
        states.set('msmarco', 'opening', 'Opening MS MARCO…', undefined, undefined, true);
        await loads.run(async () => {
          await waitForIdle();
          if (disposed) return;
          states.setBusy(true);
          try {
            marco = await openPrebuilt();
            if (!disposed) states.set('msmarco', 'ready', `${marco.count.toLocaleString()} passages ready to search.`, undefined, undefined, true);
          } finally { states.setBusy(false); }
        });
      } catch (error) {
        if (errorName(error) === 'AbortError') {
          if (!disposed) states.set('msmarco', savedAvailable ? 'saved' : 'missing', 'Download cancelled. You can retry at any time.', undefined, undefined, savedAvailable);
        } else reportError('msmarco', error);
      } finally { downloadController = undefined; downloadingMarco = undefined; }
    })();
    return downloadingMarco;
  }

  async function loadModel() {
    if (disposed || clearingModel) return;
    await model.initializeCapability();
    if (!disposed) await model.recoverModel();
  }
  async function clearModel(): Promise<boolean> {
    if (disposed || states.busy || clearingModel) return false;
    clearingModel = true;
    const unsupported = model.state === 'unsupported';
    chat.stop();
    model.dispose();
    model.state = unsupported ? 'unsupported' : 'idle';
    model.updateControls();
    states.set('model', 'checking', 'Removing saved model files…', model.model);
    try {
      return await loads.run(async () => {
        if (disposed) return false;
        if (!globalThis.caches) throw new Error('Model cache is unavailable in this browser.');
        await deleteModelCacheFiles(caches);
        await model.refreshCache();
        return true;
      });
    } catch (error) { states.set('model', 'error', errorMessage(error), model.model); return false; }
    finally { clearingModel = false; }
  }
  async function removeCollection(corpus: Corpus): Promise<boolean> {
    if (disposed || states.busy || preparing || openingMarco || downloadingMarco || removingCollection) return false;
    removingCollection = true;
    chat.stop();
    states.set(corpus, 'opening', 'Removing the saved collection…', undefined, undefined, states.get(corpus).savedAvailable);
    try {
      return await loads.run(async () => {
        await waitForIdle();
        if (disposed) return false;
        states.setBusy(true);
        try {
          const directory = await root();
          if (corpus === 'nfcorpus') await closeDatabase();
          else { const previous = marco; marco = undefined; await previous?.close(); }
          const name = corpus === 'nfcorpus' ? 'analytics.duckdb' : PREBUILT_NAME;
          for (const file of DEMO_FILES.filter(file => file === name || file.startsWith(`${name}.wal`))) {
            await deleteDemoFile(directory, file);
          }
          if (corpus === 'nfcorpus') await createDatabase();
          states.set(corpus, 'missing', corpus === 'nfcorpus' ? 'Prepare NFCorpus to search again.' : 'Download MS MARCO to search again.', undefined, undefined, false);
          return true;
        } finally { states.setBusy(false); }
      });
    } catch (error) { reportError(corpus, error); return false; }
    finally { removingCollection = false; }
  }
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    states.beginShutdown();
    downloadController?.abort();
    chat.dispose();
    model.dispose();
    unsubscribeSelection();
    window.removeEventListener('pagehide', flush);
    disposal = (async () => {
      try {
        await downloadingMarco;
        await conversations.flush();
        await loads.run(async () => {
          try { const previous = marco; marco = undefined; await previous?.close(); }
          finally { await closeDatabase(); }
        });
      } finally { releaseLock?.(); releaseLock = undefined; }
    })();
    return disposal;
  }

  return { states, conversations, model, chat, initialize, prepareNFCorpus, downloadMSMarco,
    openMSMarco, cancelDownload: () => downloadController?.abort(), loadModel, clearModel,
    removeCollection, dispose };
}

export type AppRuntime = ReturnType<typeof createAppRuntime>;
