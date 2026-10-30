// Building blocks every plug-in draws with. All styled by theme.js under the script's root.
import { el, esc } from './dom.js';
import { keys, store } from './storage.js';

export function card(title, body) {
  const c = el('div', 'occ-card');
  if (title) c.appendChild(el('h3', '', esc(title)));
  if (body !== undefined) c.appendChild(typeof body === 'string' ? el('div', '', body) : body);
  return c;
}

export function errCard(title, msg) {
  const c = el('div', 'occ-card occ-err');
  c.appendChild(el('h3', '', esc(title)));
  c.appendChild(el('div', '', esc(msg).replace(/\n/g, '<br>')));
  return c;
}

export function button(label, onClick, alt) {
  const b = el('button', 'occ-act-btn' + (alt ? ' occ-alt' : ''), label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function accordion(title, node, opts) {
  const acc = el('div', 'occ-acc' + (opts && opts.shut ? ' occ-shut' : ''));
  const bar = el('button', 'occ-acc-bar');
  bar.type = 'button';
  bar.setAttribute('aria-expanded', String(!(opts && opts.shut)));
  bar.innerHTML = esc(title) + (opts && opts.badge ? '<span class="occ-n">' + esc(opts.badge) + '</span>' : '<span class="occ-n" style="display:none"></span>') + '<span class="occ-car">▼</span>';
  bar.addEventListener('click', () => {
    acc.classList.toggle('occ-shut');
    bar.setAttribute('aria-expanded', String(!acc.classList.contains('occ-shut')));
  });
  const body = el('div', 'occ-acc-body');
  body.appendChild(node);
  acc.appendChild(bar);
  acc.appendChild(body);
  return acc;
}

// Up to three big number cards: [{ k, v, unit?, hot? }].
export function fillStats(row, list) {
  row.innerHTML = '';
  if (!Array.isArray(list) || !list.length) return;
  row.style.gridTemplateColumns = 'repeat(' + Math.min(list.length, 3) + ',1fr)';
  list.slice(0, 3).forEach((x) => {
    const c = el('div', 'occ-stat' + (x.hot ? ' occ-hot' : ''));
    c.appendChild(el('div', 'k', esc(x.k)));
    c.appendChild(el('div', 'v', esc(x.v) + (x.unit ? '<small>' + esc(x.unit) + '</small>' : '')));
    row.appendChild(c);
  });
}

// Paste-once secret field (Torn key, OpenRouter key), kept in Tampermonkey storage.
// A key field always shows in one line whether a key is saved: green with its last 4 characters, or
// red when there is none. opts.fallback() can name a key that works without saving one (Torn PDA).
export function keyField(c, opts) {
  c.appendChild(el('h3', '', opts.title));
  const has = !!keys.get(opts.key);
  const badge = el('div', 'occ-keystat');
  const paint = () => {
    const own = keys.get(opts.key);
    const other = !own && opts.fallback ? opts.fallback() : '';
    const k = own || other;
    badge.className = 'occ-keystat ' + (k ? 'ok' : 'no');
    badge.textContent = k ? (own ? '✓ Key saved' : '✓ Using Torn PDA key') + ' · ends in ' + String(k).slice(-4) : '✗ No key saved';
  };
  paint();
  c.appendChild(badge);
  const st = el('div', 'occ-muted', has ? opts.saved : opts.empty);
  c.appendChild(st);
  const input = el('input', 'occ-field');
  input.type = 'password';
  input.placeholder = has ? 'Paste a new value to replace' : opts.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  c.appendChild(input);
  const row = el('div', 'occ-bar');
  row.appendChild(
    button('Save', () => {
      const v = input.value.trim();
      if (!v) return;
      keys.set(opts.key, v);
      input.value = '';
      st.textContent = opts.saved;
      paint();
      input.placeholder = 'Paste a new value to replace';
      if (opts.onChange) opts.onChange(v);
    })
  );
  row.appendChild(
    button(
      'Forget',
      () => {
        keys.del(opts.key);
        st.textContent = opts.empty;
        paint();
        input.placeholder = opts.placeholder;
        if (opts.onChange) opts.onChange('');
      },
      true
    )
  );
  c.appendChild(row);
}

// Panel height, the standard setting every kit window has: a share of the screen height, saved per
// device (a phone and a PC want different sizes). 0 = the built-in size.
export const KEY_PANEL_H = 'occ.panel.h';

export function applyHeight(win) {
  const n = store.get(KEY_PANEL_H, 0);
  win.style.height = n ? n + 'vh' : '';
  if (!n) return (win.style.maxHeight = '');
  const bottom = parseFloat(getComputedStyle(win).bottom) || 0;
  win.style.maxHeight = 'calc(100vh - ' + Math.round(bottom + 8) + 'px)';
}

export function panelField(c, win) {
  c.appendChild(el('h3', '', 'Panel'));
  const row = el('div', 'occ-bar');
  row.appendChild(el('span', 'occ-muted', 'Height'));
  const val = el('span', 'occ-hval');
  const now = () => store.get(KEY_PANEL_H, 0) || Math.max(30, Math.min(100, Math.round((win.offsetHeight / innerHeight) * 10) * 10));
  const paint = () => (val.textContent = store.get(KEY_PANEL_H, 0) ? store.get(KEY_PANEL_H, 0) + '%' : 'Auto');
  const set = (n) => {
    store.set(KEY_PANEL_H, n);
    applyHeight(win);
    paint();
  };
  row.appendChild(button('−', () => set(Math.max(30, now() - 10)), true));
  row.appendChild(val);
  row.appendChild(button('+', () => set(Math.min(100, now() + 10)), true));
  row.appendChild(button('Auto', () => set(0), true));
  paint();
  c.appendChild(row);
  c.appendChild(el('div', 'occ-muted', 'Share of the screen height, saved on this device.'));
}

// Tooltip and toast boxes live in the script root (fixed, top z-index) so Torn's own panels and
// its sidebar stacking context can never cover them.
export function placeBox(box, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = Math.min(260, window.innerWidth - 16);
  box.style.maxWidth = w + 'px';
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  box.style.top = '';
  box.style.bottom = '';
  if (r.bottom + 90 < window.innerHeight) box.style.top = r.bottom + 8 + 'px';
  else box.style.bottom = window.innerHeight - r.top + 8 + 'px';
}

export function tipper(root) {
  let box = null;
  return {
    show(anchor, text) {
      if (!box || !box.isConnected) {
        box = el('div', 'occ-tip');
        root().appendChild(box);
      }
      box.textContent = text;
      box.style.display = 'block';
      placeBox(box, anchor);
    },
    update(text) {
      if (box && box.style.display === 'block') box.textContent = text;
    },
    hide() {
      if (box) box.style.display = 'none';
    },
  };
}

// Small message next to an anchor. Disappears on its own: a timer, plus a watchdog that re-checks
// the deadline, plus any tap or click outside the message (except on `keep` elements).
export function toaster(root, keep) {
  let box = null;
  let timer = 0;
  let watch = 0;
  let until = 0;
  let bound = false;
  const hide = () => {
    clearTimeout(timer);
    clearInterval(watch);
    if (box) box.style.setProperty('display', 'none', 'important');
  };
  const show = (anchor, text, bad) => {
    if (!anchor) return;
    if (!box || !box.isConnected) {
      box = el('div', 'occ-toast');
      box.addEventListener('click', hide);
      root().appendChild(box);
    }
    box.textContent = text;
    box.classList.toggle('bad', !!bad);
    box.style.setProperty('display', 'block', 'important');
    placeBox(box, anchor);
    const ms = bad ? 8000 : 3500;
    until = Date.now() + ms;
    clearTimeout(timer);
    clearInterval(watch);
    timer = setTimeout(hide, ms);
    watch = setInterval(() => {
      if (Date.now() >= until) hide();
    }, 400);
    if (!bound) {
      bound = true;
      document.addEventListener(
        'pointerdown',
        (e) => {
          if (box && box.style.display !== 'none' && !(keep && e.target && e.target.closest && e.target.closest(keep))) hide();
        },
        true
      );
    }
  };
  return { show, hide };
}
