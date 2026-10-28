// Building blocks every plug-in draws with. All styled by theme.js under the script's root.
import { el, esc } from './dom.js';
import { keys } from './storage.js';

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
export function keyField(c, opts) {
  c.appendChild(el('h3', '', opts.title));
  const has = !!keys.get(opts.key);
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
        input.placeholder = opts.placeholder;
        if (opts.onChange) opts.onChange('');
      },
      true
    )
  );
  c.appendChild(row);
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
