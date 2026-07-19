function ensureCompanySheet_() {
  const { companySheet } = getSheets_();
  if (!companySheet) {
    throw new Error(`[ensureCompanySheet_] Missing required sheet: ${CONFIG.SHEET_COMPANY}`);
  }
  return companySheet;
}

function ensureLogsSheet_() {
  const { logsSheet } = getSheets_();
  if (!logsSheet) {
    throw new Error(`[ensureLogsSheet_] Missing required sheet: ${CONFIG.SHEET_LOGS}`);
  }
  return logsSheet;
}

function clearEmployeeTablePreservingStatusRow_(companySheet) {
  const firstRow = CONFIG.EMPLOYEE_TABLE_FIRST_ROW;
  const lastRow = CONFIG.EMPLOYEE_TABLE_LAST_ROW;
  const statusRow = CONFIG.STATUS_ROW;
  const lastCol = CONFIG.COL_WAGE;

  if (statusRow - 1 >= firstRow) {
    companySheet.getRange(firstRow, 1, statusRow - firstRow, lastCol).clearContent();
  }
  if (lastRow >= statusRow + 1) {
    companySheet.getRange(statusRow + 1, 1, lastRow - statusRow, lastCol).clearContent();
  }
}

function writeEmployeeRows_(companySheet, employeesById) {
  let rowIndex = CONFIG.EMPLOYEE_TABLE_FIRST_ROW;

  for (const employeeId in employeesById) {
    if (rowIndex === CONFIG.STATUS_ROW) rowIndex++;

    const employee = employeesById[employeeId];

    companySheet.getRange(rowIndex, CONFIG.COL_EMPLOYEE_NAME).setValue(employee.name || "");
    companySheet.getRange(rowIndex, CONFIG.COL_LAST_ACTION).setValue(employee.last_action?.relative || "");
    companySheet.getRange(rowIndex, CONFIG.COL_WAGE).setValue(employee.wage ?? "");

    rowIndex++;
    if (rowIndex > CONFIG.EMPLOYEE_TABLE_LAST_ROW) break;
  }
}

function buildNewsLogKey_(timestamp, newsText) {
  return `${String(timestamp).trim()}::${String(newsText).trim()}`;
}

function buildNewsRowsToAppend_(existingEntries, newsById) {
  const existingIds = buildExistingNewsIdSet_(existingEntries);
  const legacyKeys = buildLegacyKeySet_(existingEntries);
  const rowsToAppend = [];

  for (const newsId in newsById) {
    const item = newsById[newsId];
    if (!item?.timestamp || !item?.news) continue;

    // Primary dedup: by unique Torn news ID
    if (existingIds.has(String(newsId))) continue;
    existingIds.add(String(newsId));

    // Secondary dedup: legacy rows without a stored newsId
    const legacyKey = buildNewsLogKey_(item.timestamp, item.news);
    if (legacyKeys.has(legacyKey)) continue;

    rowsToAppend.push([item.timestamp, item.news, String(newsId)]);
  }

  return rowsToAppend;
}

function getLatestLogTimestamp_() {
  const logsSheet = ensureLogsSheet_();
  const lastRow = logsSheet.getLastRow();
  if (lastRow === 0) return null;

  const values = logsSheet.getRange(1, 1, lastRow, 1).getValues();
  let max = 0;
  for (const row of values) {
    const t = Number(row[0]);
    if (t > max) max = t;
  }
  return max > 0 ? max : null;
}

function buildExistingNewsIdSet_(existingEntries) {
  const ids = new Set();
  for (const row of existingEntries) {
    const id = String(row[3] || "").trim(); // column D
    if (id) ids.add(id);
  }
  return ids;
}

function buildLegacyKeySet_(existingEntries) {
  const keys = new Set();
  for (const row of existingEntries) {
    const id = String(row[3] || "").trim(); // column D
    if (id) continue; // covered by newsId dedup
    const ts = String(row[0] || "").trim();
    const text = String(row[1] || "").trim();
    if (ts && text) keys.add(buildNewsLogKey_(ts, text));
  }
  return keys;
}

function appendNewsRows_(logsSheet, newsById) {
  const lastRow = logsSheet.getLastRow();
  // Read A:D (4 cols) so we can check news IDs stored in col D
  const existingEntries = lastRow > 0
    ? logsSheet.getRange(1, 1, lastRow, 4).getValues()
    : [];
  const rowsToAppend = buildNewsRowsToAppend_(existingEntries, newsById);

  if (rowsToAppend.length > 0) {
    const newFirstRow = lastRow + 1;
    // Write A:B (timestamp + news text) — skip C which has an ARRAYFORMULA
    logsSheet.getRange(newFirstRow, 1, rowsToAppend.length, 2)
      .setValues(rowsToAppend.map(r => [r[0], r[1]]));
    // Write D (news ID)
    logsSheet.getRange(newFirstRow, 4, rowsToAppend.length, 1)
      .setValues(rowsToAppend.map(r => [r[2]]));
  }
}

function writeRunStatus_(statusText) {
  const companySheet = ensureCompanySheet_();
  companySheet.getRange(CONFIG.STATUS_CELL_A1).setValue(statusText);
}
