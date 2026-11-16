// Torn Chat Image Upload: an image button left of Send in every Torn chat window. It uploads the
// picked or pasted image to Catbox (catbox.moe, anonymous unless the user adds a Catbox user hash)
// and puts the link in that chat's text box. The user clicks Send; this script never sends and
// never calls Torn.

const CATBOX = 'https://catbox.moe/user/api.php';
const LINK_RE = /^https:\/\/files\.catbox\.moe\/([A-Za-z0-9]+\.[A-Za-z0-9]+)$/;
const MAX_RECENT = 20;

// Put link at pos, with a space before it when the text there does not end in whitespace, and one
// after it unless the text after already starts with whitespace. Caret lands right after the link.
export function insertAt(text, pos, link) {
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const pre = pos > 0 && !/\s$/.test(before) ? ' ' : '';
  const post = /^\s/.test(after) ? '' : ' ';
  return { value: before + pre + link + post + after, caret: before.length + pre.length + link.length + post.length };
}

// Catbox takes multipart form data (GM_xmlhttpRequest and fetch both send FormData as is).
export function uploadRequest(file, userhash) {
  const body = new FormData();
  body.append('reqtype', 'fileupload');
  if (userhash) body.append('userhash', userhash);
  body.append('fileToUpload', file, file.name || 'image.png');
  return { method: 'POST', url: CATBOX, body };
}

export function deleteRequest(name, userhash) {
  const body = new FormData();
  body.append('reqtype', 'deletefiles');
  body.append('userhash', userhash);
  body.append('files', name);
  return { method: 'POST', url: CATBOX, body };
}

export function errorText(status) {
  if (!status) return 'Network error, try again';
  if (status === 413) return 'Image too big for Catbox.';
  if (status === 429) return 'Catbox is busy. Try again in a few minutes.';
  return 'Upload failed (' + status + ')';
}

// Catbox answers with the file's link as plain text, or with an error sentence.
export function parseUpload(status, text) {
  const body = String(text || '').trim();
  const m = body.match(LINK_RE);
  if (status >= 200 && status < 300 && m) return { ok: true, id: m[1], link: body };
  if (status >= 200 && status < 300) return { ok: false, error: 'Upload failed: ' + (body.slice(0, 80) || 'empty reply') };
  return { ok: false, error: errorText(status) };
}

export function addRecent(list, item) {
  return [item].concat((list || []).filter((x) => x.id !== item.id)).slice(0, MAX_RECENT);
}


// ---- Chat rows -------------------------------------------------------------------------------
// Torn's class names are hashed CSS modules, so a row is found by its shape: the parent of a chat
// textarea that also holds a button with an svg (the Send paper plane).
const IMG_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8.6l4.3-4.3 3.2 3.2 2.3-2.3L19 16.4V7H5zm10.5 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>';
const SCAN_GAP = 1000;

export function findRows(root) {
  const out = [];
  root.querySelectorAll('textarea').forEach((ta) => {
    const row = ta.parentElement;
    if (!row) return;
    const send = [...row.children].find((c) => c.tagName === 'BUTTON' && !c.classList.contains('cimg-btn') && c.querySelector('svg'));
    if (send) out.push({ row, textarea: ta, send });
  });
  return out;
}

// Same colour as the Send icon: Torn paints it with a gradient whose stops carry the theme colour.
function iconColour(send) {
  try {
    const stop = send.querySelector('stop');
    const c = stop && getComputedStyle(stop).stopColor;
    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'rgb(0, 0, 0)') return c;
  } catch (e) {}
  return '';
}

