// Operational Command Center shell: the icon next to the player's name, the floating window and its
// tabs. Tabs come from two places: plug-ins bundled into this build (mount) and the runner's skill
// list (an AI answer view). Badges (small pills like company trains) sit right of the icon.
import { el, esc, safeIcon, letterIcon } from '../core/dom.js';
import { store, vault, isPda } from '../core/storage.js';
import { http, parseJson } from '../core/http.js';
import { tornKey, KEY_TORN } from '../core/torn.js';
import { ai, KEY_OR, RUNNER } from '../core/ai.js';
import { injectTheme } from '../core/theme.js';
import { frameCss, trapScroll } from '../core/frame.js';
import { errCard, accordion, fillStats, keyField, button } from '../core/ui.js';
import { mdToHtml, mdSections } from '../core/md.js';
import { makeKit } from '../core/kit.js';

const KEY_OPEN = 'occ.open';
const KEY_TAB = 'occ.skill';
const KEY_ANS = 'occ.ans.';
const KEY_SKILLS = 'occ.skills';
const OWNER_ID = '2805199';
const STALE_MS = 12 * 3600 * 1000;
const CANCELLED = 'Cancelled.';
const SETUP = 'settings';

const OCC_ICON = {
  dash: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 12v.01"/><path d="M19.071 4.929c-1.562-1.562-6 .337-9.9 4.243c-3.905 3.905-5.804 8.337-4.242 9.9c1.562 1.561 6-.338 9.9-4.244c3.905-3.905 5.804-8.337 4.242-9.9"/><path d="M4.929 4.929c-1.562 1.562.337 6 4.243 9.9c3.905 3.905 8.337 5.804 9.9 4.242c1.561-1.562-.338-6-4.244-9.9c-3.905-3.905-8.337-5.804-9.9-4.242"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
};

const OCC_CSS = `
  button.occ-inline{all:unset;box-sizing:border-box;position:relative;z-index:5;display:inline-flex!important;align-items:center;justify-content:center;width:18px;height:18px;min-width:18px;min-height:18px;margin:0 0 0 6px;padding:0;border:0;border-radius:4px;background:transparent;color:#f2c14e;vertical-align:middle;cursor:pointer;flex:none;overflow:visible;text-indent:0;font-size:0;line-height:0;-webkit-tap-highlight-color:transparent}
  button.occ-inline>svg{display:block;width:16px!important;height:16px!important;fill:none!important;stroke:#f2c14e!important;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;opacity:1;visibility:visible}
  button.occ-inline:active{transform:scale(.9)}
  button.occ-inline:focus-visible{box-shadow:0 0 0 2px rgba(242,193,78,.5)}
  .occ-badges{all:unset;box-sizing:border-box;display:inline-flex!important;align-items:center;flex:none;vertical-align:middle;white-space:nowrap}
  .occ-badges:empty{display:none!important}
  .occ-badges.occ-float{position:fixed;right:16px;bottom:142px;margin:0;z-index:99990}
  .occ-dock{display:flex;align-items:center;justify-content:flex-start;box-sizing:border-box;width:100%;margin:0;padding:3px 12px 0;background:transparent;pointer-events:none;position:relative;z-index:1}
  .occ-dock .occ-inline,.occ-dock .occ-badges{pointer-events:auto}
  .occ-dock .occ-inline{margin:0 0 0 2px}
  @media (min-width:768px){
    .occ-badges.occ-float{bottom:80px;right:24px}
  }

`;

// Anchors we are willing to sit next to, best first. The first two are the desktop sidebar, which
// Torn PDA does not render at all. Torn's sidebar moved to camelCase hashed classes in 2026-10:
// <p class="menuInfoRow___x"><span>Name:</span><a class="menuValue___x" href="/profiles.php?XID=...">.
// The kebab-case ones are kept for the old layout.
const NAME_ANCHORS = [
  'a[class*="menuValue"][href*="profiles.php"]',
  '[class*="menuInfoRow"] a[href*="profiles.php"]',
  '[class*="userInformation"] a[href*="profiles.php"]',
  '[class*="user-information"] a[href*="profiles.php"]',
  '[class*="menu-value"] a[href*="profiles.php"]',
];
const MOBILE_INFO = '[class*="user-information-mobile"],[class*="userInformationMobile"]';

