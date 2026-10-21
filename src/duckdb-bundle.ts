import * as duckdb from '@duckdb/duckdb-wasm';
import mvpModule from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehModule from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

// Vite serves these from this app's origin and emits them under the configured
// base path. Runtime startup does not depend on a third-party worker or WASM CDN.
export const LOCAL_DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpModule, mainWorker: mvpWorker },
  eh: { mainModule: ehModule, mainWorker: ehWorker },
};

export async function createLocalDuckDB(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(LOCAL_DUCKDB_BUNDLES);
  if (!bundle.mainWorker) throw new Error('No compatible database worker is available in this browser.');
  const worker = new Worker(bundle.mainWorker);
  const database = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onError: (event: ErrorEvent) => void = () => {};
  const startupFailure = new Promise<never>((_resolve, reject) => {
    onError = event => reject(new Error(event.message
      ? `The local database worker could not start: ${event.message}`
      : 'The local database worker could not start. Reload the page to retry.'));
    worker.addEventListener('error', onError);
    timeout = setTimeout(() => reject(new Error('The local database took too long to start. Reload the page to retry.')), 45000);
  });
  try {
    await Promise.race([database.instantiate(bundle.mainModule, bundle.pthreadWorker), startupFailure]);
    return database;
  } catch (error) {
    // Instantiation may never have answered, so do not await worker shutdown or
    // send another request to it. Detach listeners and stop the worker directly.
    database.detach();
    worker.terminate();
    throw error;
  } finally {
    clearTimeout(timeout);
    worker.removeEventListener('error', onError);
  }
}
