/**
 * Find-Director Trigger — standalone Google Apps Script.
 *
 * Scans the Torn player list sheet in random batches (1-80 players) on a
 * self-rescheduling one-off trigger that fires every random 1-5 minutes.
 * Every player whose Torn job.position is "Director" is appended to the
 * "Find-Director" tab of the target spreadsheet. When the whole list has
 * been checked, the time loop stops and an onChange trigger on the source
 * spreadsheet takes over — scanning resumes only when new rows are added.
 *
 * Setup (once): run init() in the Apps Script editor and authorize.
 * Stop everything: run stop().
 *
 * NOTE: TORN_API_KEY below is a placeholder in this local copy; the real
 * key is injected only into the version pushed to script.google.com.
 */

const TORN_API_KEY = '{{TORN_API_KEY}}';
const SOURCE_SS_ID = '1rVH7hLRMEodRqZnyJVko-XjDdWdfqfFaZODwbZ3218s';
const SOURCE_GID = 2061006058;
const TARGET_SS_ID = '1INRmJohNQME_1Y449FCfQr9hazdN3tUp7yoEOzvYYNA';
const TARGET_SHEET = 'Find-Director';
const HEADER = ['source_row', 'player_id', 'player_name', 'position',
  'company_name', 'company_id', 'company_type', 'checked_at_utc'];

const MIN_BATCH = 1;
const MAX_BATCH = 80;
const MIN_DELAY_MIN = 1;
const MAX_DELAY_MIN = 5;
const CALL_SPACING_MS = 900;      // ~66 calls/min, under Torn's 100/min cap
const COOLDOWN_MIN = 10;          // back-off delay after hitting the rate limit
const INITIAL_CHECKPOINT = 32;    // data rows 1-32 already checked on 2026-07-13; set 0 for full rescan

const PROPS = PropertiesService.getScriptProperties();

/** Run once manually: authorizes scopes, sets checkpoint, starts the loop. */
function init() {
  deleteTriggersFor('runBatch');
  deleteTriggersFor('onSourceChange');
  PROPS.setProperty('lastCheckedRow', String(INITIAL_CHECKPOINT));
  PROPS.setProperty('mode', 'scan');
  ensureTargetSheet();
  scheduleNext();
}

/** Kill all triggers and halt. */
function stop() {
  deleteTriggersFor('runBatch');
  deleteTriggersFor('onSourceChange');
  PROPS.setProperty('mode', 'stopped');
}

/** Log current mode, checkpoint, and installed triggers. */
function status() {
  Logger.log(JSON.stringify({
    mode: PROPS.getProperty('mode'),
    lastCheckedRow: PROPS.getProperty('lastCheckedRow'),
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }),
  }));
}

function runBatch() {
  deleteTriggersFor('runBatch'); // clean up the fired one-off trigger
  if (PROPS.getProperty('mode') === 'stopped') return;

  let checkpoint = Number(PROPS.getProperty('lastCheckedRow') || 0);
  let note = 'ok';
  let done = false;

  try {
    const rows = getSourceRows();
    if (checkpoint >= rows.length) {
      done = true;
    } else {
      const batch = MIN_BATCH + Math.floor(Math.random() * (MAX_BATCH - MIN_BATCH + 1));
      const end = Math.min(checkpoint + batch, rows.length);
      const findings = [];

      for (let i = checkpoint; i < end; i++) {
        const row = rows[i];
        const result = checkPlayer(row.id);
        if (result === 'RATE_LIMITED') { note = 'rate-limited'; break; } // resume from here after cooldown
        if (result && result.position === 'Director') {
          findings.push([row.sourceRow, row.id, result.name, result.position,
            result.companyName, result.companyId, companyTypeName(result.companyType),
            Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd HH:mm:ss')]);
        }
        checkpoint = i + 1;
        Utilities.sleep(CALL_SPACING_MS);
      }

      if (findings.length) appendFindings(findings);
      PROPS.setProperty('lastCheckedRow', String(checkpoint));
      done = checkpoint >= rows.length;
    }
  } catch (err) {
    note = 'error: ' + err; // loop must survive any failure; reschedule below
  }

  if (done) {
    switchToWatch();
  } else if (!hasTrigger('runBatch')) {
    if (note === 'rate-limited') {
      ScriptApp.newTrigger('runBatch').timeBased().after(COOLDOWN_MIN * 60 * 1000).create();
    } else {
      scheduleNext();
    }
  }
  try { updateHeartbeat(checkpoint, note); } catch (e) {} // heartbeat failure must not kill the run
}

/** Write last-run time, checkpoint, mode, and last event into J1:M2 of the findings tab. */
function updateHeartbeat(checkpoint, note) {
  const sheet = ensureTargetSheet();
  if (sheet.getMaxColumns() < 13) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 13 - sheet.getMaxColumns());
  }
  sheet.getRange('J1:M2').setValues([
    ['last_run_utc', 'last_checked_row', 'mode', 'last_event'],
    [Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd HH:mm:ss'),
     checkpoint, PROPS.getProperty('mode'), note || 'ok'],
  ]);
}

