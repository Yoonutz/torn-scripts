// ==UserScript==
// @name         Torn Chat Image Upload
// @namespace    kamiren.torn-chat-image-upload
// @version      1.0.1
// @description  Image button next to Send in Torn chat: uploads your picture to Catbox and puts the link in the chat box. You click Send.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      catbox.moe
// ==/UserScript==

(function () {
  'use strict';

  const CATBOX = 'https://catbox.moe/user/api.php';
  const LINK_RE = /^https:\/\/files\.catbox\.moe\/([A-Za-z0-9]+\.[A-Za-z0-9]+)$/;
  const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const KEY_HASH = 'cimg.userhash';
  const KEY_RECENT = 'cimg.recent';
  const MAX_RECENT = 20;
  const STATUS_MS = 5000;
  const SCAN_GAP = 1000;
  const ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8.6l4.3-4.3 3.2 3.2 2.3-2.3L19 16.4V7H5zm10.5 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>';

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const store = {
    get(k, d) {
      let v;
      try {
        if (hasGM) v = GM_getValue(k, undefined);
        if (v === undefined || v === null || v === '') v = localStorage.getItem(k);
      } catch (e) {}
      if (v === undefined || v === null || v === '') return d;
      try {
        return JSON.parse(v);
      } catch (e) {
        return typeof v === 'string' ? v : d;
      }
    },
    set(k, v) {
      try {
        if (hasGM) {
          GM_setValue(k, JSON.stringify(v));
          localStorage.removeItem(k);
        } else localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
    del(k) {
      try {
        if (hasGM) {
          if (typeof GM_deleteValue === 'function') GM_deleteValue(k);
          else GM_setValue(k, '');
        }
        localStorage.removeItem(k);
      } catch (e) {}
    },
  };

  function request(method, url, body) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          data: body,
          timeout: 60000,
          onload: (r) => resolve({ status: r.status, text: r.responseText || '' }),
          onerror: () => reject(new Error('network')),
          ontimeout: () => reject(new Error('timeout')),
        });
      });
    }
    return fetch(url, { method, body }).then(async (r) => ({ status: r.status, text: await r.text() }));
  }

  function form(fields) {
    const f = new FormData();
    Object.keys(fields).forEach((k) => {
      if (fields[k] !== '' && fields[k] !== undefined) f.append(k, fields[k]);
    });
    return f;
  }

  function errorText(status) {
    if (!status) return 'Network error, try again';
    if (status === 413) return 'Image too big for Catbox.';
    if (status === 429) return 'Catbox is busy. Try again in a few minutes.';
    return 'Upload failed (' + status + ')';
  }

  function parseUpload(status, text) {
    const body = String(text || '').trim();
    const m = body.match(LINK_RE);
    if (status >= 200 && status < 300 && m) return { ok: true, id: m[1], link: body };
    if (status >= 200 && status < 300) return { ok: false, error: 'Upload failed: ' + (body.slice(0, 80) || 'empty reply') };
    return { ok: false, error: errorText(status) };
  }

  function insertAt(text, pos, link) {
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const pre = pos > 0 && !/\s$/.test(before) ? ' ' : '';
    const post = /^\s/.test(after) ? '' : ' ';
    return { value: before + pre + link + post + after, caret: before.length + pre.length + link.length + post.length };
  }

  function addRecent(item) {
    const list = [item].concat(store.get(KEY_RECENT, []).filter((x) => x.id !== item.id)).slice(0, MAX_RECENT);
    store.set(KEY_RECENT, list);
  }

  function findRows(root) {
    const out = [];
    root.querySelectorAll('textarea').forEach((ta) => {
      const row = ta.parentElement;
      if (!row) return;
      const send = [...row.children].find((c) => c.tagName === 'BUTTON' && !c.classList.contains('cimg-btn') && c.querySelector('svg'));
      if (send) out.push({ row, textarea: ta, send });
    });
    return out;
  }

  function liveRow(r) {
    let row = r.row;
    if (!row.isConnected) {
      const win = r.win && document.getElementById(r.win);
      const found = win ? findRows(win)[0] : null;
      if (!found) return { row, textarea: null, win: r.win };
      row = found.row;
    }
    return { row, textarea: row.querySelector(':scope > textarea'), win: r.win };
  }

  function setValue(textarea, value, caret) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    try {
      textarea.setSelectionRange(caret, caret);
    } catch (e) {}
  }

  function iconColour(send) {
    try {
      const stop = send.querySelector('stop');
      const c = stop && getComputedStyle(stop).stopColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'rgb(0, 0, 0)') return c;
    } catch (e) {}
    return '';
  }

  function status(r, text, kind, manage) {
    if (document.hidden) return;
    let line = r.row.nextElementSibling;
    if (!line || !line.classList.contains('cimg-status')) {
      line = document.createElement('div');
      r.row.after(line);
    }
    line.className = 'cimg-status cimg-' + kind;
    line.textContent = text;
    if (manage) {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = 'Manage';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openPanel();
      });
      line.append(' · ', a);
    }
    clearTimeout(line._t);
    line._t = setTimeout(() => line.remove(), STATUS_MS);
  }

  function busy(r, on) {
    const b = liveRow(r).row.querySelector(':scope > .cimg-btn');
    if (!b) return;
    b.disabled = on;
    b.classList.toggle('cimg-busy', on);
  }

  async function upload(r, file, caret) {
    if (!file || TYPES.indexOf(file.type) === -1) return status(r, 'Use PNG, JPEG, GIF or WebP.', 'err');
    const hash = store.get(KEY_HASH, '');
    busy(r, true);
    try {
      const res = await request('POST', CATBOX, form({ reqtype: 'fileupload', userhash: hash, fileToUpload: file }));
      const up = parseUpload(res.status, res.text);
      if (!up.ok) return status(r, up.error, 'err');
      addRecent({ id: up.id, link: up.link, owned: !!hash, at: Date.now() });
      const live = liveRow(r);
      const ta = live.textarea;
      if (!ta) return;
      const pos = typeof caret === 'number' && caret <= ta.value.length ? caret : ta.value.length;
      const next = insertAt(ta.value, pos, up.link);
      setValue(ta, next.value, next.caret);
      status(live, 'Link added. Click Send to post it.', 'ok', true);
      if (panel && panel.isConnected) drawPanel();
    } catch (e) {
      status(r, errorText(0), 'err');
    } finally {
      busy(r, false);
    }
  }

  function pick(r) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = TYPES.join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (f) upload(r, f, r.caret);
    });
    document.body.appendChild(input);
    input.click();
  }

  function addButton(r) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cimg-btn';
    b.title = 'Upload image. Right-click: last uploads';
    b.setAttribute('aria-label', 'Upload image');
    b.innerHTML = ICON;
    const c = iconColour(r.send);
    if (c) b.style.color = c;
    r.win = (r.row.closest('[id]') || {}).id || '';
    b.addEventListener('mousedown', () => {
      const ta = liveRow(r).textarea;
      r.caret = ta && document.activeElement === ta ? ta.selectionStart : null;
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pick(r);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openPanel();
    });
    r.row.insertBefore(b, r.send);
    r.row.dataset.cimg = '1';
  }

  const hooked = new WeakSet();
  function hookPaste(r) {
    const ta = r.textarea;
    if (hooked.has(ta)) return;
    hooked.add(ta);
    ta.addEventListener('paste', (e) => {
      const items = [...((e.clipboardData && e.clipboardData.items) || [])];
      if (items.some((x) => x.kind === 'string' && x.type === 'text/plain')) return;
      const item = items.find((x) => x.kind === 'file' && /^image\//.test(x.type));
      if (!item) return;
      e.preventDefault();
      upload(r, item.getAsFile(), ta.selectionStart);
    });
  }

  function scan() {
    findRows(document).forEach((r) => {
      if (!(r.row.dataset.cimg === '1' && r.row.querySelector(':scope > .cimg-btn'))) addButton(r);
      hookPaste(r);
    });
  }

  function watch() {
    let timer = 0;
    let last = 0;
    const run = () => {
      timer = 0;
      if (document.hidden) return;
      last = Date.now();
      scan();
    };
    const later = () => {
      if (timer) return;
      timer = setTimeout(run, Math.max(0, SCAN_GAP - (Date.now() - last)));
    };
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', () => !document.hidden && later());
    run();
  }

  let panel = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function when(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function recentList() {
    const wrap = el('div', 'cimg-sec');
    wrap.appendChild(el('h3', '', 'Last uploads'));
    const list = store.get(KEY_RECENT, []);
    if (!list.length) {
      wrap.appendChild(el('div', 'cimg-muted', 'No uploads yet. Use the image button next to Send in any chat.'));
      return wrap;
    }
    wrap.appendChild(el('div', 'cimg-muted', 'Anyone with the link can see the image. Anonymous uploads cannot be deleted; add a Catbox user hash below to get Delete.'));
    const hash = store.get(KEY_HASH, '');
    list.forEach((it) => {
      const row = el('div', 'cimg-recent');
      const a = el('a', '', it.link.replace(/^https:\/\//, ''));
      a.href = it.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      row.appendChild(a);
      row.appendChild(el('span', 'cimg-muted', when(it.at)));
      const msg = el('span', 'cimg-err', '');
      if (it.owned && hash) {
        const del = el('button', 'cimg-act', 'Delete');
        del.type = 'button';
        del.addEventListener('click', async () => {
          del.disabled = true;
          try {
            const res = await request('POST', CATBOX, form({ reqtype: 'deletefiles', userhash: hash, files: it.id }));
            if (res.status >= 200 && res.status < 300 && /deleted/i.test(res.text || '')) {
              store.set(KEY_RECENT, store.get(KEY_RECENT, []).filter((x) => x.id !== it.id));
              row.remove();
              return;
            }
            msg.textContent = res.status >= 200 && res.status < 300 ? 'Not deleted. Try again, or delete it on catbox.moe.' : errorText(res.status);
          } catch (e) {
            msg.textContent = errorText(0);
          }
          del.disabled = false;
        });
        row.appendChild(del);
      }
      row.appendChild(msg);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function hashField() {
    const wrap = el('div', 'cimg-sec');
    wrap.appendChild(el('h3', '', 'Catbox user hash (optional)'));
    const stat = el('div', 'cimg-keystat');
    const note = el('div', 'cimg-muted');
    const paint = () => {
      const h = store.get(KEY_HASH, '');
      stat.className = 'cimg-keystat ' + (h ? 'cimg-ok' : 'cimg-no');
      stat.textContent = h ? '✓ Key saved · ends in ' + String(h).slice(-4) : '✗ No key saved';
      note.textContent = h
        ? 'Saved in your userscript manager. Sent only to catbox.moe. New uploads go to your Catbox account and get Delete.'
        : 'Not needed to upload. Without it, uploads are anonymous and cannot be deleted. With a free Catbox account, paste your user hash here.';
    };
    paint();
    const input = el('input', 'cimg-field');
    input.type = 'password';
    input.placeholder = 'Catbox user hash';
    input.autocomplete = 'off';
    const bar = el('div', 'cimg-bar');
    const save = el('button', 'cimg-act', 'Save');
    save.type = 'button';
    save.addEventListener('click', () => {
      const v = input.value.trim();
      if (!v) return;
      store.set(KEY_HASH, v);
      input.value = '';
      paint();
    });
    const forget = el('button', 'cimg-act', 'Forget');
    forget.type = 'button';
    forget.addEventListener('click', () => {
      store.del(KEY_HASH);
      paint();
    });
    bar.append(save, forget);
    wrap.append(stat, note, input, bar);
    return wrap;
  }

  function drawPanel() {
    const body = panel.querySelector('.cimg-body');
    body.innerHTML = '';
    body.append(recentList(), hashField());
  }

  function openPanel() {
    if (!panel || !panel.isConnected) {
      panel = el('div', 'cimg-panel');
      panel.id = 'cimg-panel';
      const head = el('div', 'cimg-head');
      head.appendChild(el('span', 'cimg-title', 'Chat images'));
      const close = el('button', 'cimg-x', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', () => panel.remove());
      head.appendChild(close);
      panel.append(head, el('div', 'cimg-body'));
      document.body.appendChild(panel);
    }
    drawPanel();
  }

  const CSS = `
.cimg-btn{flex:0 0 auto;width:24px;height:24px;padding:0;margin:0 2px;border:0;background:none;cursor:pointer;color:#999;display:inline-flex;align-items:center;justify-content:center;opacity:.85}
.cimg-btn:hover{opacity:1}
.cimg-btn svg{fill:currentColor;display:block}
.cimg-btn:disabled{cursor:default}
.cimg-busy svg{animation:cimg-spin 1s linear infinite;opacity:.5}
@keyframes cimg-spin{to{transform:rotate(360deg)}}
.cimg-status{font:11px/1.4 Arial,sans-serif;padding:2px 8px;overflow-wrap:anywhere}
.cimg-ok{color:#8bc34a}.cimg-err{color:#e57373}.cimg-no{color:#e57373}
.cimg-status a{color:inherit;text-decoration:underline}
.cimg-panel{position:fixed;right:8px;top:56px;z-index:999999;width:340px;max-width:calc(100vw - 16px);max-height:calc(50vh - 56px);display:flex;flex-direction:column;box-sizing:border-box;background:var(--default-bg-panel-color,#333);color:var(--default-color,#ddd);border:1px solid var(--panel-border-bottom-color,#444);border-radius:5px;box-shadow:0 4px 16px rgba(0,0,0,.5);font:12px/1.4 Arial,Helvetica,sans-serif}
.cimg-head{display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid var(--panel-border-bottom-color,#444)}
.cimg-title{flex:1;font-weight:bold;font-size:13px}
.cimg-x{border:0;background:none;color:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
.cimg-body{overflow-y:auto;overflow-x:hidden;padding:6px 8px}
.cimg-sec{padding:4px 0 8px}
.cimg-sec h3{margin:2px 0 4px;font-size:12px;font-weight:bold}
.cimg-muted{color:var(--default-gray-9-color,#999);font-size:11px;overflow-wrap:anywhere}
.cimg-recent{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 0;border-top:1px solid var(--panel-border-bottom-color,#444)}
.cimg-recent a{color:var(--default-blue-color,#74c0fc);overflow-wrap:anywhere;min-width:0}
.cimg-field{width:100%;box-sizing:border-box;margin:4px 0;padding:4px 6px;background:var(--input-background-color,#111);color:inherit;border:1px solid var(--panel-border-bottom-color,#444);border-radius:3px}
.cimg-bar{display:flex;flex-wrap:wrap;gap:6px}
.cimg-act{padding:3px 10px;border:1px solid var(--panel-border-bottom-color,#555);border-radius:3px;background:var(--default-gray-e4-color,#444);color:inherit;cursor:pointer;font:inherit}
.cimg-act:disabled{opacity:.5;cursor:default}
.cimg-keystat{font-weight:bold;margin-bottom:2px}
`;

  function start() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    watch();
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
