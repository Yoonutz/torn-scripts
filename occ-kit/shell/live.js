// Live tabs, Command Center only. Wrapped around the build by build.mjs when occ.build.json has
// "live": the installed file carries a built-in copy of every tab (occBaked), and the newest copy
// kept from GitHub runs instead when there is one. At most once a minute a page load reads a tiny
// manifest from the repo first; a new build is downloaded, checked against its sha256, kept and
// started on that same load (when GitHub answers within a few seconds). Only raw.githubusercontent.com
// is contacted, never Torn. A kept copy that fails to compile or start is dropped and the built-in
// one runs. Needs eval: Violentmonkey only allows it with
// @inject-into content (Torn's page rules block it in the page); Torn PDA allows it as is.
// Not a module: build.mjs inlines this file as is, after OCC_BAKED, OCC_LIVE_URL and occBaked.
const LIVE_KEY = 'occ_live';
const LIVE_AT = 'occ_live_at';
const LIVE_EVERY = 60 * 1000;
// How long a page load waits for GitHub before it starts the copy it already has.
const LIVE_WAIT = 4000;
const livePda = typeof window.PDA_httpGet === 'function' || /TornPDA/i.test(navigator.userAgent || '');
const liveGm = [
  typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : undefined,
  typeof GM_getValue === 'function' ? GM_getValue : undefined,
  typeof GM_setValue === 'function' ? GM_setValue : undefined,
  typeof GM_deleteValue === 'function' ? GM_deleteValue : undefined,
];
// Same split as core/storage.js: Tampermonkey storage on a PC, localStorage in Torn PDA.
const liveUseGm = !livePda && !!liveGm[1] && !!liveGm[2];

function liveRead(k) {
  try {
    if (liveUseGm) return liveGm[1](k, null);
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

function liveWrite(k, v) {
  try {
    if (liveUseGm) {
      if (v === null && liveGm[3]) liveGm[3](k);
      else liveGm[2](k, v);
    } else if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    // full or blocked storage: the built-in copy keeps running
  }
}

function liveFetch(url) {
  // A fresh URL every time: Torn PDA hands back an empty body when the same URL is asked again.
  url += (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  return new Promise((resolve, reject) => {
    const done = (status, text) => (status === 200 && text ? resolve(text) : reject(new Error('HTTP ' + status)));
    if (livePda && typeof window.PDA_httpGet === 'function') {
      Promise.resolve(window.PDA_httpGet(url, {})).then(
        (r) => done((r && (r.status || r.statusCode)) || 200, (r && (r.responseText || r.body || r.text)) || (typeof r === 'string' ? r : '')),
        reject
      );
    } else if (liveGm[0]) {
      liveGm[0]({
        method: 'GET',
        url,
        timeout: 30000,
        onload: (r) => done(r.status, r.responseText || ''),
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    } else reject(new Error('No request helper'));
  });
}

const liveFetchTwice = (url) => liveFetch(url).catch(() => liveFetch(url));

async function liveSha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function liveCompile(text) {
  return new Function('GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'OCC_BUILD', text);
}

let liveCanEval = true;
try {
  liveCompile('');
} catch (e) {
  liveCanEval = false;
}

function liveStart() {
  const kept = liveCanEval ? liveRead(LIVE_KEY) : null;
  // A kept copy belongs to the installed file it was fetched for; installing a new file starts over.
  if (kept && kept.base === OCC_BAKED && kept.id && kept.id !== OCC_BAKED && typeof kept.text === 'string') {
    let fn = null;
    try {
      fn = liveCompile(kept.text);
    } catch (e) {
      console.warn('[OCC] kept build ' + kept.id + ' does not compile, using the built-in one', e);
    }
    if (fn) {
      try {
        fn(liveGm[0], liveGm[1], liveGm[2], liveGm[3], kept.id);
      } catch (e) {
        // It may have drawn half a window, so no second copy on this page; the next one is clean.
        console.warn('[OCC] kept build ' + kept.id + ' failed to start, the built-in one runs from the next page', e);
        liveWrite(LIVE_KEY, null);
      }
      return kept.id;
    }
  }
  if (kept) liveWrite(LIVE_KEY, null);
  occBaked(liveGm[0], liveGm[1], liveGm[2], liveGm[3], OCC_BAKED);
  return OCC_BAKED;
}

// Asks GitHub for the newest build and keeps it. Returns true when a new copy was kept.
async function liveCheck(running) {
  const m = JSON.parse(await liveFetchTwice(OCC_LIVE_URL + 'occ.manifest.json'));
  if (!m || !m.id || m.id === running) return false;
  if (m.id === OCC_BAKED) {
    liveWrite(LIVE_KEY, null);
    return true;
  }
  const text = await liveFetchTwice(OCC_LIVE_URL + 'occ.bundle.js');
  // GitHub's cache can serve the two files from different pushes for a few minutes.
  if ((await liveSha(text)) !== m.sha256) return false;
  liveCompile(text);
  liveWrite(LIVE_KEY, { id: m.id, base: OCC_BAKED, text });
  return true;
}

// At most once a minute a page load first asks GitHub (up to LIVE_WAIT) and starts the newest build
// straight away, so a fix shows on the first reload after GitHub has it. Slow or offline: the copy
// already kept starts and a late download is used from the next page on.
(function liveBoot() {
  const now = Date.now();
  const due = liveCanEval && now - (Number(liveRead(LIVE_AT)) || 0) >= LIVE_EVERY;
  if (!due) return liveStart();
  liveWrite(LIVE_AT, now);
  const kept = liveRead(LIVE_KEY);
  const running = kept && kept.base === OCC_BAKED && kept.id ? kept.id : OCC_BAKED;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    liveStart();
  };
  const timer = setTimeout(start, LIVE_WAIT);
  liveCheck(running).then(
    () => {
      clearTimeout(timer);
      start();
    },
    () => {
      // offline or GitHub down: start what we have, try again in a minute
      clearTimeout(timer);
      start();
    }
  );
})();
