// Test harness: serves the repo over http (ES module imports need it) and opens the chat mock with
// Tampermonkey stubs. GM values persist in sessionStorage so a reload keeps them.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright is installed globally (not a repo dependency), so load it with require.
const { chromium } = createRequire(import.meta.url)('playwright');

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png' };

export async function serve() {
  const server = http.createServer((req, res) => {
    const p = resolve(repo, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(repo) || !existsSync(p) || statSync(p).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }).end(readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + server.address().port, close: () => { server.closeAllConnections(); server.close(); } };
}

const STUBS = `
window.__gm = JSON.parse(sessionStorage.getItem('__gm') || '{}');
window.addEventListener('pagehide', () => sessionStorage.setItem('__gm', JSON.stringify(__gm)));
window.GM_getValue = (k, d) => (k in __gm ? __gm[k] : d);
window.GM_setValue = (k, v) => { __gm[k] = v; };
window.GM_deleteValue = (k) => { delete __gm[k]; };
window.__requests = [];
`;

// Torn's header icon sizes: 24px boxes, minimize lifted 4px, close 17px from minimize.
const TORN_ICONS = '[class*="header___"] > svg{width:24px;height:24px}[class*="minimizeIcon___"]{margin-bottom:4px}[class*="header___"] > svg[class*="closeIcon___"]{margin-left:17px}';

export const SCRIPT = () => readFileSync(resolve(repo, 'Torn Colored Chats/torn-colored-chats.user.js'), 'utf8');

export async function openMock(srv, { width = 1280, height = 800, gm = {}, script = true, dsf = 1 } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dsf });
  page.setDefaultTimeout(8000);
  await page.addInitScript(STUBS + 'Object.assign(window.__gm,' + JSON.stringify(gm) + ');');
  await page.goto(srv.base + '/Torn%20Colored%20Chats/tests/mock/chat.html');
  await page.addStyleTag({ content: TORN_ICONS });
  if (script) {
    await page.addScriptTag({ content: SCRIPT() });
    await page.waitForSelector('.tcc-pal', { state: 'attached', timeout: 5000 });
  }
  return { browser, page };
}
