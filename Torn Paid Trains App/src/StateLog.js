function ensureStateLogSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.ALLOWED_SPREADSHEET_ID);
  let sh = ss.getSheetByName(CONFIG.SHEET_STATE_LOG);

  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_STATE_LOG);

  if (sh.getLastRow() === 0) {
    sh.appendRow([
      "Run (ISO UTC)",
      "Employee",
      "Action",
      "Old Date",
      "Old Amount",
      "Old Train Value",
      "New Date",
      "New Amount",
      "New Train Value",
      "Prev Leftover (D)",
      "Carryover After",
      "Note"
    ]);
  }

  return sh;
}

function appendStateLog_(row) {
  ensureStateLogSheet_().appendRow(row);
}

function formatDateKey_(d) {
  return d instanceof Date ? Utilities.formatDate(d, "UTC", "yyyy-MM-dd") : "";
}