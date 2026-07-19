function computePaidTrainsServerSideFast_() {
  const { companySheet, logsSheet } = getSheets_();

  const runIso = new Date().toISOString();
  const firstRow = CONFIG.EMPLOYEE_TABLE_FIRST_ROW;
  const lastRow = CONFIG.EMPLOYEE_TABLE_LAST_ROW;
  const numRows = lastRow - firstRow + 1;

  const names = companySheet.getRange(firstRow, CONFIG.COL_EMPLOYEE_NAME, numRows, 1).getValues();
  const prevPaidLeft = companySheet.getRange(firstRow, CONFIG.COL_PAID_TRAINS_LEFT, numRows, 1).getValues();

  const paymentByName = buildPaymentMap_(companySheet);
  const logIndex = buildTrainingIndexFast_(logsSheet);
  const state = loadState_();

  const out = Array.from({ length: numRows }, () => ["", "", "", "", "", ""]);

  for (let i = 0; i < numRows; i++) {
    const sheetRow = firstRow + i;
    if (sheetRow === CONFIG.STATUS_ROW) continue;

    const name = String(names[i][0] || "").trim();
    if (!name) continue;

    const p = paymentByName.get(name);
    if (!p) continue;

    if (!state[name]) {
      state[name] = {
        carryover: 0,
        last: { dateKey: "", amount: 0, trainValue: 0, isDaily: false }
      };
    }

    // DAILY (-1): always output -1 even without date, and store last
    if (p.isDaily) {
      const old = state[name].last || {};
      const newDateKey = formatDateKey_(p.paymentDate);

      const changed =
        old.isDaily !== true ||
        old.dateKey !== newDateKey ||
        old.amount !== -1 ||
        old.trainValue !== -1;

      if (changed) {
        appendStateLog_([
          runIso,
          name,
          old.dateKey ? "DAILY_CHANGED" : "DAILY_INIT",
          old.dateKey || "",
          old.amount ?? "",
          old.trainValue ?? "",
          newDateKey || "",
          -1,
          -1,
          parseIntSafe_(prevPaidLeft[i][0]) || 0,
          0,
          "Daily marker detected; carryover cleared"
        ]);
      }

      state[name].carryover = 0;
      state[name].last = { dateKey: newDateKey, amount: -1, trainValue: -1, isDaily: true };

      out[i][0] = -1;
      out[i][1] = p.paymentDate || "";
      out[i][2] = -1;
      out[i][3] = -1;
      out[i][4] = "";
      out[i][5] = "";
      continue;
    }

    // NON-daily: require valid payment date
    if (!(p.paymentDate instanceof Date)) continue;

    const curDateKey = formatDateKey_(p.paymentDate);
    const curAmount = safeNumber_(p.payAmount);
    const curTrainValue = safeNumber_(p.trainValue);

    const oldLast = state[name].last || { dateKey: "", amount: 0, trainValue: 0, isDaily: false };

    const paymentChanged =
      oldLast.isDaily === true ||
      oldLast.dateKey !== curDateKey ||
      oldLast.amount !== curAmount ||
      oldLast.trainValue !== curTrainValue;

    if (paymentChanged) {
      const leftover = Math.max(0, parseIntSafe_(prevPaidLeft[i][0]));
      state[name].carryover = leftover;

      appendStateLog_([
        runIso,
        name,
        oldLast.dateKey ? "PAYMENT_CHANGED" : "PAYMENT_INIT",
        oldLast.dateKey || "",
        oldLast.amount ?? "",
        oldLast.trainValue ?? "",
        curDateKey,
        curAmount,
        curTrainValue,
        leftover,
        state[name].carryover || 0,
        oldLast.dateKey ? "Carryover reset to previous leftover" : "Initialized from previous leftover"
      ]);

      state[name].last = { dateKey: curDateKey, amount: curAmount, trainValue: curTrainValue, isDaily: false };
    }

    const paymentStartEpoch = startOfDayUtcEpoch_(p.paymentDate);

    const bought = curTrainValue > 0 ? Math.floor(curAmount / curTrainValue) : 0;
    const carryover = Math.max(0, parseIntSafe_(state[name].carryover));
    const pool = carryover + bought;

    const rec = logIndex.byName.get(name);
    const used = rec ? countSince_(rec.ts, paymentStartEpoch) : 0;
    const firstLogRow = rec ? findFirstRowSince_(rec.ts, rec.rows, paymentStartEpoch) : null;

    const leftNum = pool - used;
    const left = leftNum === 0 ? "" : leftNum;

    out[i][0] = left;
    out[i][1] = p.paymentDate;
    out[i][2] = curAmount;
    out[i][3] = curTrainValue;
    out[i][4] = used;
    out[i][5] = firstLogRow || "";
  }

  saveState_(state);
  companySheet.getRange(firstRow, CONFIG.COL_PAID_TRAINS_LEFT, numRows, 6).setValues(out);
}