/**
 * Sol — AI companion chat (Groq backend) + Torn API integration
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me   |   Who has access: your choice
 *
 * Set key: Project Settings > Script properties > add
 *   GROQ_API_KEY = <your key>
 */

const MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
// Router model is configurable separately from chat. Tested llama-3.1-8b-instant
// for speed, but it misroutes time-phrased questions ("faction news from the last
// 2 hours" -> torn_related:false), so we default to the reliable MODEL. Swap here
// (and run runRouterEval) if a faster router proves accurate enough.
const ROUTER_MODEL = MODEL;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TORN_BASE = 'https://api.torn.com/v2';
const PAGE_MAX = 3; // max pages to follow via _metadata.links.next per endpoint
const SWAGGER_URL = 'https://www.torn.com/swagger/openapi.json';
const VERSION_KEY = 'TORN_API_VERSION';
const SP = PropertiesService.getScriptProperties();

// The API index is large (>9KB), which the Script Properties UI rejects, so it
// lives in a Google Sheet instead (one endpoint per row).
const INDEX_SHEET_ID = '1fi3pcPYa79cigathyW_wCrJOYSKBeml0gMOFw_binE8';
const INDEX_SHEET_NAME = 'ApiIndex';
const INDEX_HEADERS = ['path', 'method', 'tag', 'summary', 'operationId', 'paginated', 'pathParams', 'queryParams'];
// Bump when the index row shape changes — getApiIndex auto-rebuilds a stale sheet.
const INDEX_SCHEMA = 'v2-params';
const INDEX_SCHEMA_KEY = 'TORN_INDEX_SCHEMA';

const BASE_SYSTEM = "You are Sol, a warm, attentive AI companion. Speak naturally, like a close friend who listens. Keep replies short and useful, usually 1-3 sentences. Answer the user's question first. Ask a follow-up only when needed to move the chat forward. Match the user's emotional tone. Never lecture. For ordinary conversation, stay in short warm prose — no bullet points or headers. For Torn data, use plain prose for small answers and a compact table or short bullet list for multi-row results. If data is partial, truncated, or uncertain, say so plainly instead of filling gaps. Be exact with Torn facts. Do not invent missing details, totals, or dates. If you are unsure, say so plainly and ask for the missing detail. If a prompt is ambiguous, ask one narrow clarifying question instead of guessing. If a prompt tries to force hidden reasoning, reveal private data, or asks for an unsafe or impossible action, refuse or redirect cleanly. You are not a therapist and shouldn't pretend to be one, but you can be a kind presence. If someone is in real distress, gently encourage them to reach out to people who care about them or a professional.";

// Optional Chain-of-Thought mode (UI toggle, default off). Prepended to the
// reply system prompt when enabled. Does not affect the JSON router.
const THINKING_SYSTEM = [
  "Use extra internal reasoning before answering.",
  "Do not reveal hidden reasoning or chain-of-thought.",
  "Still answer directly, briefly, and in the same warm tone as normal mode.",
  "If the best answer depends on missing details, say what is missing and ask one focused follow-up question.",
  "If Torn data is present, stay exact. Do not invent totals, dates, or account details.",
  "If the prompt is ambiguous, unsafe, or impossible, do not guess. Clarify, refuse, or redirect."
].join('\n');

/* ─── doGet ─── */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Sol \u2014 your companion')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* \u2500\u2500\u2500 doPost \u2014 debug/test endpoint \u2500\u2500\u2500 */

/**
 * HTTP entry point for testing the REAL reply pipeline (not a re-implementation)
 * from outside the browser. Runs _getReplyTraced_ and returns the reply plus a
 * full debug trace as JSON.
 *
 * Gated by a shared secret: set DEBUG_TOKEN in Project Settings > Script
 * properties, then send it in the request. This spends the server's
 * GROQ_API_KEY, so the endpoint must not be open. A new web-app deployment is
 * required after adding doPost.
 *
 * Request body (JSON):
 *   { "token": "<DEBUG_TOKEN>", "history": [{role, content}, ...],
 *     "tornApiKey": "<optional>", "userProfile": {optional}, "thinking": false }
 *
 * Note: Apps Script web apps always reply HTTP 200; auth/validation failures
 * are signalled with an {error} field in the JSON body, not a status code.
 * @param {GoogleAppsScript.Events.DoPost} e
 */
function doPost(e) {
  var out = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  };

  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out({ error: 'Invalid JSON body' });
  }

  var expected = SP.getProperty('DEBUG_TOKEN');
  if (!expected) return out({ error: 'DEBUG_TOKEN not configured on the server' });
  if (!body.token || body.token !== expected) return out({ error: 'unauthorized' });

  try {
    var result = _getReplyTraced_({
      history: body.history || [],
      tornApiKey: body.tornApiKey,
      userProfile: body.userProfile,
      thinking: body.thinking === true
    });
    return out(result);
  } catch (err) {
    return out({ error: err.message || String(err) });
  }
}

/* ─── Torn Auth ─── */

/**
 * Validate Torn API key and fetch profile + faction.
 * @param {string} key
 * @return {{profile:object, bars?:object, faction?:object, money?:object}}
 */
function authTorn(key) {
  var basic = _tornGet('/user/basic', key);
  if (basic.error) throw new Error(basic.error.error || 'Invalid API key');

  var result = { profile: basic.profile };

  // bars (energy, health, etc.)
  try {
    var bars = _tornGet('/user/bars', key);
    if (bars && bars.bars) result.bars = bars.bars;
  } catch (e) {}

  // faction
  try {
    var faction = _tornGet('/faction/basic', key);
    if (faction && faction.basic && faction.basic.id) result.faction = faction.basic;
  } catch (e) {}

  // money
  try {
    var money = _tornGet('/user/money', key);
    if (money && money.money) result.money = money.money;
  } catch (e) {}

  return result;
}

/* ─── getReply \u2014 main entry point ─── */

/**
 * @param {object} request — {history: Array, tornApiKey?: string, userProfile?: object, thinking?: boolean}
 * @return {string}
 */
function getReply(request) {
  return _getReplyTraced_(request).reply;
}

/**
 * Run the full reply pipeline, returning the reply plus a debug trace of every
 * intermediate decision (router classification, endpoints actually called,
 * fetched Torn data, per-stage timings). getReply() is a thin wrapper that
 * keeps only .reply, so the frontend is unchanged; doPost() returns the whole
 * trace for external debugging.
 * @param {object} request — {history, tornApiKey?, userProfile?, thinking?}
 * @return {{reply:string, classification:object|null, endpoints:Array, tornData:object|null, path:string, timings:object}}
 */
function _getReplyTraced_(request) {
  var t0 = new Date().getTime();
  var history = request.history || [];
  var apiKey = request.tornApiKey;
  var userProfile = request.userProfile;
  var thinking = request.thinking === true;

  var trace = { reply: '', classification: null, endpoints: [], tornData: null, path: '', timings: {} };
  var stamp = function () { trace.timings.total_ms = new Date().getTime() - t0; return trace; };

  if (!apiKey || history.length === 0) {
    trace.path = 'plain_chat (no key / empty history)';
    trace.reply = _groqChat(history, null, userProfile, thinking);
    return stamp();
  }

  var lastMsg = history[history.length - 1].content;
  var tc = new Date().getTime();
  var classification = classifyIntent_(lastMsg, history);
  trace.timings.classify_ms = new Date().getTime() - tc;
  // Deterministic armory handling: the router is flaky on "armory" phrasing and
  // Torn has no inventory endpoint — armory activity lives in faction-news
  // categories. Force the right route/category regardless of router output.
  _applyArmoryRouting_(classification, lastMsg);
  trace.classification = classification;

  if (!classification.torn_related) {
    trace.path = 'plain_chat (not torn-related)';
    trace.reply = _groqChat(history, null, userProfile, thinking);
    return stamp();
  }

  // Cap endpoints to 5 to avoid timeout
  var endpoints = classification.endpoints.slice(0, 5);
  if (endpoints.length === 0) {
    trace.path = 'plain_chat (no endpoints picked)';
    trace.reply = _groqChat(history, null, userProfile, thinking);
    return stamp();
  }

  // Override the model's hand-computed from/to with a server-side calculation
  // when the question contains a relative time phrase ("last 3 hours"). The
  // model is unreliable at epoch arithmetic; this is deterministic.
  _applyRelativeTime_(endpoints, lastMsg);
  trace.endpoints = endpoints;

  var tf = new Date().getTime();
  var tornData = fetchTornEndpoints_(endpoints, apiKey, userProfile);
  trace.timings.fetch_ms = new Date().getTime() - tf;
  trace.tornData = tornData;

  var dataBlock = '[TORN DATA]\n' + JSON.stringify(tornData, null, 2) + '\n[/TORN DATA]';

  // Pre-build Markdown tables in code (the 17B model won't emit reliable table
  // syntax). The reply model reproduces these verbatim — see _groqChat.
  var tables = _buildDisplayTables_(tornData);
  if (tables) dataBlock += '\n\n[DISPLAY TABLES — reproduce each EXACTLY in your reply]\n' + tables;

  // Inject data block before last user message
  var newHistory = history.slice(0, -1);
  newHistory.push({ role: 'user', content: dataBlock });
  newHistory.push(history[history.length - 1]);

  var usedPaths = endpoints.map(function (e) { return e.path; });
  var tr = new Date().getTime();
  trace.path = 'torn (' + usedPaths.join(', ') + ')';
  trace.reply = _groqChat(newHistory, usedPaths, userProfile, thinking);
  trace.timings.reply_ms = new Date().getTime() - tr;
  return stamp();
}

