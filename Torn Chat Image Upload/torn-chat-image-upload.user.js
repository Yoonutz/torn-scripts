// ==UserScript==
// @name         Torn Chat Image Upload
// @namespace    kamiren.torn-chat-image-upload
// @version      1.0.5
// @description  Image button next to Send in Torn chat: uploads your picture to Catbox and puts the link in the chat box. You click Send.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// // @connect      catbox.moe
// ==/UserScript==

(function () {
  'use strict';

  const CATBOX = 'https://catbox.moe/user/api.php';
  const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const KEY_RECENT = 'cimg.recent';
  const ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8.6l4.3-4.3 3.2 3.2 2.3-2.3L19 16.4V7H5zm10.5 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>';
  const isPda = typeof window.PDA_httpGet === 'function' || /TornPDA/i.test(navigator.userAgent || '');
  const ok = (status) => status >= 200 && status < 300;
  let panel = null;

  const store = {
    get(k, d) {
      let v;
      try {
        v = GM_getValue(k, '') || localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch (e) {
        return typeof v === 'string' ? v : d;
      }
    },
    set(k, v) {
      GM_setValue(k, JSON.stringify(v));
      localStorage.removeItem(k);
    },
  };

  function el(tag, cls, text, props) {
    const e = Object.assign(document.createElement(tag), props);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (tag === 'button') e.type = 'button';
    return e;
  }

  async function body(fields) {
    const keys = Object.keys(fields).filter((k) => fields[k]);
    if (!isPda) {
      const f = new FormData();
      keys.forEach((k) => f.append(k, fields[k]));
      return { data: f };
    }
    const b = 'cimg' + Math.random().toString(36).slice(2);
    let s = '';
    for (const k of keys) {
      const v = fields[k];
      s += '--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"';
      if (v instanceof Blob) {
        const bytes = new Uint8Array(await v.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        s += '; filename="' + String(v.name || 'image').replace(/[^\w.-]/g, '_') + '"\r\nContent-Type: ' + v.type + '\r\n\r\n' + bin + '\r\n';
      } else s += '\r\n\r\n' + v + '\r\n';
    }
    return { data: s + '--' + b + '--\r\n', headers: { 'Content-Type': 'multipart/form-data; charset=iso-8859-1; boundary=' + b } };
  }

  async function post(fields) {
    const req = await body(fields);
    return new Promise((resolve, reject) =>
      GM_xmlhttpRequest(
        Object.assign(req, {
          method: 'POST',
          url: CATBOX,
          timeout: 60000,
          onload: (r) => resolve({ status: r.status, text: String(r.responseText || '').trim() }),
          onerror: reject,
          ontimeout: reject,
        })
      )
    );
  }

  function errorText(status) {
    if (!status) return 'Network error, try again';
    if (status === 413) return 'Image too big for Catbox.';
    if (status === 429) return 'Catbox is busy. Try again in a few minutes.';
    return 'Upload failed (' + status + ')';
  }

  async function sniff(file) {
    if (TYPES.includes(file.type)) return file;
    const h = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const at = (i, str) => [...str].every((c, j) => h[i + j] === c.charCodeAt(0));
    const type =
      (h[0] === 0x89 && at(1, 'PNG') && 'png') ||
      (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff && 'jpeg') ||
      (at(0, 'GIF8') && 'gif') ||
      (at(0, 'RIFF') && at(8, 'WEBP') && 'webp');
    if (!type) return null;
    const base = String(file.name || '').replace(/\.[^.]*$/, '') || 'photo';
    return new File([file], base + '.' + type.replace('jpeg', 'jpg'), { type: 'image/' + type });
  }

  function findRows(root) {
    return [...root.querySelectorAll('textarea')]
      .map((ta) => {
        const row = ta.parentElement;
        const send = row && [...row.children].find((c) => c.tagName === 'BUTTON' && !c.classList.contains('cimg-btn') && c.querySelector('svg'));
        return send && { row, textarea: ta, send };
      })
      .filter(Boolean);
  }

  function liveRow(r) {
    const win = !r.row.isConnected && r.win && document.getElementById(r.win);
    const row = win ? (findRows(win)[0] || r).row : r.row;
    return { row, textarea: row.isConnected ? row.querySelector(':scope > textarea') : null };
  }

  function status(r, text, kind) {
    if (document.hidden) return;
    let line = r.row.nextElementSibling;
    if (!line || !line.classList.contains('cimg-status')) r.row.after((line = el('div')));
    line.className = 'cimg-status cimg-' + kind;
    line.textContent = text;
    clearTimeout(line._t);
    line._t = setTimeout(() => line.remove(), 5000);
  }

  function busy(r, on) {
    const b = liveRow(r).row.querySelector(':scope > .cimg-btn');
    if (b) {
      b.disabled = on;
      b.classList.toggle('cimg-busy', on);
    }
  }

  async function upload(r, file, caret) {
    status(liveRow(r), 'Uploading…', 'ok');
    file = await sniff(file).catch(() => null);
    if (!file) return status(liveRow(r), 'Use PNG, JPEG, GIF or WebP.', 'err');
    busy(r, true);
    try {
      const res = await post({ reqtype: 'fileupload', fileToUpload: file });
      const m = res.text.match(/^https:\/\/files\.catbox\.moe\/([A-Za-z0-9]+\.[A-Za-z0-9]+)$/);
      if (!ok(res.status)) return status(liveRow(r), errorText(res.status), 'err');
      if (!m) return status(liveRow(r), 'Upload failed: ' + (res.text.slice(0, 80) || 'empty reply'), 'err');
      const list = store.get(KEY_RECENT, []).filter((x) => x.id !== m[1]);
      store.set(KEY_RECENT, [{ id: m[1], link: res.text, at: Date.now() }].concat(list).slice(0, 500));
      const live = liveRow(r);
      const ta = live.textarea;
      if (!ta) return;
      const pos = typeof caret === 'number' && caret <= ta.value.length ? caret : ta.value.length;
      const before = ta.value.slice(0, pos);
      const after = ta.value.slice(pos);
      const add = (pos && !/\s$/.test(before) ? ' ' : '') + res.text + (/^\s/.test(after) ? '' : ' ');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, before + add + after);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      ta.setSelectionRange(pos + add.length, pos + add.length);
      status(live, 'Link added. Click Send to post it.', 'ok');
      if (panel && panel.isConnected) drawPanel();
    } catch (e) {
      status(liveRow(r), errorText(0), 'err');
    } finally {
      busy(r, false);
    }
  }

  function addButton(r) {
    const b = el('button', 'cimg-btn', undefined, { title: 'Upload image. Right-click: your past links', innerHTML: ICON });
    b.setAttribute('aria-label', 'Upload image');
    const stop = r.send.querySelector('stop');
    const c = stop && getComputedStyle(stop).stopColor;
    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'rgb(0, 0, 0)') b.style.color = c;
    r.win = (r.row.closest('[id]') || {}).id || '';
    b.addEventListener('mousedown', () => {
      const ta = liveRow(r).textarea;
      r.caret = ta && document.activeElement === ta ? ta.selectionStart : null;
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = el('input', '', undefined, { type: 'file', accept: TYPES.join(','), hidden: true });
      input.addEventListener('change', () => (input.remove(), input.files[0] && upload(r, input.files[0], r.caret)));
      document.body.appendChild(input).click();
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openPanel();
    });
    r.row.insertBefore(b, r.send);
  }

  const hooked = new WeakSet();
  function scan() {
    findRows(document).forEach((r) => {
      if (!r.row.querySelector(':scope > .cimg-btn')) addButton(r);
      if (hooked.has(r.textarea)) return;
      hooked.add(r.textarea);
      r.textarea.addEventListener('paste', (e) => {
        const items = [...((e.clipboardData && e.clipboardData.items) || [])];
        if (items.some((x) => x.kind === 'string' && x.type === 'text/plain')) return;
        const item = items.find((x) => x.kind === 'file' && /^image\//.test(x.type));
        if (!item) return;
        e.preventDefault();
        upload(r, item.getAsFile(), r.textarea.selectionStart);
      });
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
    const later = () => timer || (timer = setTimeout(run, Math.max(0, 1000 - (Date.now() - last))));
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', () => !document.hidden && later());
    run();
  }

  function drawPanel() {
    const list = store.get(KEY_RECENT, []);
    const body = panel.querySelector('.cimg-body');
    if (!list.length) return body.replaceChildren(el('div', 'cimg-muted', 'No uploads yet.'));
    body.replaceChildren(
      ...list.map((it) => {
        const d = new Date(it.at);
        const row = el('div', 'cimg-recent');
        row.append(
          el('a', '', it.link.replace(/^https:\/\//, ''), { href: it.link, target: '_blank', rel: 'noopener noreferrer' }),
          el('span', 'cimg-muted', d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
        );
        return row;
      })
    );
  }

  function openPanel() {
    if (!panel || !panel.isConnected) {
      panel = el('div', 'cimg-panel', undefined, { id: 'cimg-panel' });
      const close = el('button', 'cimg-x', '×');
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', () => panel.remove());
      const head = el('div', 'cimg-head');
      head.append(el('span', 'cimg-title', 'Your image links'), close);
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
.cimg-ok{color:#8bc34a}.cimg-err{color:#e57373}
.cimg-panel{position:fixed;right:8px;top:56px;z-index:999999;width:340px;max-width:calc(100vw - 16px);max-height:calc(50vh - 56px);display:flex;flex-direction:column;box-sizing:border-box;background:var(--default-bg-panel-color,#333);color:var(--default-color,#ddd);border:1px solid var(--panel-border-bottom-color,#444);border-radius:5px;box-shadow:0 4px 16px rgba(0,0,0,.5);font:12px/1.4 Arial,Helvetica,sans-serif}
.cimg-head{display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid var(--panel-border-bottom-color,#444)}
.cimg-title{flex:1;font-weight:bold;font-size:13px}
.cimg-x{border:0;background:none;color:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
.cimg-body{overflow-y:auto;overflow-x:hidden;padding:6px 8px}
.cimg-muted{color:var(--default-gray-9-color,#999);font-size:11px;overflow-wrap:anywhere}
.cimg-recent{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 0}
.cimg-recent+.cimg-recent{border-top:1px solid var(--panel-border-bottom-color,#444)}
.cimg-recent a{color:var(--default-blue-color,#74c0fc);overflow-wrap:anywhere;min-width:0}
`;

  function start() {
    document.head.appendChild(el('style', '', CSS));
    watch();
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
