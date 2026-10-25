#!/usr/bin/env node
// Greasy Fork publisher for this repo. Runs on a home PC (Greasy Fork's Cloudflare blocks cloud IPs).
//
//   node tools/greasyfork/gf.mjs login                 one-time: sign in, session kept in a local profile
//   node tools/greasyfork/gf.mjs status                webhook + every repo script's Greasy Fork state
//   node tools/greasyfork/gf.mjs publish "<Folder>"    import if new, point sync + additional info at the repo, sync
//   node tools/greasyfork/gf.mjs sync "<Folder>"       "Update and sync now" for a script already linked
//
// Flags: --headed (show the browser), --markup html|markdown (additional info, default markdown).
// Browser: installed Chrome, else Edge (GF_BROWSER_PATH overrides).
// The browser profile lives outside the repo (GF_PROFILE, default ~/.torn-greasyfork-chrome or -msedge).
// It holds the Greasy Fork session cookie only; nothing is written to the repo.

import { chromium } from 'playwright-core';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const OWNER = 'Yoonutz';
const REPO = 'torn-scripts';
const BRANCH = 'main';
const GF_HOST = process.env.GF_BASE || 'https://greasyfork.org';
const GF = `${GF_HOST}/en`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEBUG_PORT = 9339;
// Public author name. Google sign-in can overwrite it with the real name, so every write checks it first.
const GF_NAME = 'Kami Ren';

