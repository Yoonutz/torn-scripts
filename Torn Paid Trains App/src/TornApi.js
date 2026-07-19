function getTornApiKey_() {
  const { dataSheet } = getSheets_();
  if (!dataSheet) {
    throw new Error(`[getTornApiKey_] Missing required sheet: ${CONFIG.SHEET_DATA}`);
  }

  const apiKey = String(dataSheet.getRange(CONFIG.API_KEY_CELL_A1).getValue() || "").trim();
  if (!apiKey) {
    throw new Error(`[getTornApiKey_] Missing Torn API key in ${CONFIG.SHEET_DATA}!${CONFIG.API_KEY_CELL_A1}`);
  }

  return apiKey;
}

function fetchTornCompanyApi_(selectionsQuery, apiKey) {
  const url = `https://api.torn.com/company/?selections=${selectionsQuery}&key=${apiKey}`;
  let response;

  try {
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (error) {
    throw new Error(`[fetchTornCompanyApi_] Request failed for "${selectionsQuery}": ${error.message || error}`);
  }

  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`[fetchTornCompanyApi_] Torn API HTTP ${statusCode} for "${selectionsQuery}": ${body.slice(0, 200)}`);
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`[fetchTornCompanyApi_] Invalid JSON for "${selectionsQuery}": ${error.message || error}`);
  }

  if (payload?.error) {
    const errorCode = payload.error.code ?? payload.error.errorCode ?? "unknown";
    const errorMessage = payload.error.error ?? payload.error.message ?? JSON.stringify(payload.error);
    throw new Error(`[fetchTornCompanyApi_] Torn API error ${errorCode} for "${selectionsQuery}": ${errorMessage}`);
  }

  return payload;
}

function refreshEmployeeTable_() {
  const companySheet = ensureCompanySheet_();
  const apiKey = getTornApiKey_();

  const employeesResponse = fetchTornCompanyApi_("employees", apiKey);
  if (!employeesResponse?.company_employees) {
    throw new Error("[refreshEmployeeTable_] No company_employees found in Torn response.");
  }

  clearEmployeeTablePreservingStatusRow_(companySheet);
  writeEmployeeRows_(companySheet, employeesResponse.company_employees);
}

function refreshNewsLog_() {
  const logsSheet = ensureLogsSheet_();
  const apiKey = getTornApiKey_();

  const latestTs = getLatestLogTimestamp_();
  // Go back 24 hours behind the latest stored entry so any same-second events
  // that were previously missed by the dedup bug can still be recovered.
  let fromEpoch = latestTs ? latestTs - 86400 : CONFIG.NEWS_FROM_EPOCH;

  while (true) {
    const newsResponse = fetchTornCompanyApi_(`news&from=${fromEpoch}`, apiKey);
    if (!newsResponse?.news) break;

    const entries = Object.values(newsResponse.news);
    if (entries.length === 0) break;

    appendNewsRows_(logsSheet, newsResponse.news);

    if (entries.length < 100) break;

    // More pages exist — advance fromEpoch to the newest timestamp in this batch
    let maxTs = 0;
    for (const e of entries) {
      const t = Number(e.timestamp) || 0;
      if (t > maxTs) maxTs = t;
    }
    if (maxTs <= fromEpoch) break; // No progress — safety guard
    fromEpoch = maxTs;
  }
}