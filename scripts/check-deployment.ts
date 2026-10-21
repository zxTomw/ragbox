import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const [address, expectedRevision] = process.argv.slice(2);
if (!address) throw new Error('Usage: npm run check:deployment -- <site URL> [expected commit SHA]');
const site = new URL(address.endsWith('/') ? address : `${address}/`);
if (!['https:', 'http:'].includes(site.protocol)) throw new Error('The deployment URL must use HTTP or HTTPS.');
const artifacts = resolve('artifacts/deployment');
mkdirSync(artifacts, { recursive: true });

// A successful deployment job can precede the CDN update. Wait for this exact
// revision before checking its assets, rather than accepting a cached old page.
if (expectedRevision) {
  let published = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    const manifest = new URL('deployment.json', site);
    manifest.searchParams.set('revision', expectedRevision);
    try {
      const response = await fetch(manifest, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(10_000) });
      if (response.ok && (await response.json() as { sha?: string }).sha === expectedRevision) {
        published = true;
        break;
      }
    } catch { /* A transient CDN response is retried within the bounded wait. */ }
    if (attempt < 24) {
      console.log('Waiting for the published revision to reach Pages…');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  if (!published) throw new Error(`Pages did not publish expected revision ${expectedRevision}.`);
}

const response = await fetch(site, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`The deployed page returned HTTP ${response.status}.`);
const html = await response.text();
if (/\bsrc=["'][^"']*\/src\/main\.tsx?["']/i.test(html)) {
  throw new Error('Pages is serving application source. Publish the Vite dist artifact using GitHub Actions.');
}
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
const styles = [...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["']/gi)].map(match => match[1]);
if (!scripts.length || !styles.length) throw new Error('The deployed page is missing compiled JavaScript or CSS.');
for (const [kind, paths] of [['JavaScript', scripts], ['CSS', styles]] as const) {
  for (const path of paths) {
    const asset = new URL(path, site);
    const result = await fetch(asset, { signal: AbortSignal.timeout(20_000) });
    const type = result.headers.get('content-type') ?? '';
    if (!result.ok || (kind === 'JavaScript' ? !/javascript/.test(type) : !type.includes('text/css'))) {
      throw new Error(`${kind} asset is unavailable or has the wrong content type: ${asset} (HTTP ${result.status}, ${type}).`);
    }
  }
}

const browser = await chromium.launch({
  ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  await page.goto(site.href, { waitUntil: 'networkidle', timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Ask your documents.' })).toBeVisible();
  await expect(page.locator('.workspace')).toHaveCSS('background-color', 'rgb(20, 21, 20)');
  await expect(page.getByRole('button', { name: 'Use NFCorpus', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use MS MARCO', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, 'desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await menu.click();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await page.screenshot({ path: resolve(artifacts, 'mobile.png'), fullPage: true });
  expect(errors, 'Browser runtime errors').toEqual([]);
  console.log(`Verified ${site.href}${expectedRevision ? ` at ${expectedRevision}` : ''}: compiled assets, dark React interface, and mobile navigation.`);
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context.tracing.stop({ path: resolve(artifacts, 'trace.zip') });
  await browser.close();
}
