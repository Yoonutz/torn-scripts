// README screenshots. Run: node "Torn Colored Chats/tests/shots.mjs"
import { resolve } from 'node:path';
import { serve, openMock, repo } from './harness.mjs';

const out = (n) => resolve(repo, 'Torn Colored Chats', n);
const srv = await serve();
try {
  {
    const { browser, page } = await openMock(srv, { width: 1280, height: 520, dsf: 2 });
    await page.$eval('[id="trade"] button[class*="header___"]', (b) => b.classList.add('message___g25GS'));
    await page.click('[id="company"] .tcc-pal');
    const box = await page.locator('#chatRoot [class*="root___m3TJt"]').boundingBox();
    await page.screenshot({ path: out('screenshot.png'), clip: { x: 0, y: box.y - 4, width: 1232, height: box.height + 8 } });
    await browser.close();
  }
  {
    const { browser, page } = await openMock(srv, { width: 390, height: 520, dsf: 2 });
    await page.click('[id="trade"] .tcc-pal');
    const box = await page.locator('[id="trade"]').boundingBox();
    await page.screenshot({ path: out('screenshot-mobile.png'), clip: { x: 0, y: box.y - 4, width: 390, height: box.height + 8 } });
    await browser.close();
  }
} finally {
  srv.close();
}