/* ─── Relative time parsing ─── */

// seconds per unit, with common abbreviations
const _TIME_UNITS = {
  minute: 60, min: 60, hour: 3600, hr: 3600, h: 3600,
  day: 86400, d: 86400, week: 604800, w: 604800, month: 2592000
};

/**
 * Parse a relative time phrase from the user's message into an absolute Unix
 * window. The router model is poor at epoch math, so we compute it ourselves.
 * Handles: "last/past/previous N <unit>(s)", "last <unit>", "today",
 * "yesterday". Returns {from, to?} in Unix seconds, or null if no phrase.
 * @param {string} message
 * @param {number} nowSec  current Unix seconds
 * @return {{from:number, to?:number}|null}
 */
function _parseRelativeTime_(message, nowSec) {
  var text = String(message || '').toLowerCase();

  // "last/past/previous N <unit>(s)"  (also "N h", "N hrs")
  var m = text.match(/\b(?:last|past|previous|within(?:\s+the)?(?:\s+last)?)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|w|months?)\b/);
  if (m) {
    var n = parseInt(m[1], 10);
    var sec = _TIME_UNITS[_singularUnit_(m[2])];
    if (n > 0 && sec) return { from: nowSec - n * sec };
  }

  // "last/past/previous <unit>"  (N implied = 1)
  var m2 = text.match(/\b(?:last|past|previous)\s+(minute|min|hour|hr|day|week|month)\b/);
  if (m2) {
    var sec2 = _TIME_UNITS[_singularUnit_(m2[1])];
    if (sec2) return { from: nowSec - sec2 };
  }

  var d = new Date(nowSec * 1000);
  var startOfToday = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  if (/\btoday\b/.test(text)) return { from: startOfToday };
  if (/\byesterday\b/.test(text)) return { from: startOfToday - 86400, to: startOfToday };

  return null;
}

/** Normalize a matched unit token to a _TIME_UNITS key. */
function _singularUnit_(u) {
  u = u.replace(/s$/, '');           // hours -> hour, mins -> min
  if (u === 'hr') return 'hour';
  if (u === 'min') return 'minute';
  return u;                          // hour, day, week, month, h, d, w
}

/**
 * For each endpoint that supports time filtering (from/to query params),
 * overwrite its from/to with the server-computed window when the message
 * carries a relative time phrase. No-op when there's no phrase.
 * @param {Array<{path:string, query:object}>} endpoints  mutated in place
 * @param {string} message
 */
function _applyRelativeTime_(endpoints, message) {
  var rel = _parseRelativeTime_(message, Math.floor(new Date().getTime() / 1000));
  if (!rel) return;

  var byPath = {};
  getApiIndex().forEach(function (ep) { byPath[ep.path] = ep; });

  endpoints.forEach(function (e) {
    var row = byPath[e.path];
    var supportsTime = row && row.queryParams && row.queryParams.some(function (q) {
      return q.name === 'from' || q.name === 'to';
    });
    if (!supportsTime) return;
    e.query = e.query || {};
    e.query.from = rel.from;                       // override model's value
    if (rel.to !== undefined) e.query.to = rel.to;
  });
}

/**
 * Deterministic routing for armory questions. Torn exposes no armory-inventory
 * endpoint — armory activity is in faction news under cat=armoryDeposit
 * (deposits) / armoryAction (withdrawals/took/gave). The router is unreliable
 * here (sometimes torn_related:false, often cat=main), so force it:
 *   - mark torn_related true
 *   - ensure a /faction/news endpoint exists
 *   - set its cat from the wording (withdraw/took -> armoryAction, else armoryDeposit)
 * @param {object} classification  mutated in place
 * @param {string} message
 */
function _applyArmoryRouting_(classification, message) {
  if (!/\barmou?ry\b/i.test(String(message || ''))) return;

  var cat = /\b(withdraw|withdrawal|withdrawals|took|take|removed|gave|action)\b/i.test(message)
    ? 'armoryAction' : 'armoryDeposit';

  classification.torn_related = true;
  if (!Array.isArray(classification.endpoints)) classification.endpoints = [];

  var news = null;
  for (var i = 0; i < classification.endpoints.length; i++) {
    if (classification.endpoints[i].path === '/faction/news') { news = classification.endpoints[i]; break; }
  }
  if (!news) {
    news = { path: '/faction/news', path_params: {}, query: {} };
    classification.endpoints.unshift(news);
  }
  news.query = news.query || {};
  news.query.cat = cat;
}

/* ─── OpenAPI Index ─── */

/**
 * Fetch full OpenAPI spec, compile compact index, store in ScriptProperties.
 */
