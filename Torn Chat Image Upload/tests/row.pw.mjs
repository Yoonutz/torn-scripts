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
    assert.equal(recent[0].owned, false);
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

test('userhashSent', () =>
  withPage({ gm: { 'cimg.userhash': 'h1' } }, async (page) => {
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    assert.equal((await page.evaluate(() => window.__requests))[0].data.userhash, 'h1');
    assert.equal(JSON.parse(await page.evaluate(() => window.__gm['cimg.recent']))[0].owned, true);
  }));

test('errorLine', () =>
  withPage({ gm: ID }, async (page) => {
    await page.evaluate(() => (window.__host = { status: 429, text: '<html>' }));
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    const line = page.locator('[id="111"] .cimg-status');
    await page.waitForFunction(() => /busy/.test(document.querySelector('[id="111"] .cimg-status')?.textContent || ''));
    assert.equal(await line.textContent(), 'Catbox is busy. Try again in a few minutes.');
    assert.equal(await page.locator('[id="111"] .cimg-btn').isDisabled(), false);
    assert.equal(await page.inputValue('[id="111"] textarea'), '');
  }));

test('wrongType', () =>
  withPage({ gm: ID }, async (page) => {
    await pick(page, '[id="111"]', { name: 'a.bmp', mimeType: 'image/bmp', buffer: Buffer.from('BM not a picture') });
    const line = page.locator('[id="111"] .cimg-status');
    await page.waitForFunction(() => /Use PNG/.test(document.querySelector('[id="111"] .cimg-status')?.textContent || ''));
    assert.equal(await line.textContent(), 'Use PNG, JPEG, GIF or WebP.');
    assert.equal((await page.evaluate(() => window.__requests)).length, 0);
  }));

// ---- Panel: user hash, recent uploads, delete ----
const RECENT = JSON.stringify([
  { id: 'ab12cd.png', link: 'https://files.catbox.moe/ab12cd.png', owned: true, at: 1763300000000 },
  { id: 'ef34gh.png', link: 'https://files.catbox.moe/ef34gh.png', owned: true, at: 1763200000000 },
]);
const OWNER = { 'cimg.userhash': 'h1', 'cimg.recent': RECENT };

test('hashFieldNoTornKey', () =>
  withPage({ gm: ID }, async (page) => {
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.click('[id="111"] .cimg-status a');
    await page.waitForSelector('#cimg-panel');
    const heads = await page.$$eval('#cimg-panel h3', (h) => h.map((x) => x.textContent));
    assert.ok(heads.includes('Catbox user hash (optional)'), heads.join('|'));
    assert.ok(!heads.some((h) => /torn|api key/i.test(h)), heads.join('|'));
  }));

test('hashSaveForget', () =>
  withPage({ gm: ID }, async (page) => {
    await page.click('[id="111"] .cimg-btn', { button: 'right' });
    await page.waitForSelector('#cimg-panel');
    await page.fill('#cimg-panel input[type="password"]', 'abcd1234');
    await page.click('#cimg-panel button:has-text("Save")');
    await page.waitForFunction(() => /Key saved/.test(document.getElementById('cimg-panel').textContent));
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    assert.equal((await page.evaluate(() => window.__requests))[0].data.userhash, 'abcd1234');
    await page.click('#cimg-panel button:has-text("Forget")');
    await page.waitForFunction(() => /No key saved/.test(document.getElementById('cimg-panel').textContent));
    assert.equal('cimg.userhash' in (await page.evaluate(() => window.__gm)), false);
  }));

test('deleteRecent', () =>
  withPage({ gm: OWNER }, async (page) => {
    await page.click('[id="111"] .cimg-btn', { button: 'right' });
    await page.waitForSelector('#cimg-panel .cimg-recent');
    assert.equal(await page.locator('#cimg-panel .cimg-recent').count(), 2);
    await page.evaluate(() => (window.__host = { status: 200, text: 'Files successfully deleted.' }));
    await page.locator('#cimg-panel .cimg-recent').first().locator('button').click();
    await page.waitForFunction(() => document.querySelectorAll('#cimg-panel .cimg-recent').length === 1);
    const req = (await page.evaluate(() => window.__requests)).pop();
    assert.equal(req.url, 'https://catbox.moe/user/api.php');
    assert.equal(req.data.reqtype, 'deletefiles');
    assert.equal(req.data.files, 'ab12cd.png');
    assert.equal(req.data.userhash, 'h1');
    assert.equal(JSON.parse(await page.evaluate(() => window.__gm['cimg.recent'])).length, 1);
  }));

