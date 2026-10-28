// Standalone shell: one plug-in as its own userscript, outside the Command Center.
// start(kit) runs as soon as the page is ready. A plug-in with mount() also gets a small window
// (same look as the Command Center, no tab bar) opened by a floating button, or by its own page
// button when it defines launcher(kit, toggle). When the Command Center on this page already
// bundles the same plug-in, this copy steps aside so nothing runs or calls the API twice.
import { el, esc } from '../core/dom.js';
import { store } from '../core/storage.js';
import { tornKey, KEY_TORN } from '../core/torn.js';
import { KEY_OR } from '../core/ai.js';
import { injectTheme } from '../core/theme.js';
import { frameCss, trapScroll } from '../core/frame.js';
import { errCard, fillStats, keyField, button } from '../core/ui.js';
import { makeKit } from '../core/kit.js';

const SOLO_WAIT = 1500; // the Command Center runs at document-idle too: give it time to claim its plug-ins
const SOLO_ICON = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
};

export function boot(plugins) {
  const p = plugins[0];
  const rootId = 'occk-' + p.id;
  const kit = makeKit('standalone', () => document.getElementById(rootId));
  const KEY_OPEN = 'occk.' + p.id + '.open';
  let win, title, sub, tool, statsRow, main, rerun, gear;
  let view = 'plugin';

  function claimedByOcc() {
    return (' ' + (document.documentElement.getAttribute('data-occ-plugins') || '') + ' ').indexOf(' ' + p.id + ' ') !== -1;
  }

  function show(node) {
    main.innerHTML = '';
    main.appendChild(node);
    main.scrollTop = 0;
  }

  const pluginView = {
    body(node) {
      if (view === 'plugin') show(typeof node === 'string' ? el('div', 'occ-md', node) : node);
    },
    stats(list) {
      if (view === 'plugin') fillStats(statsRow, list);
    },
    meta(html) {
      if (view === 'plugin') sub.innerHTML = html || '';
    },
    busy(on) {
      rerun.classList.toggle('occ-busy', !!on);
    },
    get active() {
      return view === 'plugin' && win.classList.contains('occ-on');
    },
  };

  async function openPlugin(force) {
    view = 'plugin';
    title.textContent = p.label;
    sub.innerHTML = '';
    tool.hidden = false;
    gear.classList.remove('occ-act');
    fillStats(statsRow, null);
    show(el('div', 'occ-card', '<span class="occ-spin"></span>Loading...'));
    try {
      await p.mount(pluginView, kit, { force: !!force });
    } catch (e) {
      if (view === 'plugin') show(errCard(p.label + ' failed', String((e && e.message) || e)));
    }
  }

  function showSetup() {
    view = 'setup';
    title.textContent = p.label + ' setup';
    sub.innerHTML = 'v' + esc(kit.version);
    tool.hidden = true;
    gear.classList.add('occ-act');
    fillStats(statsRow, null);
    const wrap = el('div');
    const c1 = el('div', 'occ-card');
    keyField(c1, { key: KEY_TORN, title: 'Torn API key', placeholder: 'Torn API key (' + (p.access || 'minimal') + ' access)', saved: 'Key saved in Tampermonkey storage, used only for Torn API calls from your browser.', empty: tornKey() ? 'Using the key Torn PDA filled in.' : 'No key yet. Needs ' + (p.access || 'minimal') + ' access.' });
    wrap.appendChild(c1);
    if (p.ai) {
      const c2 = el('div', 'occ-card');
      keyField(c2, { key: KEY_OR, title: 'OpenRouter key (AI)', placeholder: 'sk-or-v1-...', saved: 'Key saved in Tampermonkey storage. Only free models are called; they may log what is sent.', empty: 'Optional, for AI answers. Only free OpenRouter models are ever called with it.' });
      wrap.appendChild(c2);
    }
    if (typeof p.settings === 'function') {
      const c3 = el('div', 'occ-card');
      p.settings(c3, kit);
      wrap.appendChild(c3);
    }
    show(wrap);
  }

  function setOpen(on) {
    win.classList.toggle('occ-on', on);
    store.set(KEY_OPEN, on);
    if (on && !main.dataset.ran) {
      main.dataset.ran = '1';
      if (!tornKey()) showSetup();
      else openPlugin(false);
    }
  }

  function headButton(html, tip, onClick) {
    const b = el('button', 'occ-hb', html);
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', onClick);
    return b;
  }

  function buildWindow(root) {
    win = el('div', 'occ-win occ-solo');
    const head = el('div', 'occ-head');
    title = el('span', 'occ-title', esc(p.label));
    head.appendChild(title);
    head.appendChild(el('span', 'occ-gap'));
    gear = headButton(SOLO_ICON.gear, 'Setup', () => (view === 'setup' ? openPlugin(false) : showSetup()));
    head.appendChild(gear);
    head.appendChild(headButton('&times;', 'Close', () => setOpen(false)));
    win.appendChild(head);
    tool = el('div', 'occ-tool');
    sub = el('span', 'occ-sub', '');
    tool.appendChild(sub);
    rerun = button(SOLO_ICON.refresh + 'Refresh', () => openPlugin(true));
    tool.appendChild(rerun);
    win.appendChild(tool);
    statsRow = el('div', 'occ-stats');
    win.appendChild(statsRow);
    main = el('div', 'occ-main occ-scroll');
    win.appendChild(main);
    root.appendChild(win);
    trapScroll(win);
    const toggle = () => setOpen(!win.classList.contains('occ-on'));
    if (typeof p.launcher === 'function') p.launcher(kit, toggle);
    else {
      const launch = el('button', 'occ-launch', kit.safeIcon(p.icon) || '<span style="font:bold 16px Arial">' + esc(p.label.charAt(0)) + '</span>');
      launch.type = 'button';
      launch.title = p.label;
      launch.addEventListener('click', toggle);
      root.appendChild(launch);
    }
    if (store.get(KEY_OPEN, false)) setOpen(true);
  }

  function build() {
    if (claimedByOcc() || document.getElementById(rootId)) return;
    const root = el('div');
    root.id = rootId;
    injectTheme(root, '#' + rootId, (p.mount ? frameCss('#' + rootId) : '') + (p.css || ''));
    document.body.appendChild(root);
    if (typeof p.start === 'function') p.start(kit);
    if (typeof p.mount === 'function') buildWindow(root);
  }

  const go = () => setTimeout(build, SOLO_WAIT);
  if (document.body) go();
  else document.addEventListener('DOMContentLoaded', go);
}
