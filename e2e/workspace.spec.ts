import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

// Managed test environments can provide official extension binaries downloaded
// through their trusted proxy. This avoids changing browser TLS verification.
// Without these optional paths, DuckDB fetches its normal HTTPS extension URLs.
async function extensionAssets(context: BrowserContext) {
  for (const [name, path] of [
    ['fts', process.env.RAGBOX_FTS_WASM_PATH],
    ['json', process.env.RAGBOX_JSON_WASM_PATH],
  ] as const) {
    if (!path) continue;
    if (!existsSync(path)) throw new Error(`The configured ${name} extension file does not exist: ${path}`);
    await context.route(new RegExp(`^https://extensions\\.duckdb\\.org/[^/]+/wasm_eh/${name}\\.duckdb_extension\\.wasm$`), route => route.fulfill({
      path,
      contentType: 'application/wasm',
      headers: { 'access-control-allow-origin': '*' },
    }));
  }
}

function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ context }) => { await extensionAssets(context); });

test('prepares the real NFCorpus, searches, inspects sources, and restores its conversation', async ({ page }) => {
  test.skip(!existsSync('public/data/nfcorpus.jsonl'), 'Prepare public/data/nfcorpus.jsonl with npm run prepare:nfcorpus before this browser test.');
  const errors = pageErrors(page);
  await page.goto('/');
  const prepare = page.getByRole('button', { name: 'Prepare NFCorpus', exact: true });
  await expect(prepare).toBeEnabled({ timeout: 60_000 });
  await prepare.click();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('textbox', { name: 'Message' }).fill('breast cancer');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: '10 sources', exact: true }).click();
  await expect(page.locator('.source-card')).toHaveCount(10);
  await page.locator('.source-card').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const title = await page.locator('.source-document-title').innerText();
  const text = await page.locator('.source-document-text').innerText();
  expect(title.length).toBeGreaterThan(10);
  expect(text.length).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('button', { name: '10 sources', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('textbox', { name: 'Message' }).fill('green tea');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.chat-turn')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '10 sources', exact: true })).toHaveCount(2);

  // A follow-up must not replace the earlier turn's saved evidence.
  await page.getByRole('button', { name: '10 sources', exact: true }).first().click();
  await page.locator('.chat-turn').first().locator('.source-card').first().click();
  await expect(page.locator('.source-document-title')).toHaveText(title);
  await expect(page.locator('.source-document-text')).toHaveText(text);
  expect(errors).toEqual([]);
});

test('opens and searches a real saved MS MARCO database and returns from setup to chat', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Prepare NFCorpus', exact: true })).toBeEnabled({ timeout: 60_000 });

  // This deliberately small five-passage database exercises the same persisted
  // schema, FTS macro, OPFS reopen, and retrieval code as the 3.35 GB artifact.
  await page.evaluate(async () => {
    const runtimeModule = '/src/duckdb-bundle.ts';
    const duckdbModule = '/node_modules/.vite/deps/@duckdb_duckdb-wasm.js';
    const { createLocalDuckDB } = await import(runtimeModule);
    const duckdb = await import(duckdbModule);
    const database = await createLocalDuckDB();
    const root = await navigator.storage.getDirectory();
    for (const name of ['msmarco-prebuilt.duckdb', 'msmarco-prebuilt.duckdb.wal']) {
      const handle = await root.getFileHandle(name, { create: true });
      await database.registerFileHandle(`opfs://${name}`, handle, duckdb.DuckDBDataProtocol.BROWSER_FSACCESS, true);
    }
    await database.open({ path: 'opfs://msmarco-prebuilt.duckdb', accessMode: duckdb.DuckDBAccessMode.READ_WRITE, opfs: { fileHandling: 'auto' } });
    const connection = await database.connect();
    try {
      await connection.query('INSTALL fts; LOAD fts');
      await connection.query(`CREATE TABLE msmarco(id INTEGER, contents VARCHAR);
        INSERT INTO msmarco VALUES
        (1, 'Solar panels generate electricity by converting sunlight through photovoltaic cells.'),
        (2, 'The greenhouse effect warms Earth by trapping infrared radiation.'),
        (3, 'Alexander Graham Bell invented the telephone.'),
        (4, 'Insulin regulates blood sugar by enabling cells to absorb glucose.'),
        (5, 'Photosynthesis helps plants convert sunlight into energy.');`);
      await connection.query("PRAGMA create_fts_index('msmarco', 'id', 'contents', overwrite = 1)");
      await connection.query('CHECKPOINT');
    } finally {
      await connection.close();
      await database.terminate();
    }
  });

  await page.reload();
  await page.getByRole('button', { name: 'Use MS MARCO', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('solar panels');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: '1 source', exact: true }).click();
  await expect(page.locator('.source-card')).toHaveCount(1);
  await expect(page.locator('.source-card')).toContainText('MARCO-1');
  await page.locator('.source-card').click();
  await expect(page.locator('.source-document-text')).toHaveText('Solar panels generate electricity by converting sunlight through photovoltaic cells.');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Collections', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace setup', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use MS MARCO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'solar panels', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 source', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps mobile navigation and setup keyboard-accessible with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ask your documents.' })).toBeVisible();
  expect(await page.locator('.welcome-title').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  expect(await page.locator('.welcome-title').evaluate(element => getComputedStyle(element).transform)).toBe('none');

  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  const close = page.getByRole('button', { name: 'Close navigation', exact: true });
  await open.click();
  await expect(close).toBeFocused();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'View RAGbox on GitHub' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar-open/);

  await open.click();
  await page.getByRole('button', { name: 'Collections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collections', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'About local answers', exact: true }).click();
  const modelTab = page.getByRole('tab', { name: 'Answer model', exact: true });
  await modelTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Storage', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Storage', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
