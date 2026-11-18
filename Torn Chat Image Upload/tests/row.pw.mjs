// Chat row tests on the mock built from Ionut's chat HTML. Run: node --test "Torn Chat Image Upload/tests/row.pw.mjs"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve, openMock } from './harness.mjs';

let srv;
before(async () => (srv = await serve()));
after(() => srv.close());

async function withPage(opts, fn) {
  const { browser, page } = await openMock(srv, opts);
  try {
    await fn(page);
  } finally {
    await browser.close();
  }
}

test('oneButtonLeftOfSend', () =>
  withPage({}, async (page) => {
    const rows = await page.$$eval('textarea', (tas) => tas.map((t) => [...t.parentElement.children].map((c) => c.className)));
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.filter((c) => c.includes('cimg-btn')).length, 1);
      assert.match(r[r.length - 2], /cimg-btn/);
      assert.match(r[r.length - 1], /iconWrapper___DRSkm/);
    }
  }));

test('twoWindows', () =>
  withPage({}, async (page) => {
    assert.equal(await page.locator('.cimg-btn').count(), 2);
    assert.equal(await page.locator('[id="111"] .cimg-btn').count(), 1);
    assert.equal(await page.locator('[id="3792311"] .cimg-btn').count(), 1);
  }));

test('reRenderNoDup', () =>
  withPage({}, async (page) => {
    await page.evaluate(() => {
      document.getElementById('111').outerHTML = window.__original;
    });
    await page.waitForTimeout(1300);
    assert.equal(await page.locator('[id="111"] .cimg-btn').count(), 1);
    assert.equal(await page.locator('.cimg-btn').count(), 2);
  }));

for (const width of [1280, 390])
  test('noWiden at ' + width, () =>
    withPage({ width }, async (page) => {
      const bad = await page.$$eval('textarea', (tas) => tas.map((t) => t.parentElement).filter((r) => r.scrollWidth > r.clientWidth).length);
      assert.equal(bad, 0);
      const btn = await page.locator('[id="111"] .cimg-btn').boundingBox();
      assert.ok(btn.width >= 20 && btn.width <= 28, 'button width ' + btn.width);
    }));


// ---- Task 3: pick, paste, upload, insert link ----
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ID = {};

async function pick(page, sel, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(sel + ' .cimg-btn')]);
  await fc.setFiles(file);
}

test('pickUploads', () =>
  withPage({ gm: ID }, async (page) => {
    await page.fill('[id="111"] textarea', 'look');
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    assert.equal(await page.inputValue('[id="111"] textarea'), 'look https://files.catbox.moe/ab12cd.png ');
    assert.equal(await page.inputValue('[id="3792311"] textarea'), '');
    const req = await page.evaluate(() => window.__requests);
    assert.equal(req.length, 1);
    assert.equal(req[0].url, 'https://catbox.moe/user/api.php');
    assert.equal(req[0].data.reqtype, 'fileupload');
    assert.equal(req[0].data.fileToUpload.size, PNG.length);
    assert.equal('userhash' in req[0].data, false);
    const recent = JSON.parse(await page.evaluate(() => window.__gm['cimg.recent']));
    assert.equal(recent.length, 1);
    assert.equal(recent[0].id, 'ab12cd.png');
    assert.equal(await page.evaluate(() => window.__sendClicks), 0);
    assert.equal(await page.locator('[id="111"] button.iconWrapper___DRSkm').isDisabled(), false);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[id="111"] textarea')), true);
  }));

test('pasteImage', () =>
  withPage({ gm: ID }, async (page) => {
    const prevented = await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'p.png', { type: 'image/png' }));
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('[id="3792311"] textarea').dispatchEvent(ev);
      return ev.defaultPrevented;
    }, PNG.toString('base64'));
    assert.equal(prevented, true);
    await page.waitForFunction(() => document.querySelector('[id="3792311"] textarea').value.includes('catbox'));
    assert.equal(await page.inputValue('[id="3792311"] textarea'), 'https://files.catbox.moe/ab12cd.png ');
  }));

test('pasteTextIgnored', () =>
  withPage({ gm: ID }, async (page) => {
    const prevented = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'hello');
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('[id="111"] textarea').dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(prevented, false);
    await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.__requests)).length, 0);
  }));

test('noKeyNeeded', () =>
  withPage({}, async (page) => {
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
  }));


// ---- Panel: plain list of past links ----
const RECENT = JSON.stringify([
  { id: 'ab12cd.png', link: 'https://files.catbox.moe/ab12cd.png', owned: true, at: 1763300000000 },
  { id: 'ef34gh.png', link: 'https://files.catbox.moe/ef34gh.png', owned: false, at: 1763200000000 },
]);
const OWNER = { 'cimg.userhash': 'h1', 'cimg.recent': RECENT };

test('plainHistoryOnly', () =>
  withPage({ gm: OWNER }, async (page) => {
    await page.click('[id="111"] .cimg-btn', { button: 'right' });
    await page.waitForSelector('#cimg-panel .cimg-recent');
    assert.equal(await page.locator('#cimg-panel .cimg-recent').count(), 2);
    assert.equal(await page.locator('#cimg-panel .cimg-body button, #cimg-panel input, #cimg-panel h3').count(), 0);
    assert.equal(await page.locator('#cimg-panel .cimg-recent a').first().getAttribute('href'), 'https://files.catbox.moe/ab12cd.png');
    assert.doesNotMatch(await page.locator('#cimg-panel').textContent(), /hash|delete|anyone|key/i);
  }));

