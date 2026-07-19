function startOfDayUtcEpoch_(dateObj) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth();
  const d = dateObj.getDate();
  return Math.floor(Date.UTC(y, m, d, 0, 0, 0) / 1000);
}

function formatTimestampUTC_(ts) {
  return Utilities.formatDate(new Date(ts * 1000), "UTC", "dd/MM/yyyy HH:mm:ss");
}

function safeNumber_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseIntSafe_(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.trunc(n);
  const s = String(v).replace(/[^\d-]/g, "");
  const m = Number(s);
  return Number.isFinite(m) ? Math.trunc(m) : 0;
}

function parseMoneyOrNumber_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;

  const s = String(v).trim();
  if (s === "-1") return -1;

  const cleaned = s.replace(/[^\d-]/g, "");
  if (cleaned === "-1") return -1;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}