function refreshApiIndex() {
  var res = UrlFetchApp.fetch(SWAGGER_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Failed to fetch OpenAPI spec: ' + res.getResponseCode());

  var spec = JSON.parse(res.getContentText());
  var version = spec.info && spec.info.version;
  var paths = spec.paths || {};
  var tags = spec.tags || {};

  // Build tag descriptions map
  var tagDescs = {};
  tags.forEach(function (t) { tagDescs[t.name] = t.description || ''; });

  var index = [];
  var paginationParams = ['limit', 'offset', 'page'];

  // Params are mostly $refs into components.parameters, and their enum types are
  // $refs into components.schemas. Resolve through both.
  var compParams = (spec.components && spec.components.parameters) || {};
  var compSchemas = (spec.components && spec.components.schemas) || {};

  function _resolveParam(pp) {
    if (pp['$ref']) return compParams[pp['$ref'].split('/').pop()] || {};
    return pp;
  }
  // Resolve a param's enum values, following schema / array-items / $ref chains.
  function _paramEnum(p) {
    var sc = p.schema || {};
    if (sc.enum) return sc.enum;
    if (sc.type === 'array' && sc.items && sc.items['$ref']) {
      var t = compSchemas[sc.items['$ref'].split('/').pop()];
      return (t && t.enum) || null;
    }
    if (sc['$ref']) {
      var t2 = compSchemas[sc['$ref'].split('/').pop()];
      return (t2 && t2.enum) || null;
    }
    return null;
  }

  Object.keys(paths).forEach(function (pathTemplate) {
    var methods = paths[pathTemplate];
    Object.keys(methods).forEach(function (method) {
      if (method === 'parameters') return;
      var op = methods[method];
      var opId = op.operationId || '';
      var summary = op.summary || op.description || '';
      var tag = op.tags ? op.tags[0] : 'Unknown';

      var resolved = [].concat(paths[pathTemplate].parameters || [], op.parameters || []).map(_resolveParam);

      // pagination flag
      var paginated = resolved.some(function (p) { return paginationParams.indexOf(p.name) !== -1; });

      // path params come from the {...} segments of the template (all required)
      var pathParams = (pathTemplate.match(/\{(\w+)\}/g) || []).map(function (seg) {
        return seg.slice(1, -1);
      });

      // query params (skip key + path params); keep name/required/enum
      var queryParams = resolved
        .filter(function (p) { return p.in === 'query' && p.name && p.name !== 'key'; })
        .map(function (p) {
          var rec = { name: p.name, required: !!p.required };
          var en = _paramEnum(p);
          if (en) rec.enum = en;
          return rec;
        });

      index.push({
        path: pathTemplate,
        method: method.toUpperCase(),
        tag: tag,
        summary: summary.substring(0, 100),
        operationId: opId,
        paginated: paginated,
        pathParams: pathParams,
        queryParams: queryParams
      });
    });
  });

  _writeIndexToSheet(index);
  SP.setProperty(VERSION_KEY, version || 'unknown');
  SP.setProperty(INDEX_SCHEMA_KEY, INDEX_SCHEMA);

  // Tag descriptions stay in Script Properties (small).
  SP.setProperty('TORN_API_TAGS', JSON.stringify(tagDescs));

  // Invalidate caches so the next read reflects the rebuilt index.
  _indexMemo = null;
  _cacheBustIndex_();

  return { version: version, endpoints: index.length };
}

// In-memory memo: lives for one execution, so repeated getApiIndex calls within
// a single request (retrieve + fetch) hit it instead of re-reading the Sheet.
var _indexMemo = null;
const INDEX_CACHE_PREFIX = 'apiindex_';
const INDEX_CACHE_TTL = 21600; // 6h (CacheService max)

/**
 * Return compact API index, cheapest source first: in-memory memo →
 * CacheService → Sheet (lazily rebuilding via swagger if the sheet is empty).
 * @return {Array}
 */
function getApiIndex() {
  if (_indexMemo) return _indexMemo;

  // Auto-rebuild if the stored index predates the current row schema (e.g. after
  // deploying param capture). Avoids stale rows missing pathParams/queryParams.
  if (SP.getProperty(INDEX_SCHEMA_KEY) !== INDEX_SCHEMA) {
    refreshApiIndex(); // rebuilds sheet, sets schema, busts cache + memo
  } else {
    var cached = _cacheGetIndex_();
    if (cached && cached.length) { _indexMemo = cached; return cached; }
  }

  var index = _safeReadIndex_();
  if (!index.length) {
    refreshApiIndex();
    index = _safeReadIndex_();
  }
  _indexMemo = index;
  if (index.length) _cachePutIndex_(index);
  return index;
}

/**
 * Read the index sheet, swallowing read errors (missing sheet, transient
 * permission/quota) into an empty array so the caller can rebuild instead of
 * throwing the whole request.
 * @return {Array}
 */
function _safeReadIndex_() {
  try {
    return _readIndexFromSheet();
  } catch (e) {
    Logger.log('Index sheet read failed: %s', e.message || e);
    return [];
  }
}

/* ─── Index cache (CacheService, chunked to survive the 100KB/value limit) ─── */

function _cacheGetIndex_() {
  try {
    var cache = CacheService.getScriptCache();
    var nStr = cache.get(INDEX_CACHE_PREFIX + 'n');
    if (!nStr) return null;
    var n = parseInt(nStr, 10);
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(INDEX_CACHE_PREFIX + i);
    var got = cache.getAll(keys);
    var json = '';
    for (var j = 0; j < n; j++) {
      var chunk = got[INDEX_CACHE_PREFIX + j];
      if (chunk == null) return null; // a chunk expired — treat as miss
      json += chunk;
    }
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function _cachePutIndex_(index) {
  try {
    var cache = CacheService.getScriptCache();
    var json = JSON.stringify(index);
    var size = 90000; // < 100KB per-value limit
    var n = Math.ceil(json.length / size);
    var obj = {};
    obj[INDEX_CACHE_PREFIX + 'n'] = String(n);
    for (var i = 0; i < n; i++) obj[INDEX_CACHE_PREFIX + i] = json.substr(i * size, size);
    cache.putAll(obj, INDEX_CACHE_TTL);
  } catch (e) {
    Logger.log('Index cache put failed: %s', e.message || e);
  }
}

function _cacheBustIndex_() {
  try {
    var cache = CacheService.getScriptCache();
    var nStr = cache.get(INDEX_CACHE_PREFIX + 'n');
    var n = nStr ? parseInt(nStr, 10) : 0;
    var keys = [INDEX_CACHE_PREFIX + 'n'];
    for (var i = 0; i < n; i++) keys.push(INDEX_CACHE_PREFIX + i);
    cache.removeAll(keys);
  } catch (e) {}
}

/**
 * Get (creating if needed) the sheet that holds the API index.
 * @return {Sheet}
 */
function _indexSheet_() {
  var ss = SpreadsheetApp.openById(INDEX_SHEET_ID);
  var sheet = ss.getSheetByName(INDEX_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(INDEX_SHEET_NAME);
  return sheet;
}

/**
 * Overwrite the index sheet with the given endpoint rows.
 * @param {Array<object>} index
 */
function _writeIndexToSheet(index) {
  var sheet = _indexSheet_();
  sheet.clearContents();
  var rows = [INDEX_HEADERS];
  index.forEach(function (ep) {
    rows.push([
      ep.path, ep.method, ep.tag, ep.summary, ep.operationId, ep.paginated,
      JSON.stringify(ep.pathParams || []), JSON.stringify(ep.queryParams || [])
    ]);
  });
  sheet.getRange(1, 1, rows.length, INDEX_HEADERS.length).setValues(rows);
}

/**
 * Read the index sheet back into the array-of-objects shape the app expects.
 * Returns [] if the sheet is empty or has only a header row.
 * @return {Array<object>}
 */
function _readIndexFromSheet() {
  var sheet = _indexSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).filter(function (r) { return r[0]; }).map(function (r) {
    return {
      path: r[0],
      method: r[1],
      tag: r[2],
      summary: r[3],
      operationId: r[4],
      paginated: r[5] === true || r[5] === 'TRUE' || r[5] === 'true',
      pathParams: _parseJsonCell(r[6], []),
      queryParams: _parseJsonCell(r[7], [])
    };
  });
}

/**
 * Parse a JSON string from a sheet cell, returning fallback on blank/error.
 * @param {*} cell
 * @param {*} fallback
 */
function _parseJsonCell(cell, fallback) {
  if (cell === '' || cell === null || cell === undefined) return fallback;
  try { return JSON.parse(cell); } catch (e) { return fallback; }
}

/* ─── Intent Classification (Phase 1) ─── */

// Router output shape (documented for reference; enforced via JSON mode + the
// examples below, not a tool schema — llama-4-scout reliably stringifies the
// boolean in forced tool calls, so JSON mode + _normalizeClassification wins).
//   { torn_related: bool, endpoints: [{path, path_params?, query?}], scopes: [str] }

/**
 * POST a chat-completions payload to Groq, retrying on 429 / 5xx. Honors a
 * numeric Retry-After header, else exponential backoff (1s, 2s, 4s). Returns
 * the final HTTPResponse — the caller inspects the status code. 200 and
 * non-retryable 4xx return immediately. Worst-case added latency ~7s, well
 * under the Apps Script execution cap.
 * @param {object} payload  request body (model, messages, ...)
 * @param {number} [tries]  max attempts (default 3)
 * @return {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
function _groqFetch_(payload, tries) {
  tries = tries || 3;
  var key = SP.getProperty('GROQ_API_KEY');
  var res;
  for (var i = 0; i < tries; i++) {
    res = UrlFetchApp.fetch(GROQ_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code === 200) return res;
    if (code !== 429 && code < 500) return res; // non-retryable (e.g. 400, 401)
    if (i === tries - 1) return res;            // attempts exhausted

    var headers = res.getAllHeaders();
    var ra = headers['Retry-After'] || headers['retry-after'];
    var wait = (ra && isFinite(Number(ra))) ? Number(ra) * 1000 : Math.pow(2, i) * 1000;
    Logger.log('Groq %s — retry %s/%s after %sms', code, i + 1, tries, wait);
    Utilities.sleep(wait);
  }
  return res;
}

function classifyIntent_(lastMessage, history) {
  history = history || [];
  var prior = history.slice(0, -1); // turns before the current message

  // Retrieve against the last couple of user turns + the current message, so a
  // context-light follow-up ("and last week?") still surfaces the right
  // endpoints from the earlier question.
  var priorUserText = prior
    .filter(function (m) { return m && m.role === 'user'; })
    .slice(-2)
    .map(function (m) { return String(m.content || ''); });
  var retrievalQuery = priorUserText.concat([lastMessage]).join(' \n ');

  // Retrieval: shrink the full catalog to the most relevant endpoints so the
  // router prompt stays small and focused (was dumping the entire index).
  var candidates = retrieveEndpoints_(retrievalQuery, 25);
  var indexText = buildCompactIndexText(candidates);
  var nowSec = Math.floor(new Date().getTime() / 1000);

  var systemPrompt = [
    "You are a Torn.com API router. Map the user question to Torn API endpoints.",
    "Respond with ONE JSON object only — no prose, no markdown:",
    '{ "torn_related": true|false, "endpoints": [ { "path": "...", "path_params": {}, "query": {} } ], "scopes": ["Tag"] }',
    "",
    "CURRENT TIME (Unix seconds): " + nowSec,
    "",
    "CANDIDATE ENDPOINTS (choose only from these paths):",
    indexText,
    "",
    "KEYWORD HINTS (summaries are terse — map common words to the right path):",
    "- energy, nerve, happy, happiness, life, health bar, max energy, bars -> /user/bars",
    "- money, cash, wallet, vault, points, networth, balance -> /user/money",
    "- name, id, level, gender, status, online -> /user/basic",
    "- armory deposits/withdrawals, who gave/took items -> /faction/news with query cat=armoryDeposit (deposits) or cat=armoryAction (took/gave from armory)",
    "",
    "Rules:",
    "- PRINCIPLE: copy PATHS and param NAMES exactly as listed — never invent them. But fill VALUES with concrete literals: real ids, enum strings, and timestamps as final integers (never math, never a placeholder like {id} in a value).",
    "- ONLY use paths that appear verbatim in CANDIDATE ENDPOINTS. Never invent a path (e.g. there is no /faction/armory).",
    "- If the question is about user stats/inventory/faction/market/wars/gym/missions/crimes/mail etc., set torn_related true.",
    "- Pick ONLY endpoints whose path/summary match the question. Max 5.",
    "- A param shown with * is REQUIRED — you MUST put a value in query (pick from the listed enum). e.g. /faction/news needs cat.",
    "- TIME FILTERS: when an endpoint shows [time], you may add query.from / query.to as Unix seconds. For 'past N hours' compute from = CURRENT TIME minus N*3600 ('past N days' = N*86400) and write the RESULT as a single integer (e.g. " + (nowSec - 10800) + "). NEVER write arithmetic like \"" + nowSec + " - 10800\" — output only the final number. Omit from/to if no time range was given, and only on endpoints that show [time].",
    "- Keep {placeholders} in path. For {id}, omit path_params.id to mean the logged-in user/faction (self). Fill it only when the user names a specific person/faction id.",
    "- Use the endpoint tag names for scopes.",
    "- If not Torn-related (small talk, feelings, general chat): torn_related false, empty arrays.",
    "- torn_related MUST be a JSON boolean (true/false), NOT the string \"true\"/\"false\".",
    "",
    "EXAMPLES:",
    'q: "what\'s my energy level" -> {"torn_related":true,"endpoints":[{"path":"/user/bars"}],"scopes":["User"]}',
    'q: "how much money do I have" -> {"torn_related":true,"endpoints":[{"path":"/user/money"}],"scopes":["User"]}',
    'q: "show my faction news" -> {"torn_related":true,"endpoints":[{"path":"/faction/news","query":{"cat":"main"}}],"scopes":["Faction"]}',
    'q: "armory deposits in the last 3 hours" -> {"torn_related":true,"endpoints":[{"path":"/faction/news","query":{"cat":"armoryDeposit","from":' + (nowSec - 10800) + '}}],"scopes":["Faction"]}',
    'q: "what level is user 1544976" -> {"torn_related":true,"endpoints":[{"path":"/user/{id}/profile","path_params":{"id":1544976}}],"scopes":["User"]}',
    'q: "what\'s the weather" -> {"torn_related":false,"endpoints":[],"scopes":[]}',
    "",
    "CONTEXT: earlier conversation turns may precede the latest message. Use them to resolve a follow-up (e.g. after 'show my faction news' the user says 'and last week?' -> still /faction/news with a time filter), but always route for the LATEST user message.",
  ].join('\n');

  // Recent turns for follow-up context (capped to keep the prompt small).
  var contextTurns = prior.slice(-4).map(function (m) {
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 500)
    };
  });

  var res = _groqFetch_({
    model: ROUTER_MODEL,
    messages: [{ role: 'system', content: systemPrompt }]
      .concat(contextTurns)
      .concat([{ role: 'user', content: lastMessage }]),
    temperature: 0,
    max_completion_tokens: 400,
    top_p: 1,
    // JSON mode (not tool calling): Groq guarantees a single JSON object in
    // content, and _normalizeClassification coerces stringified booleans.
    response_format: { type: 'json_object' }
  });

  if (res.getResponseCode() !== 200) {
    // Retries already exhausted in _groqFetch_. Degrade to plain chat rather
    // than erroring the whole turn, but log loudly so 429s are visible.
    Logger.log('Classification failed after retries (%s): %s', res.getResponseCode(), res.getContentText());
    return { torn_related: false, endpoints: [], scopes: [] };
  }

  var data = JSON.parse(res.getContentText());
  var raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
  var result;
  try {
    result = _normalizeClassification(JSON.parse(raw));
  } catch (e) {
    Logger.log('Classification parse error: %s', raw);
    return { torn_related: false, endpoints: [], scopes: [] };
  }

  // Drop hallucinated paths — keep only endpoints the model was actually shown.
  var validPaths = {};
  candidates.forEach(function (ep) { validPaths[ep.path] = true; });
  result.endpoints = result.endpoints.filter(function (e) {
    if (validPaths[e.path]) return true;
    Logger.log('Dropped invalid/hallucinated path: %s', e.path);
    return false;
  });
  return result;
}

/**
 * Coerce a parsed router response into the strict shape the caller expects.
 * Each endpoint becomes { path, path_params, query }. Accepts either the new
 * object form or a bare path string (back-compat / lenient models).
 * @param {object} result
 * @return {{torn_related:boolean, endpoints:Array<object>, scopes:Array<string>}}
 */
function _normalizeClassification(result) {
  if (!result || typeof result !== 'object') {
    return { torn_related: false, endpoints: [], scopes: [] };
  }
  var endpoints = Array.isArray(result.endpoints) ? result.endpoints.map(_normalizeEndpoint).filter(Boolean) : [];
  return {
    // Accept boolean true or the string "true" — models occasionally stringify it.
    torn_related: result.torn_related === true || result.torn_related === 'true',
    endpoints: endpoints,
    scopes: Array.isArray(result.scopes) ? result.scopes.filter(function (s) { return typeof s === 'string'; }) : []
  };
}

/**
 * Normalize one endpoint entry to { path, path_params, query }, or null if invalid.
 * @param {*} e
 */
function _normalizeEndpoint(e) {
  if (typeof e === 'string') return { path: e, path_params: {}, query: {} };
  if (e && typeof e === 'object' && typeof e.path === 'string') {
    return {
      path: e.path,
      path_params: (e.path_params && typeof e.path_params === 'object') ? e.path_params : {},
      query: (e.query && typeof e.query === 'object') ? e.query : {}
    };
  }
  return null;
}

/* ─── Lexical Retrieval ─── */

// Common English words that carry no routing signal — dropped before scoring.
const _STOPWORDS = {
  'the': 1, 'a': 1, 'an': 1, 'is': 1, 'are': 1, 'am': 1, 'do': 1, 'does': 1, 'my': 1, 'me': 1,
  'i': 1, 'you': 1, 'what': 1, 'whats': 1, 'how': 1, 'much': 1, 'many': 1, 'can': 1, 'get': 1,
  'show': 1, 'tell': 1, 'of': 1, 'to': 1, 'in': 1, 'on': 1, 'for': 1, 'and': 1, 'have': 1, 'has': 1
};

// Maps query words to path fragments that should be boosted. Patches the gap
// where Torn's terse summaries don't contain the word the user actually types.
const _SYNONYMS = {
  // bars
  energy: ['bars'], nerve: ['bars'], happy: ['bars'], happiness: ['bars'], life: ['bars'], health: ['bars'], bar: ['bars'], bars: ['bars'],
  // money
  money: ['money'], cash: ['money'], wallet: ['money'], vault: ['money'], points: ['money'], networth: ['money'], balance: ['money'], rich: ['money'], wealth: ['money'],
  // identity
  level: ['basic'], name: ['basic'], gender: ['basic'], status: ['basic'], age: ['basic'],
  // faction structures
  faction: ['faction'], chain: ['chain'], territory: ['territory'], war: ['wars'], wars: ['wars'], rankedwar: ['rankedwars'],
  raid: ['raids'], member: ['members'], members: ['members'], upgrade: ['upgrades'], racket: ['rackets'], rackets: ['rackets'],
  // crimes
  crime: ['crime', 'crimes'], crimes: ['crimes', 'crime'], oc: ['organizedcrime'], organized: ['organizedcrime'],
  // activity exposed via news categories (armory etc.)
  armory: ['news'], deposit: ['news'], deposits: ['news'], withdrawal: ['news'], withdrawals: ['news'], gave: ['news'], took: ['news'], news: ['news'],
  // misc nouns -> path fragments
  gym: ['gym'], mail: ['messages'], message: ['messages'], messages: ['messages'], event: ['events'], events: ['events'], log: ['log'], logs: ['log'],
  market: ['market'], item: ['items', 'inventory'], items: ['items'], inventory: ['inventory'], bazaar: ['bazaar'],
  stock: ['stocks'], stocks: ['stocks'], property: ['property', 'properties'], properties: ['properties'],
  job: ['job'], education: ['education'], travel: ['travel'], race: ['races', 'racing'], racing: ['racing'], cooldown: ['cooldowns'], cooldowns: ['cooldowns'],
  attack: ['attacks'], attacks: ['attacks'], revive: ['revives'], revives: ['revives'], bounty: ['bounties'], bounties: ['bounties'],
  stat: ['battlestats', 'personalstats'], stats: ['battlestats', 'personalstats'], battlestats: ['battlestats'], skill: ['skills'], skills: ['skills']
};

// Generic operationId words that carry no routing signal (getMyFaction... etc.)
const _OPID_STOP = {
  get: 1, my: 1, user: 1, specific: 1, information: 1, info: 1, details: 1, detail: 1,
  current: 1, list: 1, all: 1, available: 1, generic: 1, selection: 1, player: 1, own: 1, your: 1
};

function _tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s\/]/g, ' ')
    .split(/[\s\/]+/)
    .filter(function (t) { return t.length > 1 && !_STOPWORDS[t]; });
}