/** onChange on the source spreadsheet: resume scan only when rows were added. */
function onSourceChange(e) {
  if (PROPS.getProperty('mode') === 'stopped') return;
  const rows = getSourceRows();
  const checkpoint = Number(PROPS.getProperty('lastCheckedRow') || 0);
  if (rows.length > checkpoint && !hasTrigger('runBatch')) {
    PROPS.setProperty('mode', 'scan');
    scheduleNext();
  }
}

function scheduleNext() {
  const mins = MIN_DELAY_MIN + Math.floor(Math.random() * (MAX_DELAY_MIN - MIN_DELAY_MIN + 1));
  ScriptApp.newTrigger('runBatch').timeBased().after(mins * 60 * 1000).create();
}

function switchToWatch() {
  PROPS.setProperty('mode', 'watch');
  if (!hasTrigger('onSourceChange')) {
    ScriptApp.newTrigger('onSourceChange').forSpreadsheet(SOURCE_SS_ID).onChange().create();
  }
}

function checkPlayer(id) {
  try {
    const resp = UrlFetchApp.fetch(
      'https://api.torn.com/user/' + id + '?selections=profile&key=' + TORN_API_KEY,
      { muteHttpExceptions: true });
    const data = JSON.parse(resp.getContentText());
    if (data.error) {
      if (data.error.code === 5) return 'RATE_LIMITED';
      return null; // unknown/invalid id — skip
    }
    return {
      name: data.name,
      position: data.job && data.job.position,
      companyName: data.job && data.job.company_name,
      companyId: data.job && data.job.company_id,
      companyType: data.job && data.job.company_type,
    };
  } catch (err) {
    return null;
  }
}

/** Resolve a Torn company type ID to its human name (cached 6h). */
function companyTypeName(typeId) {
  if (!typeId) return '';
  const cache = CacheService.getScriptCache();
  let map = cache.get('companyTypes');
  if (map) {
    map = JSON.parse(map);
  } else {
    try {
      const resp = UrlFetchApp.fetch(
        'https://api.torn.com/torn/?selections=companies&key=' + TORN_API_KEY,
        { muteHttpExceptions: true });
      const data = JSON.parse(resp.getContentText());
      if (data.error || !data.companies) return String(typeId);
      map = {};
      Object.keys(data.companies).forEach(function (k) { map[k] = data.companies[k].name; });
      cache.put('companyTypes', JSON.stringify(map), 21600);
    } catch (err) {
      return String(typeId);
    }
  }
  return map[String(typeId)] || String(typeId);
}

/** Returns [{sourceRow, id}] for every numeric NumID in column A of the source tab. */
function getSourceRows() {
  const ss = SpreadsheetApp.openById(SOURCE_SS_ID);
  const sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === SOURCE_GID; })[0];
  if (!sheet) throw new Error('Source sheet gid ' + SOURCE_GID + ' not found');
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  const rows = [];
  for (let i = 0; i < vals.length; i++) {
    const id = String(vals[i][0]).trim();
    if (/^\d+$/.test(id)) rows.push({ sourceRow: i + 1, id: id });
  }
  return rows;
}

function ensureTargetSheet() {
  const ss = SpreadsheetApp.openById(TARGET_SS_ID);
  let sheet = ss.getSheetByName(TARGET_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TARGET_SHEET);
    sheet.appendRow(HEADER);
  }
  return sheet;
}

/** Append findings, skipping player_ids already present in the tab. */
function appendFindings(rows) {
  const sheet = ensureTargetSheet();
  const existing = {};
  const last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 2, last - 1, 1).getValues().forEach(function (v) {
      existing[String(v[0])] = true;
    });
  }
  const fresh = rows.filter(function (r) { return !existing[String(r[1])]; });
  if (!fresh.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, fresh.length, HEADER.length).setValues(fresh);
}

function deleteTriggersFor(fn) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
}

function hasTrigger(fn) {
  return ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === fn;
  });
}