// Chrome first, Edge as fallback (every Windows PC has it). GF_BROWSER_PATH overrides.
function findBrowser() {
  if (process.env.GF_BROWSER_PATH) return process.env.GF_BROWSER_PATH;
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = platform() === 'win32'
    ? [...pf.map((d) => join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')), ...pf.map((d) => join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))]
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium'];
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error('No Chrome or Edge found. Set GF_BROWSER_PATH to the browser executable.');
  return hit;
}

// One profile per browser: Chrome and Edge cannot share a saved login.
const profileDir = () => process.env.GF_PROFILE || join(homedir(), `.torn-greasyfork-${basename(findBrowser()).replace(/\.exe$/i, '')}`);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--markup'));
const [cmd, folderArg] = positional;
const MARKUP = opt('markup', 'markdown');

const rawUrl = (...parts) =>
  `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/` +
  parts.join('/').split('/').map(encodeURIComponent).join('/');

function scriptFile(folder) {
  const dir = join(ROOT, folder);
  if (!existsSync(dir)) throw new Error(`No folder "${folder}" in repo root`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.user.js'));
  if (files.length !== 1) throw new Error(`"${folder}" must hold exactly one .user.js (found ${files.length})`);
  return files[0];
}

function repoScripts() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .flatMap((d) => {
      const js = readdirSync(join(ROOT, d.name)).filter((f) => f.endsWith('.user.js'));
      return js.length === 1 ? [{ folder: d.name, file: js[0] }] : [];
    });
}

const meta = (folder, file, key) =>
  (readFileSync(join(ROOT, folder, file), 'utf8').match(new RegExp(`^//\\s*@${key}\\s+(.+?)\\s*$`, 'm')) || [])[1];

// Numeric compare of dotted versions: <0, 0, >0.
const cmpVersion = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

async function openBrowser(headed) {
  const ctx = await chromium.launchPersistentContext(profileDir(), {
    executablePath: findBrowser(),
    headless: !headed,
    viewport: { width: 1200, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

// Waits out Cloudflare's interstitial. Returns false if it never clears.
async function go(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 30; i++) {
    if (!/just a moment/i.test(await page.title())) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

const signedIn = async (page) => (await page.locator('.sign-out-link').count()) > 0;

async function session(headed) {
  let b = await openBrowser(headed);
  if (!(await go(b.page, `${GF}/users/webhook-info`)) && !headed) {
    console.log('Cloudflare challenge in headless mode, retrying with a visible window...');
    await b.ctx.close();
    b = await openBrowser(true);
    if (!(await go(b.page, `${GF}/users/webhook-info`))) throw new Error('Cloudflare challenge did not clear');
  }
  if (!(await signedIn(b.page))) {
    await b.ctx.close();
    throw new Error('Not signed in to Greasy Fork. Run: node tools/greasyfork/gf.mjs login');
  }
  return b;
}

// Google refuses sign-in inside a Playwright-launched browser, so login starts the browser
// normally on the tool's profile and only watches the tab list over the DevTools port. It
// attaches to a page only before sign-in (to tick "Remember me", without which the session
// dies with the window) and after Greasy Fork shows the user signed in.
async function login() {
  const exe = findBrowser();
  const proc = spawn(exe, [`--user-data-dir=${profileDir()}`, `--remote-debugging-port=${DEBUG_PORT}`, '--no-first-run', '--no-default-browser-check', ...(process.env.GF_LOGIN_ARGS ? process.env.GF_LOGIN_ARGS.split(' ') : []), `${GF}/users/sign_in`], { stdio: 'ignore' });
  const cdp = `http://127.0.0.1:${DEBUG_PORT}`;
  const tabs = async () => (await (await fetch(`${cdp}/json/list`)).json()).filter((t) => t.type === 'page');
  const connect = async () => {
    for (let i = 0; i < 40; i++) {
      try { return await chromium.connectOverCDP(cdp); } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    throw new Error(`Could not reach ${exe} on port ${DEBUG_PORT}`);
  };

  let browser = await connect();
  const signInPage = browser.contexts()[0].pages().find((p) => p.url().startsWith(GF_HOST));
  if (signInPage) {
    await signInPage.waitForSelector('#remember_me, .sign-out-link', { timeout: 30_000 }).catch(() => {});
    await signInPage.check('#remember_me', { timeout: 2000 }).catch(() => {});
  }
  await browser.close(); // disconnects only; the window stays
  console.log(`Sign in to Greasy Fork in the ${exe.includes('chrome') ? 'Chrome' : 'Edge'} window that opened (waiting up to 10 minutes)...`);

  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for sign-in');
    if (proc.exitCode !== null) throw new Error('Browser window closed before sign-in finished');
    await new Promise((r) => setTimeout(r, 3000));
    const onGf = (await tabs().catch(() => [])).some((t) => t.url.startsWith(GF_HOST) && !/sign_in|\/auth\//.test(t.url));
    if (!onGf) continue;
    browser = await connect();
    const page = browser.contexts()[0].pages().find((p) => p.url().startsWith(GF_HOST) && !/sign_in|\/auth\//.test(p.url()));
    const name = page && (await page.locator('.user-profile-link a').first().textContent({ timeout: 2000 }).catch(() => null));
    if (name) {
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.close').catch(() => {}); // graceful, so cookies are flushed to disk
      console.log(`Signed in as ${name.trim()}. Session saved in ${profileDir()}`);
      return;
    }
    await browser.close();
  }
}

// Turns off name syncing from Google/GitHub sign-in and resets the display name to GF_NAME.
async function ensureName(page) {
  await go(page, `${GF}/users/edit_sign_in`);
  for (let i = 0; i < 5; i++) {
    const stop = page.locator('form:has(input[name="syncing"][value="0"]) [type=submit]').first();
    if (!(await stop.count())) break;
    await Promise.all([page.waitForLoadState('domcontentloaded'), stop.click()]);
    await page.waitForLoadState('domcontentloaded');
  }
  const current = (await page.locator('.user-profile-link a').first().textContent()).trim();
  if (current === GF_NAME) return;
  await go(page, `${GF}/users/edit`);
  await page.fill('#user_name', GF_NAME);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('form:has(#user_name) [type=submit]').last().click()]);
  await page.waitForLoadState('domcontentloaded');
  const now = (await page.locator('.user-profile-link a').first().textContent()).trim();
  if (now !== GF_NAME) throw new Error(`Account name is "${now}", could not change it to "${GF_NAME}". Nothing published.`);
  console.log(`Account name changed from "${current}" to "${GF_NAME}"`);
}

// Scripts Greasy Fork syncs from a git host, read from the webhook-info page (must be open).
async function syncedScripts(page) {
  return page.$$eval('li', (lis) =>
    lis
      .map((li) => {
        const links = [...li.querySelectorAll('a')];
        const script = links.find((a) => /\/scripts\/\d+/.test(a.getAttribute('href') || ''));
        const sync = links.find((a) => /^https:\/\/(raw\.githubusercontent|github)\.com\//.test(a.href));
        if (!script || !sync) return null;
        const type = (li.textContent.match(/\b(Webhook|Automatic|Manual)\b/i) || [])[1] || li.textContent.replace(/\s+/g, ' ').trim();
        return { name: script.textContent.trim(), url: script.href, sync: sync.href, type };
      })
      .filter(Boolean),
  );
}

// The signed-in account's own listings, from its profile page.
async function ownListings(page) {
  const profile = await page.locator('.user-profile-link a').first().evaluate((a) => a.href);
  await go(page, profile);
  return page.$$eval('#user-script-list li[data-script-id], li[data-script-id]', (lis) =>
    lis.map((li) => ({ id: li.dataset.scriptId, name: li.dataset.scriptName, version: li.dataset.scriptVersion })),
  );
}

// Greasy Fork accepts several URL forms for the same raw file; compare them in one form.
const canonical = (u) =>
  decodeURIComponent(u)
    .replace(/\+/g, ' ')
    .replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\//, 'https://raw.githubusercontent.com/$1/$2/')
    .replace(/(raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)refs\/heads\//, '$1');
const sameUrl = (a, b) => canonical(a) === canonical(b);

async function webhookState(page) {
  const secret = (await page.locator('textarea[readonly]').count()) > 0;
  const payload = await page
    .locator('dt:has-text("Payload URL") + dd')
    .first()
    .textContent()
    .catch(() => null);
  return { secret, payload: payload && payload.trim() };
}

function githubHook(payload) {
  const r = spawnSync('gh', ['api', `repos/${OWNER}/${REPO}/hooks`], { encoding: 'utf8', shell: platform() === 'win32' });
  if (r.status !== 0) return 'unknown (gh CLI missing or not signed in)';
  const hooks = JSON.parse(r.stdout);
  const hook = hooks.find((h) => (h.config?.url || '').includes('greasyfork.org'));
  if (!hook) return 'MISSING on GitHub';
  const bits = [hook.active ? 'active' : 'INACTIVE', hook.events.join(',')];
  if (payload && hook.config.url !== payload) bits.push(`url differs: ${hook.config.url}`);
  if (hook.last_response?.code) bits.push(`last delivery ${hook.last_response.code}`);
  return bits.join(', ');
}

async function status() {
  const { ctx, page } = await session(flag('headed'));
  const name = (await page.locator('.user-profile-link a').first().textContent()).trim();
  console.log(`Account name: ${name}${name === GF_NAME ? '' : `  (NOT "${GF_NAME}", publish/sync will fix it first)`}`);
  const wh = await webhookState(page);
  console.log(`Greasy Fork webhook secret: ${wh.secret ? 'set' : 'NOT SET'}`);
  console.log(`Payload URL: ${wh.payload || '?'}`);
  console.log(`GitHub hook: ${githubHook(wh.payload)}`);
  const synced = await syncedScripts(page);
  const own = await ownListings(page);
  console.log('\nRepo scripts:');
  for (const { folder, file } of repoScripts()) {
    const s = synced.find((x) => sameUrl(x.sync, rawUrl(folder, file)));
    const name = meta(folder, file, 'name');
    const listing = own.find((l) => l.name?.toLowerCase() === name?.toLowerCase());
    if (s) console.log(`  ${folder}: ${s.type}  ${s.url}`);
    else if (listing) console.log(`  ${folder}: on Greasy Fork (v${listing.version}) but NOT linked to the repo  ${GF}/scripts/${listing.id}`);
    else console.log(`  ${folder}: not on Greasy Fork`);
  }
  const strays = synced.filter((s) => !repoScripts().some(({ folder, file }) => sameUrl(s.sync, rawUrl(folder, file))));
  if (strays.length) {
    console.log('\nLinked to URLs no longer in the repo:');
    for (const s of strays) console.log(`  ${s.name}: ${s.sync}`);
  }
  await ctx.close();
}

async function importScript(page, jsUrl) {
  await go(page, `${GF}/import`);
  await page.fill('#sync-urls', jsUrl);
  await page.check('#sync-type-2');
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('form[action*="/import/add"] [type=submit]').click()]);
  await page.waitForLoadState('domcontentloaded');
  const href = await page.$$eval('li a', (as) => (as.find((a) => /\/scripts\/\d+/.test(a.href)) || {}).href);
  if (!href) {
    const text = (await page.locator('body').innerText()).slice(0, 1500);
    throw new Error(`Import did not return a script link:\n${text}`);
  }
  return href;
}

async function configureAndSync(page, scriptUrl, jsUrl, mdUrl) {
  await go(page, `${scriptUrl.replace(/\/$/, '')}/admin`);
  await page.fill('#script_sync_identifier', jsUrl);
  const webhook = page.locator('#script_sync_type_webhook');
  if (!((await webhook.count()) && (await webhook.isChecked()))) await page.check('#script_sync_type_automatic');
  if (mdUrl) {
    const idx = await page.$$eval('input[type=hidden][name^="additional_info_sync"][name$="[attribute_default]"]', (els) => {
      const el = els.find((e) => e.value === 'true');
      return el ? el.name.match(/\[(\d+)\]/)[1] : null;
    });
    if (idx === null) throw new Error('Default additional info field not found on the admin page');
    await page.fill(`input[name="additional_info_sync[${idx}][sync_identifier]"]`, mdUrl);
    await page.check(`input[name="additional_info_sync[${idx}][value_markup]"][value="${MARKUP}"]`);
  }
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/admin'), { timeout: 60_000 }), page.click('input[name="update-and-sync"]')]);
  const notice = (await page.locator('p.notice').first().textContent().catch(() => '')) || '(no notice)';
  return notice.trim();
}

async function servedVersion(page, scriptUrl) {
  const id = scriptUrl.match(/\/scripts\/(\d+)/)[1];
  await go(page, `${GF_HOST}/scripts/${id}/code/script.user.js`);
  return ((await page.locator('body').innerText()).match(/^\/\/\s*@version\s+(\S+)/m) || [])[1];
}

async function publish(syncOnly) {
  if (!folderArg) throw new Error('Pass the script folder name, e.g. "Torn Event Reminder"');
  const file = scriptFile(folderArg);
  const jsUrl = rawUrl(folderArg, file);
  const mdUrl = existsSync(join(ROOT, folderArg, 'greasyfork.md')) ? rawUrl(folderArg, 'greasyfork.md') : null;
  const head = await fetch(jsUrl);
  if (!head.ok) throw new Error(`${jsUrl} returns ${head.status}. Push the script to ${BRANCH} first.`);

  const { ctx, page } = await session(flag('headed'));
  await ensureName(page);
  await go(page, `${GF}/users/webhook-info`);
  let script = (await syncedScripts(page)).find((s) => sameUrl(s.sync, jsUrl));
  let scriptUrl = script?.url;
  const want = meta(folderArg, file, 'version');
  if (!scriptUrl) {
    if (syncOnly) throw new Error(`"${folderArg}" is not linked on Greasy Fork. Use publish.`);
    const name = meta(folderArg, file, 'name');
    const listing = (await ownListings(page)).find((l) => l.name?.toLowerCase() === name?.toLowerCase());
    if (listing) {
      // Linking an existing listing to an older repo file would roll users back.
      if (cmpVersion(want, listing.version) < 0) throw new Error(`Listing is v${listing.version}, repo is v${want}. Raise @version above it first.`);
      scriptUrl = `${GF}/scripts/${listing.id}`;
      console.log(`Linking existing listing v${listing.version}: ${scriptUrl}`);
    } else {
      console.log(`Importing ${jsUrl}`);
      scriptUrl = await importScript(page, jsUrl);
      console.log(`Imported: ${scriptUrl}`);
    }
  }
  const notice = await configureAndSync(page, scriptUrl, jsUrl, mdUrl);
  console.log(`Sync: ${notice}`);
  if (!mdUrl) console.log('No greasyfork.md in the folder, additional info left as is.');
  const got = await servedVersion(page, scriptUrl);
  console.log(`Version: repo ${want}, Greasy Fork ${got}${want === got ? '' : '  (MISMATCH: push pending or raw cache, rerun sync in 5 min)'}`);
  console.log(`Page: ${scriptUrl}`);
  await ctx.close();
  if (/failed/i.test(notice)) process.exitCode = 1;
}

const commands = { login, status, publish: () => publish(false), sync: () => publish(true) };
if (!commands[cmd]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n'));
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