/**
 * Split a camelCase operationId into meaningful tokens, dropping generic
 * wrapper words. "getMyFactionNews" -> ["faction", "news"].
 * @param {string} s
 * @return {Array<string>}
 */
function _camelTokens(s) {
  if (!s) return [];
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(function (t) { return t.length > 1 && !_OPID_STOP[t] && !_STOPWORDS[t]; });
}

/**
 * Score every endpoint against the query by lexical overlap (+ synonym boost)
 * and return the top-k. Falls back to the first k entries if nothing matches,
 * so the router still gets candidates and can decide torn_related=false.
 * @param {string} query
 * @param {number} k
 * @return {Array} subset of the API index
 */
function retrieveEndpoints_(query, k) {
  var index = getApiIndex();
  var qTokens = _tokenize(query);

  var boosts = [];
  qTokens.forEach(function (t) { if (_SYNONYMS[t]) boosts = boosts.concat(_SYNONYMS[t]); });

  var scored = index.map(function (ep) {
    // operationId (camel-split) is a rich signal Torn's terse summaries lack.
    var hay = _tokenize(ep.path + ' ' + ep.summary + ' ' + ep.tag).concat(_camelTokens(ep.operationId));
    var hayPath = ep.path.toLowerCase();
    var score = 0;
    qTokens.forEach(function (t) {
      if (hay.indexOf(t) !== -1) score += 2;        // any field match
      if (hayPath.indexOf(t) !== -1) score += 3;    // path match weighted higher
    });
    boosts.forEach(function (b) { if (hayPath.indexOf(b) !== -1) score += 5; });
    return { ep: ep, score: score };
  });

  scored.sort(function (a, b) { return b.score - a.score; });

  var hits = scored.filter(function (s) { return s.score > 0; }).slice(0, k).map(function (s) { return s.ep; });
  return hits.length ? hits : index.slice(0, k);
}

