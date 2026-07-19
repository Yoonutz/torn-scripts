function getSheets_() {
  const ss = SpreadsheetApp.openById(CONFIG.ALLOWED_SPREADSHEET_ID);
  return {
    spreadsheet: ss,
    dataSheet: ss.getSheetByName(CONFIG.SHEET_DATA),
    companySheet: ss.getSheetByName(CONFIG.SHEET_COMPANY),
    logsSheet: ss.getSheetByName(CONFIG.SHEET_LOGS)
  };
}