function onOpen() {
  const allowedSpreadsheetId = CONFIG.ALLOWED_SPREADSHEET_ID;
  const currentSpreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();

  if (currentSpreadsheetId !== allowedSpreadsheetId) return;

  SpreadsheetApp.getUi()
    .createMenu("- 📊 Report -")
    .addItem("Trigger Script", "runMainProjectUpdateFromMenu_")
    .addToUi();
}

function runMainProjectUpdateFromMenu_() {
  updateCompanySnapshot({ source: "menu-main-project" });
}