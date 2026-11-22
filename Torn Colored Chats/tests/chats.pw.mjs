// Run: node --test "Torn Colored Chats/tests/chats.pw.mjs"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve, openMock, SCRIPT } from './harness.mjs';

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

const head = (id) => `[id="${id}"] button[class*="header___"]`;
const bg = (page, id) => page.$eval(head(id), (b) => getComputedStyle(b).backgroundImage);
const GROUPS = { faction: 'rgb(179, 58, 58)', company: 'rgb(42, 111, 179)', global: 'rgb(31, 138, 138)', trade: 'rgb(176, 138, 26)' };

test('privateUntouched', () =>
  withPage({}, async (page) => {
    assert.equal(await page.locator('[id="2195339"] .tcc-pal').count(), 0);
    assert.equal(await page.locator('[id="2195339"][data-tcc]').count(), 0);
    assert.match(await bg(page, '2195339'), /rgb\(102, 102, 102\)/);
  }));

test('groupsColored', () =>
  withPage({}, async (page) => {
    for (const [id, rgb] of Object.entries(GROUPS)) {
      assert.equal(await page.locator(`[id="${id}"] .tcc-pal`).count(), 1, id);
      const next = await page.$eval(`[id="${id}"] .tcc-pal`, (p) => p.nextElementSibling.getAttribute('class'));
      assert.match(next, /minimizeIcon___/);
      assert.ok((await bg(page, id)).includes(rgb), id + ' ' + (await bg(page, id)));
    }
  }));

test('messagesTinted', () =>
  withPage({}, async (page) => {
    const c = await page.$eval('[id="faction"] [class*="content___"]', (e) => getComputedStyle(e).backgroundImage);
    assert.match(c, /linear-gradient\(rgb\(\d+, \d+, \d+\), rgb\(\d+, \d+, \d+\)\)/);
    const [top, bottom] = c.match(/rgb\([^)]+\)/g);
    assert.notEqual(top, bottom);
    const p = await page.$eval('[id="2195339"] [class*="content___"]', (e) => getComputedStyle(e).backgroundColor);
    assert.equal(p, 'rgb(51, 51, 51)');
  }));

test('newMessageGreenKept', () =>
  withPage({}, async (page) => {
    await page.$eval(head('trade'), (b) => b.classList.add('message___g25GS'));
    assert.match(await bg(page, 'trade'), /rgb\(12, 113, 62\)/);
  }));

test('pickColor', () =>
  withPage({}, async (page) => {
    await page.click('[id="faction"] .tcc-pal');
    await page.waitForSelector('#tcc-pop');
    await page.click('#tcc-pop [data-c="#2a6fb3"]');
    assert.ok((await bg(page, 'faction')).includes('rgb(42, 111, 179)'));
    assert.equal(await page.evaluate(() => window.__gm['tcc.colors'].faction), '#2a6fb3');
    assert.equal(await page.evaluate(() => window.__toggles), 0);
    assert.equal(await page.evaluate(() => window.__drags), 0);
    assert.equal(await page.locator('#tcc-pop').count(), 0);
  }));

test('noneAndDefault', () =>
  withPage({}, async (page) => {
    await page.click('[id="company"] .tcc-pal');
    await page.click('#tcc-pop [data-c="none"]');
    assert.match(await bg(page, 'company'), /rgb\(102, 102, 102\)/);
    assert.equal(await page.locator('[id="company"] .tcc-pal').count(), 1);
    await page.click('[id="company"] .tcc-pal');
    await page.click('#tcc-pop [data-c="default"]');
    assert.ok((await bg(page, 'company')).includes(GROUPS.company));
  }));

test('keptAfterReload', () =>
  withPage({}, async (page) => {
    await page.click('[id="global"] .tcc-pal');
    await page.click('#tcc-pop [data-c="#b33a7a"]');
    await page.reload();
    await page.addScriptTag({ content: SCRIPT() });
    await page.waitForSelector('.tcc-pal');
    assert.ok((await bg(page, 'global')).includes('rgb(179, 58, 122)'));
  }));

test('reRenderNoDup', () =>
  withPage({}, async (page) => {
    await page.evaluate(() => {
      document.getElementById('faction').outerHTML = window.__original;
    });
    await page.waitForFunction(() => document.querySelectorAll('[id="faction"] .tcc-pal').length === 1);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.tcc-pal').count(), 4);
    assert.ok((await bg(page, 'faction')).includes(GROUPS.faction));
  }));

test('lightTheme', () =>
  withPage({}, async (page) => {
    await page.evaluate(() => document.body.classList.remove('dark-mode'));
    const c = await page.$eval('[id="faction"] [class*="content___"]', (e) => getComputedStyle(e).backgroundImage);
    const [r, g, b] = c.match(/\d+/g).map(Number);
    assert.ok(r > 200 && g > 190 && b > 190, c);
  }));

for (const width of [1280, 390])
  test('noWiden and popupInViewport at ' + width, () =>
    withPage({ width }, async (page) => {
      const bad = await page.$$eval('button[class*="header___"]', (hs) => hs.filter((h) => h.scrollWidth > h.clientWidth).map((h) => h.closest('[id]').id));
      assert.deepEqual(bad, []);
      const ids = await page.$$eval('.tcc-pal', (ps) => ps.filter((p) => p.getBoundingClientRect().right < innerWidth).map((p) => p.closest('[id]').id));
      const id = ids[ids.length - 1];
      await page.click(`[id="${id}"] .tcc-pal`);
      const box = await page.locator('#tcc-pop').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, JSON.stringify(box));
      assert.ok(box.y >= 0, JSON.stringify(box));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }));

test('escapeAndOutsideClose', () =>
  withPage({}, async (page) => {
    await page.click('[id="trade"] .tcc-pal');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#tcc-pop').count(), 0);
    await page.click('[id="trade"] .tcc-pal');
    await page.mouse.click(5, 5);
    assert.equal(await page.locator('#tcc-pop').count(), 0);
  }));