export function addButton(r, onPick) {
  if (r.row.dataset.cimg === '1' && r.row.querySelector(':scope > .cimg-btn')) return r.row.querySelector(':scope > .cimg-btn');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cimg-btn';
  b.title = 'Upload image (Catbox). Right-click: last uploads';
  b.setAttribute('aria-label', 'Upload image');
  b.innerHTML = IMG_ICON;
  const c = iconColour(r.send);
  if (c) b.style.color = c;
  r.win = (r.row.closest('[id]') || {}).id || '';
  // The click moves focus to the button: remember where the cursor was just before that.
  b.addEventListener('mousedown', () => {
    const ta = liveRow(r).textarea;
    r.caret = ta && document.activeElement === ta ? ta.selectionStart : null;
  });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPick(r);
  });
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openPanel();
  });
  r.row.insertBefore(b, r.send);
  r.row.dataset.cimg = '1';
  return b;
}

export function scan(root, onPick, onRow) {
  findRows(root).forEach((r) => {
    if (!(r.row.dataset.cimg === '1' && r.row.querySelector(':scope > .cimg-btn'))) addButton(r, onPick);
    if (onRow) onRow(r); // every scan: React may swap the textarea inside a row that keeps its button
  });
}

// React can replace the textarea, or the whole window, while a row object is held (for example
// during an upload): look the row up again, by its window id when the old row is gone.
export function liveRow(r) {
  let row = r.row;
  if (!row.isConnected) {
    const win = r.win && document.getElementById(r.win);
    const found = win ? findRows(win)[0] : null;
    if (!found) return { row, textarea: null, send: r.send, win: r.win };
    row = found.row;
  }
  return { row, textarea: row.querySelector(':scope > textarea'), send: r.send, win: r.win, caret: r.caret };
}

// React keeps its own copy of the value: set it through the native setter, then fire input so
// Torn sees the text and turns Send on. Never clicks Send.
export function setValue(textarea, value, caret) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  try {
    textarea.setSelectionRange(caret, caret);
  } catch (e) {}
}

