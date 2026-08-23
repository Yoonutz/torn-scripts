// Pure functions for Torn Ledger: raw API payloads -> snapshot -> comparison -> markdown.
// No I/O here; collect.mjs and report.mjs own the network and the disk.

const DAY = 86400;
const BAR_WIDTH = 8;
const MAX_LEAK_BULLETS = 7;

export function fmtMoney(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + "B";
  return sign + (abs / 1e6).toFixed(2) + "M";
}

export function fmtDate(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function parseFundsNews(news) {
  const out = [];
  for (const n of news || []) {
    const text = String(n.text || "").replace(/<[^>]+>/g, "");
    let m = text.match(/has withdrawn \$([\d,]+) from the company funds/);
    if (m) {
      out.push({ ts: n.timestamp, amount: Number(m[1].replace(/,/g, "")), kind: "withdraw" });
      continue;
    }
    m = text.match(/has made a deposit of \$([\d,]+) to the company funds/);
    if (m) out.push({ ts: n.timestamp, amount: Number(m[1].replace(/,/g, "")), kind: "deposit" });
  }
  return out;
}

export function deriveSnapshot(raw) {
  const money = raw.money.money;
  const nw = raw.networth.networth;
  const profile = raw.company_profile.profile;
  const employees = raw.company_employees.employees || [];
  const inv = raw.investments.personalstats.investments;
  const trading = raw.trading.personalstats.trading;
  const tornStocks = new Map((raw.torn_stocks.stocks || []).map((s) => [s.id, s]));

  const ready = [];
  const below = [];
  for (const p of raw.stocks.stocks || []) {
    const ref = tornStocks.get(p.id) || {};
    const acronym = ref.acronym || String(p.id);
    if (p.bonus && p.bonus.available) ready.push({ id: p.id, acronym, payout: ref.bonus ? ref.bonus.description : "" });
    const requirement = ref.bonus ? ref.bonus.requirement : 0;
    if (p.bonus && p.bonus.increment === null && requirement > 0) {
      const price = ref.market ? ref.market.price : 0;
      below.push({ id: p.id, acronym, shares: p.shares, requirement, value: Math.round(p.shares * price) });
    }
  }

  const bank = money.city_bank || {};
  return {
    taken_at: raw.taken_at,
    date: fmtDate(raw.taken_at),
    networth: {
      total: nw.total,
      wallet: nw.money.wallet,
      vault: nw.money.vault,
      bank: nw.money.city_bank,
      faction: money.faction ? money.faction.money : 0,
      inventory: nw.items.inventory,
      bazaar: nw.items.bazaar,
      item_market: nw.items.item_market,
      stock_market: nw.assets.stock_market,
      unpaid_fees: nw.money.unpaid_fees,
    },
    bank: {
      amount: bank.amount || 0,
      profit: bank.profit || 0,
      duration: bank.duration || 0,
      per_day: bank.duration ? Math.round(bank.profit / bank.duration) : 0,
      until: bank.until || 0,
    },
    stocks: {
      positions: (raw.stocks.stocks || []).length,
      ready,
      below_threshold: below,
      below_threshold_value: below.reduce((a, b) => a + b.value, 0),
    },
    company: {
      id: profile.id,
      name: profile.name,
      rating: profile.rating,
      daily_income: profile.income.daily,
      weekly_income: profile.income.weekly,
      daily_customers: profile.customers.daily,
      weekly_customers: profile.customers.weekly,
      funds: profile.funds,
      popularity: profile.popularity,
      hired: profile.employees.hired,
      capacity: profile.employees.capacity,
      ad_budget: profile.advertisement_budget,
      wages_per_day: employees.reduce((a, e) => a + (e.wage || 0), 0),
      inactive_employees: employees.filter((e) => (e.effectiveness.inactivity || 0) < 0).length,
      weak_employees: employees.filter((e) => (e.effectiveness.total || 0) < 100).length,
      fund_moves: parseFundsNews(raw.company_news.news),
    },
    lifetime: {
      bazaar_profit: trading.bazaar.profit,
      bazaar_sales: trading.bazaar.sales,
      item_market_revenue: trading.item_market.revenue,
      bank_profit: inv.bank.profit,
      stock_net_profits: inv.stocks.net_profits,
      stock_payouts: inv.stocks.payouts,
    },
  };
}

export function pickBaseline(snapshots, current) {
  const older = snapshots.filter((s) => s.taken_at < current.taken_at).sort((a, b) => b.taken_at - a.taken_at);
  if (!older.length) return null;
  const weekOld = older.find((s) => current.taken_at - s.taken_at >= 6 * DAY);
  return weekOld || older[older.length - 1];
}

function leaksFor(cur) {
  const leaks = [];
  const s = cur.stocks;
  if (s.ready.length) {
    leaks.push({ kind: "stock_payouts_ready", amount: null, text: s.ready.length + " stock payout" + (s.ready.length > 1 ? "s" : "") + " ready, uncollected (" + s.ready.map((r) => r.acronym).join(", ") + ")", action: "Collect stock payouts" });
  }
  const b = cur.bank;
  if (!b.amount) {
    leaks.push({ kind: "bank_empty", amount: null, text: "City bank empty; nothing earning interest", action: "Invest in city bank" });
  } else if (b.until && b.until <= cur.taken_at) {
    leaks.push({ kind: "bank_matured", amount: b.amount, text: "Bank matured, " + fmtMoney(b.amount) + " idle; every idle day costs " + fmtMoney(b.per_day), action: "Reinvest matured bank deposit now" });
  } else if (b.until && b.until - cur.taken_at <= 7 * DAY) {
    const days = Math.round((b.until - cur.taken_at) / DAY);
    leaks.push({ kind: "bank_maturing", amount: b.amount, text: "Bank matures in " + days + " day" + (days === 1 ? "" : "s") + "; reinvest same hour, idle day costs " + fmtMoney(b.per_day), action: "Reinvest bank deposit on maturity day" });
  }
  const c = cur.company;
  if (c.hired < c.capacity) {
    leaks.push({ kind: "company_slot_empty", amount: null, text: (c.capacity - c.hired) + " company slot" + (c.capacity - c.hired > 1 ? "s" : "") + " empty (" + c.hired + "/" + c.capacity + ")", action: "Fill empty company slot" });
  }
  if (c.inactive_employees) {
    leaks.push({ kind: "employee_inactive", amount: null, text: c.inactive_employees + " employee" + (c.inactive_employees > 1 ? "s" : "") + " carrying inactivity penalty", action: "Replace or nudge inactive employees" });
  }
  if (c.weak_employees) {
    leaks.push({ kind: "employee_weak", amount: null, text: c.weak_employees + " employee" + (c.weak_employees > 1 ? "s" : "") + " under 100 effectiveness", action: "Train or replace weak employees" });
  }
  if (s.below_threshold.length) {
    leaks.push({ kind: "stocks_below_threshold", amount: s.below_threshold_value, text: fmtMoney(s.below_threshold_value) + " in stocks below payout threshold (" + s.below_threshold.map((p) => p.acronym).join(", ") + ")", action: "Top up or sell stocks below payout threshold" });
  }
  const n = cur.networth;
  if (n.unpaid_fees < 0) {
    leaks.push({ kind: "unpaid_fees", amount: -n.unpaid_fees, text: "Unpaid fees " + fmtMoney(-n.unpaid_fees), action: "Pay fees" });
  }
  if (n.faction >= 50e6) {
    leaks.push({ kind: "faction_idle", amount: n.faction, text: "Faction balance " + fmtMoney(n.faction) + " earns nothing", action: "Put faction balance to work" });
  }
  if (n.vault >= 50e6) {
    leaks.push({ kind: "vault_idle", amount: n.vault, text: "Vault " + fmtMoney(n.vault) + " earns nothing", action: "Move vault cash into something that pays" });
  }
  if (n.bazaar === 0 && n.inventory >= 100e6) {
    leaks.push({ kind: "bazaar_empty", amount: n.inventory, text: "Bazaar empty while inventory holds " + fmtMoney(n.inventory), action: "Restock bazaar from inventory" });
  }
  return leaks;
}

export function compare(prev, cur) {
  const leaks = leaksFor(cur);
  const bank = {
    per_day: cur.bank.per_day,
    days_to_maturity: cur.bank.until ? Math.round((cur.bank.until - cur.taken_at) / DAY) : null,
    matured: Boolean(cur.bank.amount && cur.bank.until && cur.bank.until <= cur.taken_at),
  };
  if (!prev) {
    return { baseline: true, days: null, date: cur.date, networth: { total: cur.networth.total, per_day: null }, company: { income_per_day: Math.round(cur.company.weekly_income / 7), income_per_day_prev: null, net_per_day: null, popularity: cur.company.popularity, popularity_prev: null, hired: cur.company.hired, capacity: cur.company.capacity }, bank, stocks: { ready: cur.stocks.ready.length, below_threshold_value: cur.stocks.below_threshold_value, payouts_collected: null }, bazaar: { profit: null, sales: null, listed: cur.networth.bazaar, listed_prev: null }, inventory: { value: cur.networth.inventory, delta: null, item_market: cur.networth.item_market }, leaks };
  }
  const days = (cur.taken_at - prev.taken_at) / DAY;
  const moves = cur.company.fund_moves.filter((m) => m.ts > prev.taken_at && m.ts <= cur.taken_at);
  const withdrawn = moves.filter((m) => m.kind === "withdraw").reduce((a, m) => a + m.amount, 0);
  const deposited = moves.filter((m) => m.kind === "deposit").reduce((a, m) => a + m.amount, 0);
  return {
    baseline: false,
    days,
    date: cur.date,
    prev_date: prev.date,
    networth: { total: cur.networth.total, prev_total: prev.networth.total, per_day: Math.round((cur.networth.total - prev.networth.total) / days) },
    company: {
      income_per_day: Math.round(cur.company.weekly_income / 7),
      income_per_day_prev: Math.round(prev.company.weekly_income / 7),
      net_per_day: Math.round((cur.company.funds - prev.company.funds + withdrawn - deposited) / days),
      popularity: cur.company.popularity,
      popularity_prev: prev.company.popularity,
      hired: cur.company.hired,
      capacity: cur.company.capacity,
    },
    bank,
    stocks: { ready: cur.stocks.ready.length, below_threshold_value: cur.stocks.below_threshold_value, payouts_collected: cur.lifetime.stock_payouts - prev.lifetime.stock_payouts },
    bazaar: { profit: cur.lifetime.bazaar_profit - prev.lifetime.bazaar_profit, sales: cur.lifetime.bazaar_sales - prev.lifetime.bazaar_sales, listed: cur.networth.bazaar, listed_prev: prev.networth.bazaar },
    inventory: { value: cur.networth.inventory, delta: cur.networth.inventory - prev.networth.inventory, item_market: cur.networth.item_market },
    leaks,
  };
}

function bar(value, max) {
  if (!max || value <= 0) return "·".repeat(BAR_WIDTH);
  const filled = Math.max(1, Math.round((value / max) * BAR_WIDTH));
  return "█".repeat(filled) + "·".repeat(BAR_WIDTH - filled);
}

function pad(s, w) {
  s = String(s);
  return s + " ".repeat(Math.max(0, w - s.length));
}

function pct(cur, prev) {
  if (!prev) return "";
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (p === 0) return "= flat";
  return (p > 0 ? "▲ +" : "▼ ") + p + "%";
}

export function render(c, history = []) {
  const L = [];
  L.push("**Torn Ledger - " + c.date + "**");
  L.push("");
  if (c.baseline) {
    L.push("First snapshot, nothing to compare yet. Next run shows deltas against this one.");
  } else {
    const dir = c.networth.per_day >= 0 ? "grew" : "shrank";
    L.push("Networth " + dir + " " + fmtMoney(Math.abs(c.networth.per_day)) + "/day over " + Math.round(c.days) + " days" + (c.company.income_per_day_prev !== null ? "; company income " + pct(c.company.income_per_day, c.company.income_per_day_prev).replace("= flat", "flat") + " vs last period." : "."));
  }
  L.push("");
  L.push("Income per day:");
  L.push("");
  L.push("```");
  const rows = [];
  if (!c.baseline) rows.push(["networth", c.networth.per_day, ""]);
  rows.push(["company income", c.company.income_per_day, pct(c.company.income_per_day, c.company.income_per_day_prev)]);
  if (!c.baseline) rows.push(["company net", c.company.net_per_day, ""]);
  rows.push(["bank interest", c.bank.per_day, c.bank.matured ? "matured, idle" : ""]);
  const max = Math.max(...rows.map((r) => r[1]));
  for (const [label, v, note] of rows) L.push(pad(label, 15) + bar(v, max) + " " + pad(fmtMoney(v) + "/day", 12) + note);
  if (!c.baseline) L.push(pad("bazaar profit", 15) + (c.bazaar.profit > 0 ? fmtMoney(c.bazaar.profit) + " this period, " + c.bazaar.sales + " sales" : "0 this period"));
  L.push(pad("stock payouts", 15) + (c.baseline ? c.stocks.ready + " ready" : c.stocks.payouts_collected + " collected, " + c.stocks.ready + " waiting"));
  L.push("```");
  L.push("");
  L.push("Inventory:");
  L.push("");
  L.push("```");
  const invMax = Math.max(c.inventory.value, c.bazaar.listed, 1);
  L.push(pad("inventory value", 17) + bar(c.inventory.value, invMax) + " " + pad(fmtMoney(c.inventory.value), 9) + (c.inventory.delta === null ? "" : pct(c.inventory.value, c.inventory.value - c.inventory.delta) + " (" + fmtMoney(c.inventory.delta) + ")"));
  L.push(pad("bazaar listed", 17) + bar(c.bazaar.listed, invMax) + " " + pad(fmtMoney(c.bazaar.listed), 9) + (c.bazaar.listed_prev === null ? "" : c.bazaar.listed_prev === 0 && c.bazaar.listed > 0 ? "▲ was empty" : pct(c.bazaar.listed, c.bazaar.listed_prev)));
  L.push(pad("item market", 17) + bar(c.inventory.item_market, invMax) + " " + fmtMoney(c.inventory.item_market));
  L.push("```");
  L.push("");
  L.push("Leaks:");
  L.push("");
  if (!c.leaks.length) L.push("- None found.");
  for (const l of c.leaks.slice(0, MAX_LEAK_BULLETS)) L.push("- " + l.text + ".");
  if (c.leaks.length > MAX_LEAK_BULLETS) {
    L.push("");
    L.push("Plus " + (c.leaks.length - MAX_LEAK_BULLETS) + " smaller: " + c.leaks.slice(MAX_LEAK_BULLETS).map((l) => l.text).join("; ") + ".");
  }
  L.push("");
  L.push("Do this week:");
  L.push("");
  const actions = c.leaks.slice(0, 2);
  if (!actions.length) L.push("1. Nothing urgent. Keep the routine.");
  actions.forEach((l, i) => L.push(i + 1 + ". " + l.action + "."));
  L.push("");
  L.push("Company: popularity " + c.company.popularity + (c.company.popularity_prev !== null && c.company.popularity_prev !== undefined ? " (was " + c.company.popularity_prev + ")" : "") + ", staff " + c.company.hired + "/" + c.company.capacity + ".");
  if (history.length > 1) {
    L.push("");
    L.push("Trend since baseline:");
    L.push("");
    L.push("```");
    const pairs = [];
    for (let i = 1; i < history.length; i++) {
      const d = (history[i].taken_at - history[i - 1].taken_at) / DAY;
      pairs.push([history[i].date, Math.round((history[i].networth.total - history[i - 1].networth.total) / d)]);
    }
    const tmax = Math.max(...pairs.map((p) => Math.abs(p[1])));
    for (const [date, v] of pairs) L.push(date + " " + bar(Math.abs(v), tmax) + " " + (v < 0 ? "-" : "") + fmtMoney(Math.abs(v)) + "/day networth");
    L.push("```");
  }
  return L.join("\n") + "\n";
}
