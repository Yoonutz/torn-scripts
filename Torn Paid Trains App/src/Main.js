function updateCompanySnapshot(e) {
  const { companySheet } = getSheets_();
  const now = new Date();
  const source = e && e.source ? String(e.source) : "";
  const isAutomatic = !source || source === "trigger";
  const runType = isAutomatic ? "Automatic Run: " : "Manually Run: ";

  try {
    refreshEmployeeTable_();
    refreshNewsLog_();

    computePaidTrainsServerSideFast_();
    storePaidTrainsLeftSnapshotFast_();

    if (companySheet) {
      companySheet.getRange(CONFIG.STATUS_CELL_A1).setValue(runType + now.toLocaleString());
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    Logger.log(`[updateCompanySnapshot] ${message}`);

    if (companySheet) {
      companySheet.getRange(CONFIG.STATUS_CELL_A1).setValue(`Failed: ${now.toLocaleString()} | ${message}`);
    }

    throw error;
  }
}

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const shouldRefresh = params.refresh === "1" || params.refresh === "true";
  const employeeName = String(params.employee || "").trim();

  if (shouldRefresh) {
    try {
      updateCompanySnapshot({ source: "webapp" });
    } catch (error) {
      return createJsonOutput_({
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  if (employeeName) {
    return createJsonOutput_(getEmployeeAuditPayload_(employeeName));
  }

  const snapshot = getSnapshot_();

  const payload = snapshot && snapshot.paidTrainsLeftByEmployee
    ? { paidTrainsLeftByEmployee: snapshot.paidTrainsLeftByEmployee, updatedAtIso: snapshot.updatedAtIso }
    : { error: "No snapshot yet. Run updateCompanySnapshot once or call ?refresh=1" };

  return createJsonOutput_(payload);
}

function createJsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function createUpdateTriggerEvery5Minutes() {
  ScriptApp.newTrigger("updateCompanySnapshot")
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log("[createUpdateTriggerEvery5Minutes] Trigger created.");
}

function getEmployeeAuditPayload_(employeeName) {
  const { companySheet } = getSheets_();
  if (!companySheet) {
    return { error: `Missing required sheet: ${CONFIG.SHEET_COMPANY}` };
  }

  const firstRow = CONFIG.EMPLOYEE_TABLE_FIRST_ROW;
  const lastRow = CONFIG.EMPLOYEE_TABLE_LAST_ROW;
  const numRows = lastRow - firstRow + 1;
  const rows = companySheet.getRange(firstRow, 1, numRows, CONFIG.COL_EFFECTIVE_TRAIN_VALUE).getValues();
  const target = employeeName.toLowerCase();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[CONFIG.COL_EMPLOYEE_NAME - 1] || "").trim();
    if (!name || name.toLowerCase() !== target) continue;

    const paymentDateValue = row[CONFIG.COL_EFFECTIVE_PAYMENT_DATE - 1];
    const paymentDateIso = paymentDateValue instanceof Date
      ? paymentDateValue.toISOString()
      : (paymentDateValue ?? "");
    const paymentDateLocal = paymentDateValue instanceof Date
      ? Utilities.formatDate(paymentDateValue, Session.getScriptTimeZone(), "dd/MM/yyyy")
      : (paymentDateValue ?? "");
    return {
      employee: name,
      trainsLeft: row[CONFIG.COL_PAID_TRAINS_LEFT - 1] ?? "",
      lastPaymentDate: paymentDateLocal,
      lastPaymentDateIso: paymentDateIso,
      lastPaymentAmount: row[CONFIG.COL_EFFECTIVE_PAY_AMOUNT - 1] ?? "",
      trainValue: row[CONFIG.COL_EFFECTIVE_TRAIN_VALUE - 1] ?? ""
    };
  }

  return { error: `Employee not found: ${employeeName}` };
}