function watch(onPick, onRow) {
  let timer = 0;
  let last = 0;
  const run = () => {
    timer = 0;
    if (document.hidden) return;
    last = Date.now();
    scan(document, onPick, onRow);
  };
  const later = () => {
    if (timer) return;
    timer = setTimeout(run, Math.max(0, SCAN_GAP - (Date.now() - last)));
  };
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => !document.hidden && later());
  run();
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
.cimg-status a{color:inherit;text-decoration:underline}
.cimg-recent{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 0;border-top:1px solid var(--occ-line,#444)}
.cimg-recent a{overflow-wrap:anywhere;min-width:0}
`;

// ---- Upload --------------------------------------------------------------------------------
const KEY_HASH = 'cimg.userhash';
const KEY_RECENT = 'cimg.recent';
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const STATUS_MS = 5000;
let openPanel = () => {};
let panel = null; // the standalone window's view, once drawn

export function status(r, text, kind, manage) {
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

export async function upload(kit, r, file, caret) {
  if (!file || TYPES.indexOf(file.type) === -1) return status(r, 'Use PNG, JPEG, GIF or WebP.', 'err');
  const hash = kit.keys.get(KEY_HASH);
  busy(r, true);
  try {
    const res = await kit.http(uploadRequest(file, hash));
    const up = parseUpload(res.status, res.text);
    if (!up.ok) return status(r, up.error, 'err');
    kit.vault.set(KEY_RECENT, addRecent(kit.vault.get(KEY_RECENT, []), { id: up.id, link: up.link, owned: !!hash, at: Date.now() }));
    const live = liveRow(r);
    const ta = live.textarea;
    if (!ta) return; // chat closed during the upload: the link is kept in the panel's list
    const pos = typeof caret === 'number' && caret <= ta.value.length ? caret : ta.value.length;
    const next = insertAt(ta.value, pos, up.link);
    setValue(ta, next.value, next.caret);
    status(live, 'Link added. Click Send to post it.', 'ok', true);
  } catch (e) {
    status(r, errorText(0), 'err');
  } finally {
    busy(r, false);
  }
}

function picker(kit) {
  return (r) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = TYPES.join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (f) upload(kit, r, f, r.caret);
    });
    document.body.appendChild(input);
    input.click();
  };
}

// Paste an image into a chat box = upload it. Text pastes are left alone, including Excel/Word
// copies, which carry plain text and a picture of it.
function pasteHook(kit) {
  const hooked = new WeakSet();
  return (r) => {
    const ta = r.textarea;
    if (hooked.has(ta)) return; // a WeakSet, not a data attribute: a cloned textarea has no listener
    hooked.add(ta);
    ta.addEventListener('paste', (e) => {
      const items = [...((e.clipboardData && e.clipboardData.items) || [])];
      if (items.some((x) => x.kind === 'string' && x.type === 'text/plain')) return;
      const item = items.find((x) => x.kind === 'file' && /^image\//.test(x.type));
      if (!item) return;
      e.preventDefault();
      upload(kit, r, item.getAsFile(), ta.selectionStart);
    });
  };
}

// ---- Panel: last uploads, with Delete (anyone with a link can see the image) ----------------
function when(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function recentList(kit) {
  const wrap = kit.el('div', 'occ-card');
  const list = kit.vault.get(KEY_RECENT, []);
  if (!list.length) {
    wrap.appendChild(kit.el('div', 'occ-muted', 'No uploads yet. Use the image button next to Send in any chat.'));
    return wrap;
  }
  wrap.appendChild(kit.el('h3', '', 'Last uploads'));
  wrap.appendChild(kit.el('div', 'occ-muted', 'Anyone with the link can see the image. Anonymous uploads cannot be deleted; add a Catbox user hash in Setup to get Delete.'));
  list.forEach((it) => {
    const row = kit.el('div', 'cimg-recent');
    const a = kit.el('a', '', kit.esc(it.link.replace(/^https:\/\//, '')));
    a.href = it.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    row.appendChild(a);
    row.appendChild(kit.el('span', 'occ-muted', kit.esc(when(it.at))));
    const msg = kit.el('span', 'cimg-err', '');
    const hash = kit.keys.get(KEY_HASH);
    if (it.owned && hash) {
      const del = kit.ui.button('Delete', async () => {
        del.disabled = true;
        try {
          const res = await kit.http(deleteRequest(it.id, hash));
          // Count it as deleted only when Catbox says so (Torn PDA can answer 200 with no body).
          if (res.status >= 200 && res.status < 300 && /deleted/i.test(res.text || '')) {
            kit.vault.set(KEY_RECENT, kit.vault.get(KEY_RECENT, []).filter((x) => x.id !== it.id));
            row.remove();
            return;
          }
          msg.textContent = res.status >= 200 && res.status < 300 ? 'Not deleted. Try again, or delete it on catbox.moe.' : errorText(res.status);
        } catch (e) {
          msg.textContent = errorText(0);
        }
        del.disabled = false;
      }, true);
      row.appendChild(del);
    }
    row.appendChild(msg);
    wrap.appendChild(row);
  });
  return wrap;
}

export default {
  id: 'cimg',
  label: 'Chat images',
  access: 'none',
  css: CSS,
  start(kit) {
    watch(picker(kit), pasteHook(kit));
  },
  launcher(kit, toggle) {
    // Open the panel and always redraw the list, so a new upload shows even when the panel was
    // already open or had been drawn before it was closed.
    openPanel = () => {
      if (!document.querySelector('#occk-cimg .occ-win.occ-on')) toggle();
      if (panel) panel.view.body(recentList(panel.kit));
    };
  },
  mount(view, kit) {
    panel = { view, kit };
    view.body(recentList(kit));
  },
  settings(card, kit) {
    kit.ui.keyField(card, {
      key: KEY_HASH,
      title: 'Catbox user hash (optional)',
      placeholder: 'Catbox user hash',
      saved: 'Saved in Tampermonkey storage. Sent only to catbox.moe. New uploads go to your Catbox account and get Delete.',
      empty: 'Not needed to upload. Without it, uploads are anonymous and cannot be deleted. With a free Catbox account, copy your user hash here.',
    });
  },
};