export function boot(plugins) {
  const kit = makeKit('occ', () => document.getElementById('occ-root'));
  const panels = plugins.filter((p) => typeof p.mount === 'function');
  const badges = plugins.filter((p) => typeof p.badge === 'function');
  let remote = (store.get(KEY_SKILLS, []) || []).map(fromRunner);
  let tabs = [];
  let win, main, title, sub, launch, tabBar, statsRow, tool, rerun, gear;
  const btns = {};
  const inflight = {};
  let current = null;

  // A standalone build of a bundled plug-in steps aside when it sees its id here.
  document.documentElement.setAttribute('data-occ-plugins', plugins.map((p) => p.id).join(' '));

  function fromRunner(r) {
    return { id: r.id, label: r.label, icon: safeIcon(r.icon) || letterIcon(r.label), access: r.access || 'full', skill: r.id };
  }

  function plugTab(p) {
    return { id: p.id, label: p.label, icon: safeIcon(p.icon) || letterIcon(p.label), access: p.access || 'minimal', plugin: p };
  }

  // Bundled plug-ins first; a runner skill that a plug-in already owns (plugin.skill) is not listed twice.
  function allTabs() {
    const owned = panels.map((p) => p.skill).filter(Boolean);
    return panels.map(plugTab).concat(remote.filter((s) => owned.indexOf(s.id) === -1));
  }

  async function loadSkills() {
    try {
      const r = await http({ url: RUNNER + '/skills' });
      const json = parseJson(r.text);
      if (r.status !== 200 || !Array.isArray(json.skills)) return false;
      store.set(KEY_SKILLS, json.skills);
      remote = json.skills.map(fromRunner);
      renderTabs();
      return true;
    } catch (e) {
      return false;
    }
  }

  function setActive(id) {
    current = id;
    Object.keys(btns).forEach((k) => btns[k].classList.toggle('occ-act', k === id));
    gear.classList.toggle('occ-act', id === SETUP);
    tool.hidden = !id || id === SETUP;
  }

  function setHead(label, meta) {
    title.textContent = label || 'Command Center';
    sub.innerHTML = meta || '';
  }

  function show(node) {
    main.innerHTML = '';
    main.appendChild(node);
    main.scrollTop = 0;
  }

  function metaHtml(a) {
    const when = new Date(a.at);
    const shortModel = String(a.model || '').split('/').pop().replace(/:free$/, '');
    const today = new Date().toDateString() === when.toDateString();
    const stamp = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (today ? '' : ', ' + when.toLocaleDateString());
    const age = Date.now() - a.at;
    const old = age > STALE_MS ? ' · <span class="occ-old">' + Math.floor(age / 3600000) + 'h old</span>' : '';
    return '<span class="occ-dot">●</span> ' + esc(shortModel) + ' · ' + esc(stamp) + old;
  }

  function answerView(t, a) {
    const wrap = el('div');
    setHead(t.label, metaHtml(a));
    sub.title = a.model + ' - ' + new Date(a.at).toLocaleString();
    fillStats(statsRow, a.stats);
    // Skill-made sections stay fixed run to run; the model then only writes the summary.
    const fixed = Array.isArray(a.sections) && a.sections.length;
    const sections = fixed ? [{ title: 'Summary', body: a.text }].concat(a.sections) : mdSections(a.text);
    if (!sections.length) sections.push({ title: null, body: a.text });
    sections.forEach((sec, i) => {
      const node = el('div', 'occ-md', mdToHtml(sec.body));
      const bullets = node.querySelectorAll('li').length;
      wrap.appendChild(accordion(sec.title || (i === 0 ? 'Summary' : 'More'), node, { badge: bullets > 2 ? String(bullets) : null }));
    });
    return wrap;
  }

  function progress(run, label) {
    const status = el('div', 'occ-card');
    const line = el('div', 'occ-bar');
    line.style.marginTop = '0';
    const text = el('span', '', '');
    const started = Date.now();
    const paint = () => {
      const s = Math.round((Date.now() - started) / 1000);
      text.innerHTML = '<span class="occ-spin"></span>' + esc(label) + (s >= 3 ? ' · ' + s + ' s' : '');
    };
    paint();
    run.tick = setInterval(paint, 1000);
    const stop = button(
      'Cancel',
      () => {
        run.stopped = true;
        if (run.reject) run.reject(new Error(CANCELLED));
      },
      true
    );
    stop.classList.add('occ-cancel');
    line.appendChild(text);
    line.appendChild(stop);
    status.appendChild(line);
    return status;
  }

  async function openSkill(t, force) {
    const cached = vault.get(KEY_ANS + t.id, null);
    if (cached && !force) {
      show(answerView(t, cached));
      return;
    }
    setHead(t.label, '');
    if (!tornKey()) {
      showSettings('Paste your Torn API token first, then press ' + t.label + ' again.');
      return;
    }
    if (inflight[t.id]) {
      if (inflight[t.id].status) show(inflight[t.id].status);
      return;
    }
    const run = { stopped: false };
    inflight[t.id] = run;
    rerun.classList.add('occ-busy');
    fillStats(statsRow, null);
    run.status = progress(run, 'Running the skill and asking a free model');
    show(run.status);
    // Cancel answers at once; the request already on the wire finishes in the background and is ignored.
    const cancelled = new Promise((_, reject) => (run.reject = reject));
    try {
      const a = await Promise.race([ai.ask(t.skill, { force: !!force }), cancelled]);
      const rec = { text: a.answer || a.report || '', model: a.model || 'runner', at: Date.now(), stats: a.stats || null, sections: a.sections || null };
      vault.set(KEY_ANS + t.id, rec);
      if (current === t.id) show(answerView(t, rec));
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (current !== t.id) {
        // Another tab is on screen now; nothing to repaint.
      } else if (msg === CANCELLED) {
        const prev = vault.get(KEY_ANS + t.id, null);
        if (prev) show(answerView(t, prev));
        else show(el('div', 'occ-card occ-muted', 'Cancelled.'));
      } else show(errCard(t.label + ' failed', msg));
    } finally {
      clearInterval(run.tick);
      inflight[t.id] = null;
      rerun.classList.remove('occ-busy');
    }
  }

  // What a plug-in draws with: its tab body, the stats row and the header meta line.
  function viewFor(t) {
    const live = () => current === t.id;
    return {
      body(node) {
        if (live()) show(typeof node === 'string' ? el('div', 'occ-md', node) : node);
      },
      stats(list) {
        if (live()) fillStats(statsRow, list);
      },
      meta(html) {
        if (live()) sub.innerHTML = html || '';
      },
      busy(on) {
        rerun.classList.toggle('occ-busy', !!on);
      },
      get active() {
        return live();
      },
    };
  }

  async function openPlugin(t, force) {
    setHead(t.label, '');
    fillStats(statsRow, null);
    show(el('div', 'occ-card', '<span class="occ-spin"></span>Loading...'));
    try {
      await t.plugin.mount(viewFor(t), kit, { force: !!force });
    } catch (e) {
      if (current === t.id) show(errCard(t.label + ' failed', String((e && e.message) || e)));
    }
  }

  function openTab(id, force) {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    store.set(KEY_TAB, id);
    main.dataset.ran = '1';
    setActive(id);
    sub.title = '';
    if (t.plugin) openPlugin(t, force);
    else openSkill(t, force);
  }

  function showSettings(note) {
    store.set(KEY_TAB, SETUP);
    main.dataset.ran = '1';
    setActive(SETUP);
    setHead('Setup', 'v' + esc(kit.version));
    fillStats(statsRow, null);
    const wrap = el('div');
    if (note) wrap.appendChild(el('div', 'occ-card occ-err', esc(note)));
    const c1 = el('div', 'occ-card');
    keyField(c1, { key: KEY_OR, title: 'OpenRouter key', placeholder: 'sk-or-v1-...', saved: 'Key saved in Tampermonkey storage. The runner sends skill reports (your money, networth, company numbers) to free OpenRouter models only, which may log them.', empty: 'Optional. Without it you get the raw report. With it, free OpenRouter models (never paid ones) write the answer; they may log the report.' });
    wrap.appendChild(c1);
    const c2 = el('div', 'occ-card');
    keyField(c2, { key: KEY_TORN, title: 'Torn API token', placeholder: 'Torn API key (full access)', saved: 'Token saved in Tampermonkey storage; sent to the runner per run, never stored there.', empty: tornKey() ? 'Using the key Torn PDA filled in.' : 'No token yet. The runner pulls your live numbers with it; it is never stored server side.' });
    wrap.appendChild(c2);
    const c3 = el('div', 'occ-card');
    c3.appendChild(el('h3', '', 'Answers'));
    const row = el('div', 'occ-bar');
    const wipe = button(
      'Clear cached answers',
      () => {
        tabs.forEach((t) => vault.del(KEY_ANS + t.id));
        wipe.textContent = 'Cleared';
      },
      true
    );
    row.appendChild(wipe);
    c3.appendChild(row);
    wrap.appendChild(c3);
    const info = el('div', 'occ-card');
    info.appendChild(el('h3', '', 'How it works'));
    info.appendChild(el('div', 'occ-muted', 'Tabs are the scripts bundled into this build plus the skills the runner lists. A skill tab asks the runner, which runs the skill with your Torn API token, then has a free OpenRouter model write the answer. The runner rotates free models, skips ones that failed lately and never calls a paid one. Version ' + esc(kit.version) + '.'));
    wrap.appendChild(info);
    show(wrap);
  }

  function renderTabs() {
    if (!tabBar) return;
    tabs = allTabs();
    tabBar.innerHTML = '';
    Object.keys(btns).forEach((k) => delete btns[k]);
    tabs.forEach((t) => {
      const b = el('button', 'occ-tab', t.icon + '<span>' + esc(t.label) + '</span>');
      b.type = 'button';
      b.title = t.label + ' (needs a ' + t.access + ' key)';
      b.addEventListener('click', () => openTab(t.id));
      btns[t.id] = b;
      tabBar.appendChild(b);
    });
    if (current && btns[current]) btns[current].classList.add('occ-act');
  }

  function setOpen(on) {
    win.classList.toggle('occ-on', on);
    store.set(KEY_OPEN, on);
    if (on && !main.dataset.ran) {
      const cur = store.get(KEY_TAB, null);
      if (cur === SETUP) showSettings();
      else if (cur && tabs.some((t) => t.id === cur)) openTab(cur);
    }
  }

  // ---- icon next to the player's name, badges right of it ---------------------------------
  // Home page fallback: the player's OWN name row in "General Information", found structurally.
  // Torn's class names there are generated, so instead: a profiles.php link whose row label starts
  // with "Name". Written without regex escapes on purpose - a \b escape in this spot once got
  // corrupted into literal backspace bytes, which silently disabled the row check and mounted the
  // icon next to any player link.
  function homeNameAnchor() {
    const links = document.querySelectorAll('a[href*="profiles.php"]');
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      if (!a.parentNode || a.closest('.occ-win')) continue;
      const text = (a.textContent || '').trim();
      // Their own row reads "Name  KamiRen [2805199]"; the [id] is the giveaway.
      if (text.indexOf('[') === -1 || text.indexOf(']') === -1) continue;
      const row = a.closest('tr,li,div');
      if (!row) continue;
      const label = (row.textContent || '').trim().slice(0, 4).toLowerCase();
      if (label === 'name') return a;
    }
    return null;
  }

  function nameAnchor() {
    for (let i = 0; i < NAME_ANCHORS.length; i++) {
      const a = document.querySelector(NAME_ANCHORS[i]);
      if (a && a.parentNode) return a;
    }
    return homeNameAnchor();
  }

  function inlineButton() {
    const b = el('button', 'occ-inline', OCC_ICON.dash);
    b.type = 'button';
    b.title = 'Operational Command Center';
    return b;
  }

  function badgeSlot(floating) {
    const s = el('span', 'occ-badges' + (floating ? ' occ-float' : ''));
    badges.forEach((p) => {
      try {
        s.appendChild(p.badge(kit));
      } catch (e) {}
    });
    return s;
  }

  // Phone-sized Torn layout (PDA or mobile browser): icons row is crowded, so use the fixed slot.
  function useDock(btn) {
    return isPda() || window.innerWidth <= 768 || !!(btn && btn.closest(MOBILE_INFO));
  }

  // The mobile money + icons block. 2026-10 markup: swiperWrapper___ > [div.points-mobile___,
  // ul.statusIcons___.mobile___], so when the block's own class is unknown, take the swiper's
  // parent (one more step up if that is a swiper too).
  function mobileInfo(btn) {
    const um = btn.closest(MOBILE_INFO) || document.querySelector(MOBILE_INFO);
    if (um) return um;
    const icons = document.querySelector('ul[class*="statusIcons"][class*="mobile"],[class*="points-mobile"],[class*="pointsMobile"]');
    if (!icons) return null;
    let block = icons.closest('[class*="swiperWrapper"],[class*="swiper-wrapper"]') || icons;
    block = block.parentNode;
    if (block && /swiper/i.test(block.className || '') && block.parentNode) block = block.parentNode;
    return block && block !== document.body ? block : null;
  }

  // Phone layout: no room beside the name, so icon and badges get their own fixed slot on every
  // page, right under the status icons line and above the page title.
  function placeDock(btn) {
    // Real Torn mobile markup: div.content > [div.areas (nav), div.user-information-mobile (money +
    // icons swiper)], then the page. The icons <ul> sits in a horizontal swiper, so the dock must
    // go AFTER the whole block.
    const um = mobileInfo(btn);
    let anchor = um && um.parentNode ? { node: um, where: 'afterend' } : null;
    if (!anchor) {
      const t = document.querySelector('.content-wrapper > .content-title') || document.querySelector('.content-title');
      if (t) anchor = { node: t, where: 'beforebegin' };
    }
    if (!anchor) {
      const row = btn.closest('[class*="status-icons"],[class*="statusIcons"]') || btn.closest('ul,ol') || btn.parentNode;
      if (!row || !row.parentNode || row === document.body) return false;
      anchor = { node: row, where: 'afterend' };
    }
    const sib = anchor.where === 'beforebegin' ? anchor.node.previousElementSibling : anchor.node.nextElementSibling;
    let dock = sib && sib.classList.contains('occ-dock') ? sib : null;
    let slot = dock ? dock.querySelector('.occ-badges') : null;
    if (!slot) {
      if (dock) dock.remove();
      dock = el('div', 'occ-dock');
      slot = badgeSlot(false);
      dock.appendChild(slot);
      anchor.node.insertAdjacentElement(anchor.where, dock);
    }
    // Icon and badges live together in the dock, left-aligned (the icons row has no room for them).
    if (btn.parentNode !== dock) dock.insertBefore(btn, slot);
    document.querySelectorAll('.occ-inline').forEach((x) => {
      if (x !== btn) x.remove();
    });
    document.querySelectorAll('.occ-badges').forEach((x) => {
      if (x !== slot) x.remove();
    });
    document.querySelectorAll('.occ-dock').forEach((d) => {
      if (d !== dock) d.remove();
    });
    return true;
  }

  function placeBadges(btn) {
    if (useDock(btn) && placeDock(btn)) return;
    let s = btn.nextElementSibling;
    if (!s || !s.classList.contains('occ-badges') || s.classList.contains('occ-float')) {
      s = badgeSlot(false);
      btn.insertAdjacentElement('afterend', s);
    }
    const par = btn.parentNode;
    if (par && par.style && par.style.whiteSpace !== 'nowrap') par.style.whiteSpace = 'nowrap';
    document.querySelectorAll('.occ-badges').forEach((x) => {
      if (x !== s) x.remove();
    });
  }

  // No name row on this page (PDA etc.): badges float above the launcher.
  function placeFloatBadges() {
    if (!badges.length || document.querySelector('.occ-badges')) return;
    document.getElementById('occ-root').appendChild(badgeSlot(true));
  }

  function mountInline() {
    const docked = document.querySelector('.occ-dock .occ-inline');
    if (docked && useDock(docked) && placeDock(docked)) {
      launch.classList.add('occ-hide');
      return true;
    }
    const a = nameAnchor();
    if (!a || !a.parentNode) {
      // Phone layout: the dock hangs off the icons block or the page title, not the name link, so
      // it still mounts when Torn drops or moves the name link.
      if (useDock(null) && placeDock(inlineButton())) {
        launch.classList.add('occ-hide');
        return true;
      }
      // Nothing to hang on: keep the floating launcher visible so the panel is always reachable.
      // Never hide it without a mount.
      launch.classList.remove('occ-hide');
      placeFloatBadges();
      return false;
    }
    const have = docked || a.parentNode.querySelector('.occ-inline');
    if (have) {
      launch.classList.add('occ-hide');
      placeBadges(have);
      return true;
    }
    const b = inlineButton();
    // Torn appends badges (donator star, awards) right after the name link. Ionuț wants only his
    // icon there, so on his own name those badges are hidden and the button takes their spot.
    // Everyone else keeps their badges.
    let ref = a;
    const mine = new URLSearchParams(a.search || '').get('XID') === OWNER_ID;
    while (mine && ref.nextElementSibling && !ref.nextElementSibling.matches('button,.occ-inline,a') && ref.nextElementSibling.getBoundingClientRect().width <= 24) {
      ref = ref.nextElementSibling;
      ref.style.display = 'none';
    }
    a.insertAdjacentElement('afterend', b);
    launch.classList.add('occ-hide');
    placeBadges(b);
    return true;
  }

  function watchName() {
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target && e.target.closest ? e.target.closest('.occ-inline') : null;
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(!win.classList.contains('occ-on'));
      },
      true
    );
    let tries = 0;
    const tick = () => {
      if (mountInline() || ++tries > 40) return;
      setTimeout(tick, 500);
    };
    tick();
    // Torn's chat and timers change the page all the time: check at most once a second, otherwise
    // pages where the icon cannot mount rescan every profile link on each change.
    let moTimer = 0;
    const mo = new MutationObserver(() => {
      if (moTimer) return;
      moTimer = setTimeout(() => {
        moTimer = 0;
        if (!document.querySelector('.occ-inline') || (badges.length && !document.querySelector('.occ-badges'))) mountInline();
      }, 1000);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // Torn swaps pages client-side; re-check after each navigation.
    addEventListener('hashchange', mountInline);
    addEventListener('popstate', mountInline);
    // Rotating a tablet across the phone breakpoint: move icon and badges to the other layout.
    let phone = useDock(null);
    let rsTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(rsTimer);
      rsTimer = setTimeout(() => {
        if (useDock(null) === phone) return;
        phone = useDock(null);
        document.querySelectorAll('.occ-dock,.occ-inline,.occ-badges').forEach((x) => x.remove());
        mountInline();
      }, 300);
    });
  }

  function headButton(cls, html, tip, onClick) {
    const b = el('button', 'occ-hb' + (cls ? ' ' + cls : ''), html);
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', onClick);
    return b;
  }

  function build() {
    if (document.getElementById('occ-root')) return;
    const root = el('div');
    root.id = 'occ-root';
    injectTheme(root, '#occ-root', frameCss('#occ-root') + OCC_CSS + plugins.map((p) => p.css || '').join('\n'));

    launch = el('button', 'occ-launch', OCC_ICON.dash);
    launch.type = 'button';
    launch.title = 'Operational Command Center';
    launch.addEventListener('click', () => setOpen(!win.classList.contains('occ-on')));
    root.appendChild(launch);

    win = el('div', 'occ-win');
    const head = el('div', 'occ-head');
    title = el('span', 'occ-title', 'Command Center');
    head.appendChild(title);
    head.appendChild(el('span', 'occ-gap'));
    gear = headButton('', OCC_ICON.gear, 'Setup', () => showSettings());
    head.appendChild(gear);
    head.appendChild(headButton('', '&times;', 'Close', () => setOpen(false)));
    win.appendChild(head);

    // The open tab's own line: when its data is from, and its refresh button.
    tool = el('div', 'occ-tool');
    tool.hidden = true;
    sub = el('span', 'occ-sub', '');
    tool.appendChild(sub);
    rerun = button(OCC_ICON.refresh + 'Refresh', () => {
      if (current && current !== SETUP) openTab(current, true);
    });
    rerun.title = 'Run this tab again with fresh data';
    tool.appendChild(rerun);
    win.appendChild(tool);

    statsRow = el('div', 'occ-stats');
    win.appendChild(statsRow);

    main = el('div', 'occ-main occ-scroll');
    win.appendChild(main);

    tabBar = el('div', 'occ-tabs');
    win.appendChild(tabBar);
    root.appendChild(win);
    trapScroll(win);

    renderTabs();
    main.appendChild(el('div', 'occ-empty', '<div>Pick a tab below.</div><div class="occ-muted">' + (tabs.length ? tabs.length + ' available' : 'loading skills...') + '</div>'));
    document.body.appendChild(root);
    plugins.forEach((p) => {
      if (typeof p.start === 'function') {
        try {
          p.start(kit);
        } catch (e) {}
      }
    });
    if (store.get(KEY_OPEN, false)) setOpen(true);
    watchName();
    loadSkills().then((ok) => {
      const empty = main.querySelector('.occ-empty .occ-muted');
      if (empty) empty.textContent = ok ? tabs.length + ' available' : tabs.length ? tabs.length + ' available (offline list)' : 'runner unreachable';
    });
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
}
