function ensureEmployeeState_(state, name) {
  if (!state[name]) {
    state[name] = {
      carryover: 0,
      last: { dateKey: "", amount: 0, trainValue: 0, isDaily: false }
    };
  }

  return state[name];
}

function applyDailyPaymentTransition_(params) {
  const { employeeState, paymentDate, runIso, name, prevPaidLeft } = params;
  const old = employeeState.last || {};
  const newDateKey = formatDateKey_(paymentDate);

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
      parseIntSafe_(prevPaidLeft) || 0,
      0,
      "Daily marker detected; carryover cleared"
    ]);
  }

  employeeState.carryover = 0;
  employeeState.last = { dateKey: newDateKey, amount: -1, trainValue: -1, isDaily: true };
}

function applyPaymentChangeTransition_(params) {
  const { employeeState, paymentDate, payAmount, trainValue, runIso, name, prevPaidLeft } = params;
  const curDateKey = formatDateKey_(paymentDate);
  const curAmount = safeNumber_(payAmount);
  const curTrainValue = safeNumber_(trainValue);
  const oldLast = employeeState.last || { dateKey: "", amount: 0, trainValue: 0, isDaily: false };

  const paymentChanged =
    oldLast.isDaily === true ||
    oldLast.dateKey !== curDateKey ||
    oldLast.amount !== curAmount ||
    oldLast.trainValue !== curTrainValue;

  if (!paymentChanged) {
    return { changed: false, curAmount, curTrainValue };
  }

  const leftover = Math.max(0, parseIntSafe_(prevPaidLeft));
  employeeState.carryover = leftover;

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
    employeeState.carryover || 0,
    oldLast.dateKey ? "Carryover reset to previous leftover" : "Initialized from previous leftover"
  ]);

  employeeState.last = { dateKey: curDateKey, amount: curAmount, trainValue: curTrainValue, isDaily: false };
  return { changed: true, curAmount, curTrainValue };
}
