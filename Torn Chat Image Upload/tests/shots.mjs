// README screenshots from the chat mock (P19: fresh renders, tight crop, DSF 2). Run: node "Torn Chat Image Upload/tests/shots.mjs"
import { resolve } from 'node:path';
import { serve, openMock, repo } from './harness.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const srv = await serve();
for (const [width, out] of [[390, 'screenshot-mobile.png']]) {
  const { browser, page } = await openMock(srv, { width, height: 800, dsf: 2, gm: {} });
  // Torn shows one chat window at a time on a phone: drop the other one, or it pushes 111 off screen.
  if (width < 600) await page.evaluate(() => document.getElementById('3792311').closest('.item___Db3l9').remove());
  await page.fill('[id="111"] textarea', 'my new loadout');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[id="111"] .cimg-btn')]);
  await fc.setFiles({ name: 'loadout.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('[id="111"] .cimg-status').waitFor();
  await page.locator('[id="111"]').screenshot({ path: resolve(repo, 'Torn Chat Image Upload', out) });
  await browser.close();
}
srv.close();
