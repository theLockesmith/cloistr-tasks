// Cold-load proof for the per-card deep link, /card/<id>.
//
// Serves the BUILT bundle (frontend/dist) with the same SPA fallback nginx
// uses (try_files ... /index.html), a fake /config.js and a stub backend, and
// drives real Chromium with a stub NIP-07 extension. Proves:
//   - signed out, /card/231 survives sign-in and lands on card #231
//   - signed in, a cold load of /card/231 opens card #231 on its board
//   - a missing or unreadable card shows a clear message
//   - "Copy link" copies the card URL
//
// Not part of `npm test` (the unit suite has no browser). Run it with:
//   npm run build && node e2e/card-deeplink.mjs
// It needs playwright-core and a Playwright Chromium; point PLAYWRIGHT_FROM at
// any node_modules directory that has playwright-core if this one does not.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_FROM ? path.join(process.env.PLAYWRIGHT_FROM, 'x') : import.meta.url);
const { chromium } = require('playwright-core');

const DIST = path.resolve(here, '../dist');
const SHOTS = process.env.SHOTS_DIR || null;
const PORT = 4417, ORIGIN = `http://localhost:${PORT}`;
const PK = 'a'.repeat(64);
const card = (id, title, column_id) => ({ id, column_id, title, description: 'Deep-link target', priority: 3,
  due_date: null, author_pubkey: PK, assignee_pubkey: null, sort_order: id, external_id: null,
  external_source: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', tags: [], checklist: null });
const BOARD = { id: 7, name: 'Fleet board', list_type: 'board', access: 'read', active: true, description: '', total_tasks: 0, completed_tasks: 0 };
const OTHER = { id: 3, name: 'Morning routine', list_type: 'checklist', access: 'owner', active: true, description: '', total_tasks: 0, completed_tasks: 0 };
const apiLog = [];

function api(req, res, url) {
  const j = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const p = url.pathname; apiLog.push(req.method + ' ' + p);
  if (p === '/api/auth/challenge') return j(200, { challenge: 'c', nonce: 'n' });
  if (p === '/api/auth/verify') return j(200, { access_token: 'tok', expires_at: new Date(Date.now() + 864e5).toISOString(), user: { id: PK, pubkey: PK } });
  if (p === '/api/auth/token-info') return j(200, { user: { id: PK, pubkey: PK } });
  if (p === '/api/lists') return j(200, [OTHER, BOARD]);
  if (p === '/api/cards/231') return j(200, { id: 231, list_id: 7, column_id: 2, access: 'read' });
  if (p.startsWith('/api/cards/')) return j(404, { error: 'Card not found' });
  if (p === '/api/boards/7') return j(200, { access: 'read', tags: [], columns: [
    { id: 1, name: 'Backlog', color: null, sort_order: 0, collapsed: false, cards: [card(12, 'Some other card', 1)] },
    { id: 2, name: 'Doing', color: null, sort_order: 1, collapsed: false, cards: [card(231, 'Card two-three-one', 2)] } ] });
  if (p === '/api/user/profile') return j(200, {});
  return j(200, []);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  if (url.pathname === '/config.js') { res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end(`window.__CLOISTR_CONFIG__=${JSON.stringify({ appUrl: ORIGIN, environment: 'production', relayUrl: 'wss://127.0.0.1:9', signerUrl: 'http://127.0.0.1:9' })};`); }
  let f = path.join(DIST, url.pathname);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); // try_files fallback
  const type = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch();
const NIP07 = `window.nostr = { getPublicKey: async () => '${PK}',
  signEvent: async (e) => ({ ...e, pubkey: '${PK}', id: '0'.repeat(64), sig: '0'.repeat(128) }) };`;
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };

async function ctx() {
  const c = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await c.addInitScript(NIP07);
  return c;
}

// 1. Signed out, cold load /card/231: sign in, land on the card.
{
  const c = await ctx(); const page = await c.newPage();
  await page.goto(ORIGIN + '/card/231');
  await page.waitForTimeout(2500);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'a1-signed-out.png') });
  check(page.url() === ORIGIN + '/card/231', 'signed out: URL is still /card/231 at the sign-in screen (' + page.url() + ')');
  await page.getByText('Other login methods').click();
  await page.waitForTimeout(400);
  const btn = page.getByRole('button', { name: /extension|nip-07|browser/i }).first();
  await btn.click({ timeout: 5000 });
  const modal = page.locator('.board-card-modal');
  await modal.waitFor({ timeout: 10000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'a2-card-open.png') });
  check(await modal.locator('.board-card-number').innerText() === '#231', 'after sign-in: card #231 detail is open');
  check(/Card two-three-one/.test(await modal.innerText()), 'after sign-in: it is the right card (title matches)');
  check(await page.locator('.board-view, .board-columns, [class*="board"]').first().isVisible(), 'the board holding the card is open behind it');
  check(page.url() === ORIGIN + '/card/231', 'URL stays /card/231 while the card is open');
  await modal.getByRole('button', { name: 'Copy link' }).click();
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip === ORIGIN + '/card/231', 'Copy link puts the card URL on the clipboard (' + clip + ')');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'a3-after-escape.png') });
  check(new URL(page.url()).pathname === '/', 'closing the card returns the address bar to / (' + page.url() + ')');
  await c.close();
}

// 2. Signed in already, cold load /card/231: straight to the card.
{
  const c = await ctx();
  await c.addInitScript(() => { localStorage.setItem('access_token', 'tok');
    localStorage.setItem('token_expiry', new Date(Date.now() + 864e5).toISOString()); });
  const page = await c.newPage();
  await page.goto(ORIGIN + '/card/231');
  const modal = page.locator('.board-card-modal');
  await modal.waitFor({ timeout: 10000 }).catch(() => {});
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'b-signed-in.png') });
  check(await modal.count() === 1 && (await modal.locator('.board-card-number').innerText()) === '#231', 'signed in: cold load of /card/231 opens card #231');
  await c.close();
}

// 3. A card that does not exist / cannot be seen: clear message.
{
  const c = await ctx();
  await c.addInitScript(() => { localStorage.setItem('access_token', 'tok');
    localStorage.setItem('token_expiry', new Date(Date.now() + 864e5).toISOString()); });
  const page = await c.newPage();
  await page.goto(ORIGIN + '/card/999');
  const alert = page.locator('.card-link-error');
  await alert.waitFor({ timeout: 10000 }).catch(() => {});
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'c-missing.png') });
  const txt = (await alert.count()) ? await alert.innerText() : '';
  check(/Card #999 doesn't exist, or this account can't see it/.test(txt), 'missing card: clear message shown (' + txt.split('\n')[0] + ')');
  check(await page.locator('.board-card-modal').count() === 0, 'missing card: no board or card opened');
  check(new URL(page.url()).pathname === '/', 'missing card: address bar reset to /');
  await c.close();
}

console.log('API calls:', [...new Set(apiLog)].join(', '));
await browser.close(); server.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
