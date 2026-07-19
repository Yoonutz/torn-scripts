function storePaidTrainsLeftSnapshotFast_() {
  const { companySheet, logsSheet } = getSheets_();

  const firstRow = CONFIG.EMPLOYEE_TABLE_FIRST_ROW;
  const lastRow = CONFIG.EMPLOYEE_TABLE_LAST_ROW;
  const numRows = lastRow - firstRow + 1;

  const names = companySheet.getRange(firstRow, CONFIG.COL_EMPLOYEE_NAME, numRows, 1).getValues();
  const paidLeftVals = companySheet.getRange(firstRow, CONFIG.COL_PAID_TRAINS_LEFT, numRows, 1).getValues();
  const payDates = companySheet.getRange(firstRow, CONFIG.COL_EFFECTIVE_PAYMENT_DATE, numRows, 1).getValues();

  const map = {};
  const logIndex = CONFIG.DEBUG ? buildTrainingIndexFast_(logsSheet) : null;

  if (CONFIG.DEBUG) Logger.log("========== TRAIN DEBUG (INDEXED) ==========");

  for (let i = 0; i < numRows; i++) {
    const sheetRow = firstRow + i;
    if (sheetRow === CONFIG.STATUS_ROW) continue;

    const name = String(names[i][0] || "").trim();
    if (!name) continue;

    const paidLeft = paidLeftVals[i][0];
    map[name] = paidLeft === null ? "" : paidLeft;

    if (!CONFIG.DEBUG) continue;

    const paymentDate = payDates[i][0];
    if (!(paymentDate instanceof Date)) {
      Logger.log([`EMPLOYEE: ${name}`, `Paid Left: ${paidLeft}`, "(no payment date)", "----------------------------"].join("\n"));
      continue;
    }

    const startEpoch = startOfDayUtcEpoch_(paymentDate);
    const rec = logIndex.byName.get(name);

    const total = rec ? rec.ts.length : 0;
    const sinceIdx = rec ? lowerBound_(rec.ts, startEpoch) : 0;
    const countSince = rec ? (total - sinceIdx) : 0;

    const maxLines = CONFIG.DEBUG_MAX_MATCH_LINES_PER_EMPLOYEE;
    const lines = [];

    if (rec && countSince > 0) {
      for (let k = sinceIdx; k < rec.ts.length && lines.length < maxLines; k++) {
        lines.push(`Row ${rec.rows[k]} | ${formatTimestampUTC_(rec.ts[k])} | ${rec.text[k]}`);
      }
    }

    Logger.log(
      [
        `EMPLOYEE: ${name}`,
        `Paid Left: ${paidLeft}`,
        `Found since payment: ${countSince}`,
        ...(lines.length ? lines : ["(no entries)"]),
        (countSince > maxLines ? `... (${countSince - maxLines} more)` : ""),
        "----------------------------"
      ].filter(Boolean).join("\n")
    );
  }

  if (CONFIG.DEBUG) Logger.log("========== END DEBUG ==========");

  const snapshot = {
    updatedAtEpochMs: Date.now(),
    updatedAtIso: new Date().toISOString(),
    paidTrainsLeftByEmployee: map
  };

  PropertiesService.getScriptProperties().setProperty(
    CONFIG.SNAPSHOT_PROPERTY_KEY,
    JSON.stringify(snapshot)
  );
}

function getSnapshot_() {
  const raw = PropertiesService.getScriptProperties().getProperty(CONFIG.SNAPSHOT_PROPERTY_KEY);
  return raw ? JSON.parse(raw) : null;
}