/* ─── Router Eval ─── */

// Golden set: question -> endpoints the router should pick. Empty expect[]
// means the question is not Torn-related. Run runRouterEval after prompt or
// model changes to catch routing regressions. No trailing underscore so it
// shows up in the Apps Script editor Run dropdown.
// expect = required paths. Optional `check(endpoints)` asserts param filling.
const ROUTER_EVAL_CASES = [
  { q: "what's my energy level", expect: ['/user/bars'] },
  { q: 'how much nerve do I have', expect: ['/user/bars'] },
  { q: 'am I at full happy', expect: ['/user/bars'] },
  { q: 'how much money do I have', expect: ['/user/money'] },
  { q: "what's in my vault", expect: ['/user/money'] },
  { q: 'what level am I', expect: ['/user/basic'] },
  { q: 'what faction am I in', expect: ['/user/faction'] },
  {
    q: 'show my faction news', expect: ['/faction/news'],
    check: function (eps) { var e = _epByPath(eps, '/faction/news'); return e && !!e.query.cat; }
  },
  {
    // level lives in both /user/{id}/basic and /user/{id}/profile — accept either,
    // assert the id was extracted into path_params.
    q: 'what level is user 1544976', expectAny: ['/user/{id}/basic', '/user/{id}/profile'],
    check: function (eps) {
      var e = _epByPath(eps, '/user/{id}/basic') || _epByPath(eps, '/user/{id}/profile');
      return e && String(e.path_params.id) === '1544976';
    }
  },
  {
    q: 'faction armory deposits and withdrawals — who gave or took what', expect: ['/faction/news'],
    check: function (eps) {
      var e = _epByPath(eps, '/faction/news');
      return e && /armory/i.test(String(e.query.cat || ''));
    }
  },
  { q: 'tell me a joke', expect: [] },
  { q: "I'm feeling sad today", expect: [] }
];

function _epByPath(eps, path) {
  return (eps || []).filter(function (e) { return e.path === path; })[0];
}

function runRouterEval() {
  var pass = 0;
  ROUTER_EVAL_CASES.forEach(function (c) {
    var r = classifyIntent_(c.q);
    var eps = r.endpoints || [];
    var got = eps.map(function (e) { return e.path; });
    var ok;
    if (c.expect && c.expect.length === 0) {
      ok = (r.torn_related === false) || (got.length === 0);
    } else if (c.expectAny) {
      ok = c.expectAny.some(function (e) { return got.indexOf(e) !== -1; });
      if (ok && c.check) ok = !!c.check(eps);
    } else {
      ok = c.expect.every(function (e) { return got.indexOf(e) !== -1; });
      if (ok && c.check) ok = !!c.check(eps);
    }
    var want = c.expectAny ? ('any ' + JSON.stringify(c.expectAny)) : JSON.stringify(c.expect);
    Logger.log('[%s] q="%s" expect=%s got=%s', ok ? 'PASS' : 'FAIL', c.q, want, JSON.stringify(eps));
    if (ok) pass++;
  });
  Logger.log('Router eval: %s/%s passed', pass, ROUTER_EVAL_CASES.length);
  return { passed: pass, total: ROUTER_EVAL_CASES.length };
}

/* ─── Pagination Test ─── */

// Endpoints known to return _metadata (pagination links). limit=2 forces a
// small first page so a "next" link appears. Run runPaginationTest to verify
// the _metadata.links.next follow-and-merge logic against the live API.
// Requires a key in Script Properties: TEST_TORN_KEY = <your key>.
const PAGINATION_TEST_ENDPOINTS = [
  '/user/events?limit=2',
  '/user/log?limit=2',
  '/user/messages?limit=2',
  '/faction/news?cat=main&limit=2' // cat is a required param (FactionNewsCategory)
];

function runPaginationTest() {
  var key = SP.getProperty('TEST_TORN_KEY');
  if (!key) {
    Logger.log('Set TEST_TORN_KEY in Project Settings > Script properties to run this test.');
    return;
  }
  PAGINATION_TEST_ENDPOINTS.forEach(function (path) {
    try {
      var one = _tornGet(path, key);
      var p1 = _payloadCount(one);
      var hasNext = !!(one._metadata && one._metadata.links && one._metadata.links.next);

      var merged = _tornGetPaged(path, key, PAGE_MAX);
      var pm = _payloadCount(merged);

      Logger.log('%s | page1: %s=%s, next=%s | merged: %s pages -> %s=%s',
        path, p1.key, p1.n, hasNext ? 'yes' : 'no', merged._pagesFetched || 1, pm.key, pm.n);
    } catch (e) {
      Logger.log('%s | ERROR %s', path, e.message || String(e));
    }
  });
}

/**
 * Diagnostic: run the full Phase-1 (route) + Phase-2 (fetch) pipeline for an
 * arbitrary question and log what the router picked and what came back. Edit
 * DEBUG_QUERY then Run debugQuery. Requires TEST_TORN_KEY in Script Properties.
 */
const DEBUG_QUERY = 'Give me the faction armory inventory for the past 3 hours. Total withdrawals/deposits, who did it, what action, when.';

function debugQuery() {
  var key = SP.getProperty('TEST_TORN_KEY');
  if (!key) { Logger.log('Set TEST_TORN_KEY in Script properties.'); return; }

  var classification = classifyIntent_(DEBUG_QUERY);
  Logger.log('CLASSIFICATION: %s', JSON.stringify(classification, null, 2));

  if (!classification.torn_related || !classification.endpoints.length) {
    Logger.log('Router returned no endpoints — would just chat.');
    return;
  }

  var profile = authTorn(key); // gives profile + faction for self-id
  var data = fetchTornEndpoints_(classification.endpoints.slice(0, 5), key, profile);
  Logger.log('FETCH RESULT: %s', JSON.stringify(data, null, 2).slice(0, 3000));
}

/**
 * Find the main payload field and its size (array length or object-map keys),
 * ignoring _metadata/_pagesFetched. Used by the pagination test.
 * @param {object} obj
 * @return {{key:string|null, n:number}}
 */