test('noPanelUntilAsked', () =>
  withPage({}, async (page) => {
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#cimg-panel').count(), 0);
  }));

test('oldLocalHashStillWorks', () =>
  withPage({}, async (page) => {
    await page.evaluate(() => localStorage.setItem('cimg.userhash', JSON.stringify('old1')));
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    assert.equal((await page.evaluate(() => window.__requests))[0].data.userhash, 'old1');
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

test('deleteNeedsSuccess', () =>
  withPage({ gm: OWNER }, async (page) => {
    await page.click('[id="111"] .cimg-btn', { button: 'right' });
    await page.waitForSelector('#cimg-panel .cimg-recent');
    await page.evaluate(() => (window.__host = { status: 200, text: '' }));
    await page.locator('#cimg-panel .cimg-recent').first().locator('button').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#cimg-panel .cimg-recent').count(), 2);
    assert.equal(JSON.parse(await page.evaluate(() => window.__gm['cimg.recent'])).length, 2);
    assert.match(await page.locator('#cimg-panel .cimg-recent').first().textContent(), /not deleted/i);
  }));

test('rightClickOpensPanel', () =>
  withPage({ gm: ID }, async (page) => {
    let chooser = false;
    page.on('filechooser', () => (chooser = true));
    await page.click('[id="111"] .cimg-btn', { button: 'right' });
    await page.waitForSelector('#cimg-panel', { timeout: 3000 });
    assert.equal(chooser, false);
  }));

test('anonymousNoDelete', () =>
  withPage({ gm: { 'cimg.recent': JSON.stringify([{ id: 'ab12cd.png', link: 'https://files.catbox.moe/ab12cd.png', owned: false, at: 1 }]) } }, async (page) => {
    await page.click('[id="111"] .cimg-btn', { button: 'right' });
    await page.waitForSelector('#cimg-panel .cimg-recent');
    assert.equal(await page.locator('#cimg-panel .cimg-recent button').count(), 0);
  }));

test('manageRefreshesList', () =>
  withPage({}, async (page) => {
    await pick(page, '[id="111"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.click('[id="111"] .cimg-status a');
    await page.waitForSelector('#cimg-panel .cimg-recent');
    assert.equal(await page.locator('#cimg-panel .cimg-recent').count(), 1);
    // Second upload with the panel still open, then Manage again: list shows both.
    await page.evaluate(() => (window.__host = { status: 200, text: 'https://files.catbox.moe/zz99yy.png' }));
    await pick(page, '[id="3792311"]', { name: 'b.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="3792311"] textarea').value.includes('zz99yy'));
    await page.click('[id="3792311"] .cimg-status a');
    await page.waitForFunction(() => document.querySelectorAll('#cimg-panel .cimg-recent').length === 2);
    // Close the panel, upload a third, Manage: list shows three.
    await page.click('#cimg-panel button[aria-label="Close"]');
    await page.evaluate(() => (window.__host = { status: 200, text: 'https://files.catbox.moe/xx88ww.png' }));
    await pick(page, '[id="111"]', { name: 'c.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('xx88ww'));
    await page.click('[id="111"] .cimg-status a');
    await page.waitForFunction(() => document.querySelectorAll('#cimg-panel .cimg-recent').length === 3);
  }));

test('pdaSendsMultipartText', () =>
  withPage({ pda: true, gm: { 'cimg.userhash': 'h1' } }, async (page) => {
    await pick(page, '[id="111"]', { name: 'my shot (1).png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[id="111"] textarea').value.includes('catbox'));
    const req = (await page.evaluate(() => window.__requests))[0];
    assert.equal(typeof req.data, 'string');
    const m = /^multipart\/form-data; charset=iso-8859-1; boundary=(\S+)$/.exec(req.headers['Content-Type']);
    assert.ok(m, req.headers['Content-Type']);
    const parts = req.data.split('--' + m[1]);
    assert.equal(parts[parts.length - 1], '--\r\n');
    assert.ok(parts.some((p) => p.includes('name="reqtype"\r\n\r\nfileupload\r\n')));
    assert.ok(parts.some((p) => p.includes('name="userhash"\r\n\r\nh1\r\n')));
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
