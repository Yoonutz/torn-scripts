function runUpdateAndVerifyCases() {
  updateCompanySnapshot({ source: "verification" });
  return toExecutionApiValue_(verifyPaymentChangeAndSameSecondNewsCases());
}

function verifyPaymentChangeAndSameSecondNewsCases() {
  const ss = SpreadsheetApp.openById(CONFIG.ALLOWED_SPREADSHEET_ID);
  const stateLogSheet = ss.getSheetByName(CONFIG.SHEET_STATE_LOG);
  const logsSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);

  const paymentChange = findLatestPaymentChange_(stateLogSheet);
  const sameSecondNews = findSameSecondNews_(logsSheet);
  const deterministicSameSecondNews = verifyDeterministicSameSecondNewsCase_();

  return {
    checkedAtIso: new Date().toISOString(),
    paymentChangeFound: Boolean(paymentChange),
    paymentChange,
    sameSecondNewsFound: sameSecondNews.count > 0,
    sameSecondNewsCount: sameSecondNews.count,
    sameSecondNewsSamples: sameSecondNews.samples,
    deterministicSameSecondNews
  };
}

function findLatestPaymentChange_(stateLogSheet) {
  if (!stateLogSheet) {
    return null;
  }

  const lastRow = stateLogSheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const rows = stateLogSheet.getRange(2, 1, lastRow - 1, 12).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const action = String(row[2] || "");
    if (action !== "PAYMENT_CHANGED") continue;

    return {
      runIso: row[0] || "",
      employee: row[1] || "",
      oldDate: row[3] || "",
      oldAmount: row[4] || "",
      oldTrainValue: row[5] || "",
      newDate: row[6] || "",
      newAmount: row[7] || "",
      newTrainValue: row[8] || "",
      prevLeftover: row[9] || 0,
      carryoverAfter: row[10] || 0,
      note: row[11] || ""
    };
  }

  return null;
}

function findSameSecondNews_(logsSheet) {
  if (!logsSheet) {
    return { count: 0, samples: [] };
  }

  const lastRow = logsSheet.getLastRow();
  if (lastRow < 2) {
    return { count: 0, samples: [] };
  }

  const rows = logsSheet.getRange(1, 1, lastRow, 2).getValues();
  const byTs = new Map();

  for (let i = 0; i < rows.length; i++) {
    const ts = rows[i][0];
    const news = String(rows[i][1] || "").trim();
    if (!ts || !news) continue;

    const key = String(ts);
    let rec = byTs.get(key);
    if (!rec) {
      rec = { texts: new Set(), rows: [] };
      byTs.set(key, rec);
    }

    rec.texts.add(news);
    rec.rows.push(i + 1);
  }

  const samples = [];
  for (const [timestamp, rec] of byTs.entries()) {
    if (rec.texts.size < 2) continue;

    const texts = Array.from(rec.texts);
    samples.push({
      timestamp,
      rowCount: rec.rows.length,
      distinctNewsCount: texts.length,
      rows: rec.rows.slice(0, 5),
      firstNewsPreview: texts[0].slice(0, 120),
      secondNewsPreview: (texts[1] || "").slice(0, 120)
    });

    if (samples.length >= 5) break;
  }

  return {
    count: samples.length,
    samples
  };
}

function verifyDeterministicSameSecondNewsCase_() {
  const timestamp = 1742688000;
  const existingEntries = [
    [timestamp, "Alpha completed a paid train."],
    [timestamp + 1, "Other employee completed a paid train."]
  ];
  const newsById = {
    existingDuplicate: { timestamp, news: "Alpha completed a paid train." },
    sameSecondDistinctA: { timestamp, news: "Bravo completed a paid train." },
    sameSecondDistinctB: { timestamp, news: "Charlie completed a paid train." },
    sameSecondDuplicateWithinBatch: { timestamp, news: "Bravo completed a paid train." },
    nextSecondDistinct: { timestamp: timestamp + 1, news: "Delta completed a paid train." }
  };
  const rowsToAppend = buildNewsRowsToAppend_(existingEntries, newsById);
  const appendedAtSameSecond = rowsToAppend.filter(row => String(row[0]) === String(timestamp));
  const appendedNews = rowsToAppend.map(row => String(row[1] || ""));
  const passed = rowsToAppend.length === 3
    && appendedAtSameSecond.length === 2
    && appendedNews.indexOf("Bravo completed a paid train.") !== -1
    && appendedNews.indexOf("Charlie completed a paid train.") !== -1
    && appendedNews.indexOf("Delta completed a paid train.") !== -1
    && appendedNews.indexOf("Alpha completed a paid train.") === -1;

  return {
    passed,
    appendedRowCount: rowsToAppend.length,
    appendedSameSecondRowCount: appendedAtSameSecond.length,
    appendedNews,
    expectedBehavior: {
      ignoreExactDuplicates: true,
      keepDistinctSameSecondEntries: true
    }
  };
}

function toExecutionApiValue_(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(toExecutionApiValue_);
  }

  if (value && typeof value === "object") {
    const normalized = {};
    const keys = Object.keys(value);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      normalized[key] = toExecutionApiValue_(value[key]);
    }

    return normalized;
  }

  return value;
}
