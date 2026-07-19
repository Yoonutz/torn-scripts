function buildPaymentMap_(companySheet) {
  const map = new Map();
  const lastRow = companySheet.getLastRow();
  if (lastRow < 2) return map;

  const values = companySheet.getRange(2, CONFIG.COL_PAYTABLE_NAME, lastRow - 1, 4).getValues();

  for (const r of values) {
    const name = String(r[0] || "").trim();
    if (!name) continue;

    const paymentDate = r[1] instanceof Date ? r[1] : null;
    const payAmount = parseMoneyOrNumber_(r[2]);
    const trainValue = parseMoneyOrNumber_(r[3]);
    const isDaily = payAmount === -1 || trainValue === -1;

    map.set(name, { paymentDate, payAmount, trainValue, isDaily });
  }

  return map;
}