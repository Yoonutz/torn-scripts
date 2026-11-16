// Test harness: serves the repo over http (ES module imports need it) and opens the chat mock with
// Tampermonkey stubs. GM_xmlhttpRequest answers from window.__host (status, text) and logs requests.
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
window.GM_getValue = (k, d) => (k in __gm ? __gm[k] : d);
window.GM_setValue = (k, v) => { __gm[k] = v; };
window.GM_deleteValue = (k) => { delete __gm[k]; };
window.__requests = [];
window.__host = { status: 200, text: 'https://files.catbox.moe/ab12cd.png' };
window.GM_xmlhttpRequest = (o) => {
  const d = o.data instanceof FormData ? Object.fromEntries([...o.data].map(([k, v]) => [k, typeof v === 'string' ? v : { name: v.name, size: v.size, type: v.type }])) : o.data;
  __requests.push({ method: o.method, url: o.url, headers: o.headers, data: d });
  setTimeout(() => o.onload({ status: __host.status, responseText: __host.text }), 50);
};
`;

export async function openMock(srv, { width = 1280, height = 800, gm = {}, script = true, dsf = 1, pda = false } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dsf });
  page.setDefaultTimeout(8000);
  await page.addInitScript(STUBS + 'Object.assign(window.__gm,' + JSON.stringify(gm) + ');' + (pda ? 'window.PDA_httpGet = function () {};' : ''));
  await page.goto(srv.base + '/Torn%20Chat%20Image%20Upload/tests/mock/chat.html');
  if (script) {
    await page.addScriptTag({ content: readFileSync(resolve(repo, 'Torn Chat Image Upload/torn-chat-image-upload.user.js'), 'utf8') });
    await page.waitForSelector('.cimg-btn', { timeout: 5000 });
  }
  return { browser, page };
}