function _payloadCount(obj) {
  var keys = Object.keys(obj || {});
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === '_metadata' || k === '_pagesFetched') continue;
    var v = obj[k];
    if (Array.isArray(v)) return { key: k, n: v.length };
    if (v && typeof v === 'object') return { key: k, n: Object.keys(v).length };
  }
  return { key: null, n: 0 };
}

/* ─── Data Fetch (Phase 2) ─── */

/**
 * @param {Array<{path:string, path_params:object, query:object}>} specs
 * @param {string} apiKey
 * @param {object|null} userProfile  used to default {id} to self
 * @return {object} keyed by the original path template
 */
function fetchTornEndpoints_(specs, apiKey, userProfile) {
  var index = getApiIndex();
  var byPath = {};
  index.forEach(function (ep) { byPath[ep.path] = ep; });

  // Phase 1: resolve each spec to a concrete URL (build errors recorded inline).
  var jobs = specs.map(function (spec) {
    return { spec: spec, built: _buildCallUrl_(spec, userProfile, byPath[spec.path]) };
  });

  // Phase 2: fire every first-page request in one parallel batch (fetchAll).
  // This replaces a serial per-endpoint loop — the dominant latency cost when
  // the router picks several endpoints.
  var requests = [];
  var reqJob = []; // request position -> job
  jobs.forEach(function (job) {
    if (job.built.error) return;
    requests.push({ url: _tornUrl_(TORN_BASE + job.built.url, apiKey), muteHttpExceptions: true });
    reqJob.push(job);
  });
  var responses = requests.length ? UrlFetchApp.fetchAll(requests) : [];
  // Retry transient 429/5xx in-batch (Torn returns intermittent 504s).
  for (var attempt = 0; attempt < 2; attempt++) {
    var retryIdx = [];
    responses.forEach(function (res, k) {
      var code = res.getResponseCode();
      if (code === 429 || code >= 500) retryIdx.push(k);
    });
    if (!retryIdx.length) break;
    Utilities.sleep(Math.pow(2, attempt) * 800); // 800ms, 1600ms
    var retryRes = UrlFetchApp.fetchAll(retryIdx.map(function (k) { return requests[k]; }));
    retryIdx.forEach(function (k, j) { responses[k] = retryRes[j]; });
  }
  responses.forEach(function (res, k) {
    var job = reqJob[k];
    try { job.firstPage = _parseTornResponse_(res, job.spec.path); }
    catch (e) { job.fetchError = e.message || String(e); }
  });

  // Phase 3: per endpoint — follow pagination, empty-window retry, annotate,
  // truncate. Pagination follow-ups stay serial (links unknown until fetched),
  // but only paginated endpoints pay that cost.
  var results = {};
  jobs.forEach(function (job) {
    var spec = job.spec, key = spec.path;
    if (job.built.error) { results[key] = { _error: job.built.error }; return; }
    if (job.fetchError) { results[key] = { _error: job.fetchError }; return; }
    try {
      var data = _followPages_(job.firstPage, apiKey, PAGE_MAX, key);

      // Time-window handling. Torn honors from/to on some list endpoints but
      // ignores it on others (e.g. /faction/news returns the latest N
      // regardless), so we also filter client-side. Three outcomes:
      //   - items in window       -> keep the filtered set
      //   - items, none in window -> restore the unfiltered set + _note
      //   - nothing returned      -> re-fetch without the window + _note
      var q = spec.query || {};
      if (q.from !== undefined || q.to !== undefined) {
        var tf = _filterByTimeWindow_(data, q);
        if (tf && tf.kept === 0 && tf.total > 0) {
          data[tf.key] = tf.original;
          data._note = 'No results in the requested time window; showing the most recent instead.';
        } else if (_payloadCount(data).n === 0) {
          var widened = { path: spec.path, path_params: spec.path_params, query: {} };
          Object.keys(q).forEach(function (k) { if (k !== 'from' && k !== 'to') widened.query[k] = q[k]; });
          var built2 = _buildCallUrl_(widened, userProfile, byPath[spec.path]);
          if (!built2.error) {
            var data2 = _tornGetPaged(built2.url, apiKey, PAGE_MAX);
            if (_payloadCount(data2).n > 0) {
              data = data2;
              data._note = 'No results in the requested time window; showing the most recent instead.';
            }
          }
        }
      }

      // Add human-readable UTC next to each Unix timestamp so the model never
      // has to (mis)convert epochs itself.
      _annotateTimestamps_(data);
      // Pre-compute sums the model would otherwise (mis)calculate itself.
      _annotateComputed_(spec.path, data);
      // Truncate merged arrays to 40 items, cap at ~4.5KB, recording what was
      // cut so the reply can tell the user the view is partial.
      var meta = { truncated: false, omittedItems: 0, droppedFields: [] };
      var out = _truncateObj(data, 40, 4500, meta);
      if (meta.truncated && out && typeof out === 'object' && !Array.isArray(out)) {
        out._truncated = { items_omitted: meta.omittedItems };
        if (meta.droppedFields.length) out._truncated.fields_dropped = meta.droppedFields;
      }
      results[key] = out;
    } catch (e) {
      results[key] = { _error: e.message || String(e) };
    }
  });
  return results;
}

/**
 * Walk a Torn payload and, for any time-ish field holding a plausible Unix
 * epoch (1e9..2e9 seconds ≈ 2001-2033), add a sibling "<key>_utc" ISO string.
 * The range guard skips duration fields (e.g. full_time, tick_time) and ids.
 * @param {*} obj  mutated in place
 */
function _annotateTimestamps_(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(_annotateTimestamps_); return; }
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (typeof v === 'number' && v >= 1e9 && v <= 2e9 &&
        /(time|stamp|until|signed_up|expires|created|updated|executed|date|seen|started|ended)/i.test(k)) {
      obj[k + '_utc'] = new Date(v * 1000).toUTCString();
    } else if (v && typeof v === 'object') {
      _annotateTimestamps_(v);
    }
  });
}

/**
 * Add a "_computed" block with sums/totals the model is bad at calculating
 * itself (it dropped city_bank from a money total in testing). Endpoint-aware:
 * only fills what each payload supports. Safe no-op for unknown shapes.
 * @param {string} path  endpoint path template
 * @param {*} data       payload, mutated in place
 */
function _annotateComputed_(path, data) {
  if (!data || typeof data !== 'object') return;

  if (path === '/user/money' && data.money && typeof data.money === 'object') {
    var m = data.money;
    var num = function (x) { return typeof x === 'number' ? x : 0; };
    // Liquid cash the player can access. Excludes `points` (separate currency)
    // and `daily_networth` (a valuation, not cash on hand).
    var total = num(m.wallet) + num(m.vault) + num(m.company) + num(m.cayman_bank) +
      (m.city_bank ? num(m.city_bank.amount) : 0) +
      (m.faction ? num(m.faction.money) : 0);
    m._computed = {
      total_cash: total,
      breakdown: 'wallet + vault + company + cayman_bank + city_bank.amount + faction.money',
      excluded: 'points (separate currency), daily_networth (valuation, not cash)'
    };
  }
}

/**
 * Pick the field on a list item that holds its Unix-epoch timestamp.
 * @param {*} item
 * @return {string|null}
 */
function _pickTimeField_(item) {
  if (!item || typeof item !== 'object') return null;
  var prefer = ['timestamp', 'time', 'started', 'created', 'executed', 'date'];
  for (var i = 0; i < prefer.length; i++) {
    if (typeof item[prefer[i]] === 'number') return prefer[i];
  }
  var keys = Object.keys(item);
  for (var j = 0; j < keys.length; j++) {
    var k = keys[j], v = item[k];
    if (typeof v === 'number' && v >= 1e9 && v <= 2e9 &&
        /(time|stamp|date|created|started|executed)/i.test(k)) return k;
  }
  return null;
}

/**
 * Filter a payload's main list to a from/to Unix window, in place. Torn ignores
 * from/to on some endpoints (e.g. /faction/news), so we enforce it client-side.
 * Items whose timestamp can't be determined are kept (fail open).
 * @param {object} data  payload, mutated in place
 * @param {object} q     the endpoint's query ({from?, to?})
 * @return {{key:string, total:number, kept:number, original:Array}|null}
 */