test('noManageLinkAfterUpload', () =>
  withPage({}, async (page) => {
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => /Link added/.test(document.querySelector('[id="111"] .cimg-status')?.textContent || ''));
    assert.equal(await page.locator('[id="111"] .cimg-status a').count(), 0);
    assert.equal(await page.locator('#cimg-panel').count(), 0);
  }));

test('oldHashIgnored', () =>
  withPage({ gm: { 'cimg.userhash': 'h1' } }, async (page) => {
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    assert.equal('userhash' in (await page.evaluate(() => window.__requests))[0].data, false);
  }));

test('keepsAllLinks', () =>
  withPage({ gm: { 'cimg.recent': JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i + '.png', link: 'https://files.catbox.moe/x' + i + '.png', at: i }))) } }, async (page) => {
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    assert.equal(JSON.parse(await page.evaluate(() => window.__gm['cimg.recent'])).length, 31);
  }));

test('noPanelUntilAsked', () =>
  withPage({}, async (page) => {
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#cimg-panel').count(), 0);
  }));

test('scriptHasNoCommentsOrKitCode', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { repo } = await import('./harness.mjs');
  const src = readFileSync(resolve(repo, 'Torn Chat Image Upload/torn-chat-image-upload.user.js'), 'utf8');
  const body = src.slice(src.indexOf('// ==/UserScript==') + 18);
  assert.equal(/^\s*\/\/|\/\*/m.test(body), false, 'comment found');
  assert.equal(/occ|openrouter|runner|api\.torn\.com|torn api/i.test(body), false, 'unrelated code found');
});

// ---- Final review fixes ----
test('caretMidText', () =>
  withPage({ gm: ID }, async (page) => {
    await page.fill('[id="111"] textarea', 'hi there');
    await page.evaluate(() => document.querySelector('[id="111"] textarea').setSelectionRange(2, 2));
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    assert.equal(await page.inputValue('[id="111"] textarea'), 'hi https://files.catbox.moe/ab12cd.png there');
  }));

test('staleTextarea', () =>
  withPage({ gm: ID }, async (page) => {
    await page.evaluate(() => {
      const old = document.querySelector('[id="111"] textarea');
      const fresh = old.cloneNode(true);
      old.replaceWith(fresh);
    });
    await page.waitForTimeout(1300);
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    const prevented = await page.evaluate((b64) => {
      const ta = document.querySelector('[id="111"] textarea');
      ta.value = '';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'p.png', { type: 'image/png' }));
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      ta.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, PNG.toString('base64'));
    assert.equal(prevented, true);
  }));

test('officePasteKeepsText', () =>
  withPage({ gm: ID }, async (page) => {
    const prevented = await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.setData('text/plain', 'A1 B1');
      dt.items.add(new File([bytes], 'cells.png', { type: 'image/png' }));
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('[id="111"] textarea').dispatchEvent(ev);
      return ev.defaultPrevented;
    }, PNG.toString('base64'));
    assert.equal(prevented, false);
    await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.__requests)).length, 0);
  }));

test('rightClickOpensPanel', () =>
  withPage({ gm: ID }, async (page) => {
    let chooser = false;
    page.on('filechooser', () => (chooser = true));
    await page.click('[id="111"] .cimg-btn', { button: 'right' });
    await page.waitForSelector('#cimg-panel', { timeout: 3000 });
    assert.equal(chooser, false);
  }));

test('pdaSendsMultipartText', () =>
  withPage({ pda: true }, async (page) => {
    await pick(page, '[id="111"]', { name: 'my shot (1).png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    const req = (await page.evaluate(() => window.__requests))[0];
    assert.equal(typeof req.data, 'string');
    const m = /^multipart\/form-data; charset=iso-8859-1; boundary=(\S+)$/.exec(req.headers['Content-Type']);
    assert.ok(m, req.headers['Content-Type']);
    const parts = req.data.split('--' + m[1]);
    assert.equal(parts[parts.length - 1], '--\r\n');
    assert.ok(parts.some((p) => p.includes('name="reqtype"\r\n\r\nfileupload\r\n')));
    const file = parts.find((p) => p.includes('name="fileToUpload"'));
    assert.ok(file.includes('filename="my_shot__1_.png"\r\nContent-Type: image/png\r\n\r\n'));
    const bytes = file.slice(file.indexOf('\r\n\r\n') + 4, -2);
    assert.equal(Buffer.from(bytes, 'latin1').equals(PNG), true);
  }));

test('cameraPhotoWithoutType', () =>
  withPage({}, async (page) => {
    const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    await pick(page, '[id="111"]', { name: '1763300000000', mimeType: '', buffer: JPG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    const f = (await page.evaluate(() => window.__requests))[0].data.fileToUpload;
    assert.equal(f.type, 'image/jpeg');
    assert.equal(f.name, '1763300000000.jpg');
    assert.equal(f.size, JPG.length);
  }));

test('uploadingShownAtOnce', () =>
  withPage({}, async (page) => {
    await page.evaluate(() => {
      const real = window.GM_xmlhttpRequest;
      window.GM_xmlhttpRequest = (o) => setTimeout(() => real(o), 1500);
    });
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => /Uploading/.test(document.querySelector('[id="111"] .cimg-status')?.textContent || ''), null, { timeout: 1000 });
  }));
