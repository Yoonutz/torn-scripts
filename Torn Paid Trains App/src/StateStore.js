function loadState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(CONFIG.STATE_PROPERTY_KEY);
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveState_(stateObj) {
  PropertiesService.getScriptProperties().setProperty(
    CONFIG.STATE_PROPERTY_KEY,
    JSON.stringify(stateObj || {})
  );
}

function viewPaidTrainsState() {
  const raw = PropertiesService.getScriptProperties().getProperty(CONFIG.STATE_PROPERTY_KEY);
  Logger.log(raw || "(no state yet)");
}