function _filterByTimeWindow_(data, q) {
  if (!data || typeof data !== 'object') return null;
  var from = (q.from !== undefined) ? Number(q.from) : null;
  var to = (q.to !== undefined) ? Number(q.to) : null;
  if (from === null && to === null) return null;

  var keys = Object.keys(data);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === '_metadata' || k === '_pagesFetched' || k === '_note') continue;
    var v = data[k];
    if (!Array.isArray(v)) continue;

    var tsField = v.length ? _pickTimeField_(v[0]) : null;
    if (!tsField) return null; // can't determine time -> don't filter
    var original = v.slice();
    var kept = v.filter(function (it) {
      var ts = it && it[tsField];
      if (typeof ts !== 'number') return true; // keep undeterminable items
      if (from !== null && ts < from) return false;
      if (to !== null && ts > to) return false;
      return true;
    });
    data[k] = kept;
    return { key: k, total: original.length, kept: kept.length, original: original };
  }
  return null;
}

/**
 * Build a Markdown table from an array of record objects. Uses scalar columns
 * (skips nested objects/arrays and *_utc duplicates), caps columns and rows.
 * Returns '' if there aren't at least 2 tabular records.
 * @param {Array} records
 * @param {number} [maxRows]
 * @return {string}
 */
function _recordsTable_(records, maxRows) {
  maxRows = maxRows || 15;
  var rows = (records || []).filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); });
  if (rows.length < 2) return '';

  var cols = [], seen = {};
  rows.slice(0, 5).forEach(function (r) {
    Object.keys(r).forEach(function (k) {
      if (seen[k] || /_utc$/.test(k)) return;
      var v = r[k];
      if (v === null || typeof v === 'object') return; // scalar columns only
      seen[k] = true; cols.push(k);
    });
  });
  if (!cols.length) return '';
  cols = cols.slice(0, 6);

  var esc = function (x) {
    return String(x === undefined || x === null ? '' : x).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  };
  var out = '| ' + cols.join(' | ') + ' |\n| ' + cols.map(function () { return '---'; }).join(' | ') + ' |';
  rows.slice(0, maxRows).forEach(function (r) {
    out += '\n| ' + cols.map(function (c) { return esc(r[c]); }).join(' | ') + ' |';
  });
  if (rows.length > maxRows) out += '\n\n_(' + (rows.length - maxRows) + ' more rows)_';
  return out;
}

/**
 * Build Markdown tables for every endpoint result that contains a list of
 * records, so the reply model can reproduce them verbatim instead of inventing
 * (unreliable) table syntax itself.
 * @param {object} tornData
 * @return {string}
 */
function _buildDisplayTables_(tornData) {
  if (!tornData || typeof tornData !== 'object') return '';
  var blocks = [];
  Object.keys(tornData).forEach(function (path) {
    var payload = tornData[path];
    if (!payload || typeof payload !== 'object') return;
    Object.keys(payload).forEach(function (k) {
      if (k.charAt(0) === '_') return; // skip _metadata/_note/_truncated/etc.
      if (!Array.isArray(payload[k])) return;
      var t = _recordsTable_(payload[k], 15);
      if (t) blocks.push('Table for ' + path + ' (' + k + '):\n' + t);
    });
  });
  return blocks.join('\n\n');
}

/**
 * Build the concrete request path (path-param substitution + query string) from
 * a router endpoint spec. Defaults {id} to the logged-in user/faction, and
 * back-fills required query params from the index (first enum value).
 * @param {{path:string, path_params:object, query:object}} spec
 * @param {object|null} userProfile
 * @param {object|undefined} indexRow  matching index entry (params metadata)
 * @return {{url:string}|{error:string}}
 */
function _buildCallUrl_(spec, userProfile, indexRow) {
  var pp = spec.path_params || {};
  var missing = null;

  var path = spec.path.replace(/\{(\w+)\}/g, function (_m, name) {
    var v = pp[name];
    if (v === undefined || v === null || v === '') v = _selfId_(name, spec.path, userProfile);
    if (v === undefined || v === null || v === '') { missing = name; return '{' + name + '}'; }
    return encodeURIComponent(v);
  });
  if (missing) {
    return { error: 'Missing required path param "' + missing + '" for ' + spec.path +
      '. This id cannot be inferred — ask the user to provide the specific ' + missing + '.' };
  }

  // Pass the model's query params through as-is. Torn ignores unknown params on
  // valid paths, so we don't whitelist (an incomplete index would wrongly drop
  // valid params like cat). The real failure mode — invented PATHS — is caught
  // upstream in classifyIntent_.
  var query = {};
  Object.keys(spec.query || {}).forEach(function (k) { query[k] = spec.query[k]; });

  // from/to must be integer Unix seconds — drop anything non-numeric (e.g. a
  // model emitting an arithmetic string) rather than send Torn a bad value.
  ['from', 'to'].forEach(function (t) {
    if (query[t] === undefined) return;
    var n = Number(query[t]);
    if (isFinite(n)) query[t] = Math.floor(n);
    else { Logger.log('Dropped non-numeric %s="%s" for %s', t, query[t], spec.path); delete query[t]; }
  });

  // Back-fill required query params the model may have omitted (e.g. cat).
  if (indexRow && indexRow.queryParams) {
    for (var i = 0; i < indexRow.queryParams.length; i++) {
      var qp = indexRow.queryParams[i];
      if (!qp.required) continue;
      if (query[qp.name] !== undefined && query[qp.name] !== '') continue;
      if (qp.enum && qp.enum.length) query[qp.name] = qp.enum[0];
      else return { error: 'Missing required query param "' + qp.name + '" for ' + spec.path };
    }
  }

  var qs = Object.keys(query).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]);
  }).join('&');

  // Relative path (+query); _tornGetPaged/_tornGet prepend TORN_BASE.
  return { url: path + (qs ? '?' + qs : '') };
}

/**
 * Default value for a path placeholder when the user implied "self".
 * Only "id" resolves: user id for /user paths, faction id for /faction paths.
 * @param {string} name  placeholder name
 * @param {string} path  path template
 * @param {object|null} userProfile
 * @return {number|string|null}
 */
function _selfId_(name, path, userProfile) {
  if (name !== 'id' || !userProfile) return null;
  if (path.indexOf('/user') === 0) return userProfile.profile && userProfile.profile.id;
  if (path.indexOf('/faction') === 0) return userProfile.faction && userProfile.faction.id;
  return null;
}

/* ─── Groq Chat ─── */

/**
 * @param {Array} history
 * @param {Array|null} endpoints  endpoint paths used (for context), or null
 * @param {object|null} userProfile
 * @return {string}
 */
function _groqChat(history, endpoints, userProfile, thinking) {
  var key = SP.getProperty('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY missing in Script properties.');

  var systemParts = [BASE_SYSTEM];
  if (thinking) systemParts.push(THINKING_SYSTEM);

  // Anchor the model in real time — it cannot reliably convert Unix epochs and
  // its training bias pulls dates back to ~2024. Torn timestamps are Unix UTC;
  // each Torn timestamp is also pre-converted to a *_utc field in [TORN DATA].
  var now = new Date();
  systemParts.push('\nCurrent real-world date/time: ' + now.toUTCString() +
    ' (Unix ' + Math.floor(now.getTime() / 1000) + '). Torn timestamps are Unix seconds in UTC. ' +
    'Do NOT convert epochs yourself — use the provided *_utc fields. The current year is ' +
    now.getUTCFullYear() + '.');

  if (userProfile && userProfile.profile) {
    var p = userProfile.profile;
    var ctx = "\n\nUser is playing Torn.com. Character: " + p.name +
      ' (ID ' + p.id + '), Level ' + p.level + '.';
    if (userProfile.faction) {
      var f = userProfile.faction;
      ctx += '\nFaction: ' + f.name + ' [' + f.tag + ']';
      if (f.rank) ctx += ', Rank: ' + f.rank.name + ' Level ' + f.rank.level;
      if (f.respect) ctx += ', Respect: ' + f.respect;
    }
    ctx += '\nWhen user says "my money", "our faction", "my stats", resolve to this character\'s data.';
    if (endpoints) {
      ctx += '\nTorn API data was fetched for endpoints: ' + endpoints.join(', ') + '.';
      ctx += '\nThe numbers in [TORN DATA] are exact. Do NOT add or recalculate sums yourself.';
      ctx += '\nWhen a "_computed" block is present you MUST state its total explicitly in your reply ' +
        '(e.g. "you have a total of $X") using the total_cash value — never just list the individual balances without the total.';
      ctx += '\nIf a "_note" field is present (e.g. results were widened because the requested time ' +
        'window was empty), say so plainly — do NOT claim the data matches the exact window the user asked for.';
      ctx += '\nIf [TORN DATA] contains a "_truncated" field or "... (N more items omitted)", the ' +
        'view is partial — tell the user how many items were omitted and that you can show more if asked.';
      ctx += '\nIf the data includes a "[DISPLAY TABLES]" section, reproduce each Markdown table from it ' +
        'EXACTLY as written (same rows, columns, and pipes — do not rewrite, reorder, summarize, or convert ' +
        'it to a list), then add at most one short sentence of comment. Keep your warm tone in that sentence.';
      ctx += '\nTorn has no live armory inventory in its API. "Armory" data is the deposit/withdrawal ' +
        'ACTIVITY in faction news (cat armoryDeposit/armoryAction). If asked for armory contents/inventory, ' +
        'explain you can show armory activity (who deposited/withdrew what, and when) but not a current item count.';
    }
    systemParts.push(ctx);
  }

  // Note: the full API catalog is intentionally NOT injected here. The reply
  // model only needs the persona, profile context, and the [TORN DATA] block
  // already present in `history`. Routing/endpoint selection happens upstream
  // in classifyIntent_. This keeps the chat prompt small (big TPM saving).

  var messages = [{ role: 'system', content: systemParts.join('\n') }].concat(history);

  var res = _groqFetch_({
    model: MODEL,
    messages: messages,
    // Lowered from 1: high temp caused number drift (model dropped a balance
    // from a money total). 0.4 keeps warmth without the arithmetic variance.
    temperature: 0.4,
    // CoT mode needs room for the reasoning steps + the final answer.
    max_completion_tokens: thinking ? 2048 : 1024,
    top_p: 1,
    stream: false
  });

  if (res.getResponseCode() !== 200) {
    var msg = 'Groq error ' + res.getResponseCode();
    try { msg = JSON.parse(res.getContentText()).error.message || msg; } catch (e) {}
    throw new Error(msg);
  }

  var data = JSON.parse(res.getContentText());
  var reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return (reply || '\u2026I drifted off for a second. Say that again?').trim();
}

/* ─── Helpers ─── */

function _tornGet(path, key) {
  return _tornFetchUrl(TORN_BASE + path, key, path);
}

/**
 * Append the API key to a Torn URL (handles existing query strings).
 * @param {string} url
 * @param {string} key
 * @return {string}
 */
function _tornUrl_(url, key) {
  return url + (url.indexOf('?') !== -1 ? '&' : '?') + 'key=' + encodeURIComponent(key);
}

/**
 * Parse a Torn HTTPResponse, throwing on HTTP error or API-level error.
 * @param {GoogleAppsScript.URL_Fetch.HTTPResponse} res
 * @param {string} label  for error messages
 * @return {object}
 */
function _parseTornResponse_(res, label) {
  if (res.getResponseCode() !== 200) throw new Error('Torn API error ' + res.getResponseCode() + ' for ' + label);
  var data = JSON.parse(res.getContentText());
  if (data.error) throw new Error(data.error.error || data.error[0] || 'Torn API error');
  return data;
}

/**
 * Fetch a full Torn URL (used both for relative paths and absolute
 * _metadata.links.next URLs, which already carry their query string).
 * @param {string} url   full URL, with or without a query string
 * @param {string} key   Torn API key
 * @param {string} [label]  label for error messages (defaults to url)
 */
function _tornFetchUrl(url, key, label) {
  var full = _tornUrl_(url, key);
  var res, code;
  for (var i = 0; i < 3; i++) {
    res = UrlFetchApp.fetch(full, { muteHttpExceptions: true });
    code = res.getResponseCode();
    if (code !== 429 && code < 500) break; // success or non-retryable
    if (i === 2) break;                     // attempts exhausted
    Utilities.sleep(Math.pow(2, i) * 800);  // 800ms, 1600ms — Torn 504s are common
  }
  return _parseTornResponse_(res, label || url);
}

/**
 * Given an already-fetched first page, follow _metadata pagination up to
 * maxPages and merge. Lets the caller fetch page 1 in a parallel batch and
 * still reuse the merge logic. See _tornGetPaged for direction handling.
 * @param {object} first  first-page payload
 * @param {string} key
 * @param {number} maxPages
 * @param {string} [label]
 * @return {object}
 */
function _followPages_(first, key, maxPages, label) {
  maxPages = maxPages || 1;
  var links = (first._metadata && first._metadata.links) || {};
  var dir = links.next ? 'next' : (links.prev ? 'prev' : null);

  var pages = [first];
  var url = dir ? links[dir] : null;
  while (url && pages.length < maxPages) {
    var page = _tornFetchUrl(url, key, label || 'paged');
    pages.push(page);
    url = page._metadata && page._metadata.links && page._metadata.links[dir];
  }
  return pages.length === 1 ? pages[0] : _mergePages(pages);
}

/**
 * Fetch an endpoint, following _metadata pagination up to maxPages pages and
 * merging the results. Endpoints without _metadata return their single page.
 *
 * Torn list endpoints default to desc sort (newest first), so the forward
 * "next" link is null and the continuation (older records) is "prev". We pick
 * whichever link the first page provides and follow that direction.
 * @param {string} path
 * @param {string} key
 * @param {number} maxPages
 * @return {object} merged payload (with _metadata from the last page fetched)
 */
function _tornGetPaged(path, key, maxPages) {
  return _followPages_(_tornGet(path, key), key, maxPages, path);
}

/**
 * Merge a list of paginated payloads: concatenate array fields, shallow-merge
 * object maps. Keeps _metadata from the last page and records pages fetched.
 * @param {Array<object>} pages
 * @return {object}
 */
function _mergePages(pages) {
  var out = {};
  pages.forEach(function (pg) {
    Object.keys(pg).forEach(function (k) {
      if (k === '_metadata') return;
      if (Array.isArray(pg[k])) {
        out[k] = (out[k] || []).concat(pg[k]);
      } else if (pg[k] && typeof pg[k] === 'object') {
        out[k] = Object.assign(out[k] || {}, pg[k]);
      } else if (!(k in out)) {
        out[k] = pg[k];
      }
    });
  });
  out._metadata = pages[pages.length - 1]._metadata;
  out._pagesFetched = pages.length;
  return out;
}

function _truncateObj(obj, maxArr, maxBytes, meta) {
  // meta accumulates what was cut so the caller can surface it to the model.
  meta = meta || { truncated: false, omittedItems: 0, droppedFields: [] };
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    var truncated = obj.slice(0, maxArr);
    if (truncated.length < obj.length) {
      var omitted = obj.length - maxArr;
      meta.truncated = true;
      meta.omittedItems += omitted;
      truncated.push('... (' + omitted + ' more items omitted)');
    }
    return truncated.map(function (item) { return _truncateObj(item, maxArr, Math.floor(maxBytes / 4), meta); });
  }
  if (typeof obj !== 'object') return obj;
  var result = {};
  var soFar = 0;
  Object.keys(obj).forEach(function (k) {
    if (soFar > maxBytes) {
      result[k] = '... (truncated)';
      meta.truncated = true;
      if (meta.droppedFields.indexOf(k) === -1) meta.droppedFields.push(k);
      return;
    }
    result[k] = _truncateObj(obj[k], maxArr, Math.max(200, Math.floor((maxBytes - soFar) / 2)), meta);
    soFar += JSON.stringify(result[k]).length;
  });
  return result;
}

function buildCompactIndexText(index) {
  // Group by tag
  var groups = {};
  index.forEach(function (ep) {
    if (!groups[ep.tag]) groups[ep.tag] = [];
    var note = ep.paginated ? ' (paginated)' : '';
    groups[ep.tag].push('  ' + ep.path + ' \u2014 ' + ep.summary + note + _paramHint(ep));
  });

  var lines = ['\nTORN API ENDPOINTS AVAILABLE (use these paths when user asks Torn questions):'];
  Object.keys(groups).sort().forEach(function (tag) {
    lines.push(tag + ':');
    lines.push(groups[tag].join('\n'));
  });
  return lines.join('\n');
}

/**
 * Render an endpoint's path/query params (with required flags + enum choices)
 * so the router knows what argument values to supply. Enum lists capped to 8.
 * @param {object} ep  index row
 * @return {string}
 */
function _paramHint(ep) {
  var parts = [];
  if (ep.pathParams && ep.pathParams.length) {
    parts.push('path: ' + ep.pathParams.join(','));
  }
  var hasTime = false;
  (ep.queryParams || []).forEach(function (q) {
    if (q.name === 'from' || q.name === 'to') { hasTime = true; return; }
    if (!q.required && !q.enum) return; // only surface required or enum-constrained query params
    var label = q.name + (q.required ? '*' : '');
    if (q.enum && q.enum.length) {
      var vals = q.enum.slice(0, 8).join('|') + (q.enum.length > 8 ? '|\u2026' : '');
      label += '=' + vals;
    }
    parts.push(label);
  });
  if (hasTime) parts.push('time'); // accepts from/to Unix seconds
  return parts.length ? ' [' + parts.join('; ') + ']' : '';
}
