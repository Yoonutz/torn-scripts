// supabase/functions/war-poll/index.ts
// ============================================================
// Torn War Enforcement — Phase 1 + Phase 2
//   Phase 1: detect active war, write faction totals, faction-total rule.
//   Phase 2: roster + incremental attacksfull tally -> member_progress,
//            then recompute_member_verdicts() applies all 3 rules.
//   Idle (no war): 1 Torn call, exit.
// Env: TORN_API_KEY (secret), SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto)
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const TORN_API_KEY = Deno.env.get("TORN_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const nowSec = () => Math.floor(Date.now() / 1000);
const isoNow = () => new Date().toISOString();
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// ---- Torn calls ----
async function tornV2(path: string): Promise<any> {
  const r = await fetch(`https://api.torn.com/v2${path}`, {
    headers: { Accept: "application/json", Authorization: `ApiKey ${TORN_API_KEY}` },
  });
  if (!r.ok) throw new Error(`Torn v2 HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`Torn v2 error ${j.error.code ?? j.error}: ${j.error.error ?? ""}`);
  return j;
}
async function tornV1(path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.torn.com${path}${sep}key=${TORN_API_KEY}`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Torn v1 HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`Torn v1 error ${j.error.code ?? j.error}: ${j.error.error ?? ""}`);
  return j;
}

// ---- attack normalization (v1 object-of-objects OR v2 array/nested) ----
// `ranked`: true/false from v2 /faction/attacks (`is_ranked_war`); undefined on
// feeds that don't carry the flag (v1/v2 attacksfull) — caller then falls back
// to defender-faction matching so outside hits never count toward war score.
function normOne(a: any, key?: string) {
  const code = a.code ?? a.id ?? key ?? null;
  let attId, attFac, defFac, ts, resp;
  if (a.attacker && typeof a.attacker === "object") {            // v2 nested
    attId = a.attacker.id; attFac = a.attacker.faction?.id ?? a.attacker.faction_id ?? 0;
    defFac = a.defender?.faction?.id ?? a.defender?.faction_id ?? 0;
    ts = a.started ?? a.timestamp_started; resp = a.respect_gain ?? a.respect;
  } else {                                                        // v1 flat
    attId = a.attacker_id; attFac = a.attacker_faction; defFac = a.defender_faction;
    ts = a.timestamp_started ?? a.started; resp = a.respect_gain ?? a.respect;
  }
  if (!code || !attId) return null;
  return {
    code: String(code), attacker_id: Number(attId), attacker_fac: Number(attFac) || 0,
    defender_fac: Number(defFac) || 0, ts: Number(ts) || 0, respect: Number(resp) || 0,
    ranked: typeof a.is_ranked_war === "boolean" ? a.is_ranked_war : undefined,
  };
}
function normAttacks(payload: any): any[] {
  const raw = payload?.attacks ?? payload?.attacksfull?.attacks ?? payload;
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw.map((a: any) => normOne(a))
    : Object.entries(raw).map(([k, a]: any) => normOne(a, k));
  return list.filter(Boolean) as any[];
}

async function fetchAttackWindow(from: number, to: number): Promise<any[]> {
  // v2 /faction/attacks first — the only feed carrying is_ranked_war.
  try {
    const rows = normAttacks(await tornV2(`/faction/attacks?from=${from}&to=${to}&limit=1000&sort=ASC`));
    if (rows.length) return rows;
  } catch (_) { /* fall through */ }
  try {
    const v1 = await tornV1(`/faction/?selections=attacksfull&from=${from}&to=${to}`);
    const rows = normAttacks(v1);
    if (rows.length) return rows;
  } catch (_) { /* fall through */ }
  try {
    return normAttacks(await tornV2(`/faction/attacksfull?from=${from}&to=${to}`));
  } catch (_) { return []; }
}

// ---- Phase 2 helpers ----
async function ensureRoster(warId: number, myFid: number) {
  const { count } = await db.from("member_progress")
    .select("member_id", { count: "exact", head: true }).eq("war_id", warId);
  if ((count ?? 0) > 0) return;                       // roster already stored
  const resp = await tornV1(`/faction/${myFid}?selections=basic`);
  const members = resp?.members ?? {};
  const rows = Object.entries(members).map(([id, m]: any) => ({
    war_id: warId, member_id: Number(id), name: m?.name ?? String(id),
    score: 0, attacks: 0, blocked: false, reasons: [],
  }));
  if (rows.length) await db.from("member_progress").upsert(rows, { onConflict: "war_id,member_id" });
}

// Rule #4: pull the ENEMY faction's last-action timestamps (1 API call, all
// members). The userscript computes idle minutes live from these, so the
// N-minute gate lands exactly on time. Compliant: official API data only.
async function updateEnemyStatus(warId: number, oppId: number) {
  if (!oppId) return;
  const resp = await tornV1(`/faction/${oppId}?selections=basic`);
  const members = resp?.members ?? {};
  const rows = Object.entries(members).map(([id, m]: any) => {
    const la = m?.last_action ?? {};
    return {
      war_id: warId, member_id: Number(id),
      last_action_ts: Number(la.timestamp ?? 0) || 0,
      status: (String(la.status ?? "").toLowerCase() || null),
      updated_at: isoNow(),
    };
  }).filter((r: any) => r.member_id);
  if (rows.length) await db.from("enemy_status").upsert(rows, { onConflict: "war_id,member_id" });
}

// Tally attacks in 1h windows; cap per run so a cold start can't blow the rate
// limit. Returns the high-water timestamp actually processed.
async function tallyAttacks(warId: number, myFid: number, oppId: number, from: number, to: number): Promise<number> {
  const WINDOW = 3600, MAX_WINDOWS = 50;
  const windows: { from: number; to: number }[] = [];
  for (let ts = from; ts < to; ts += WINDOW) windows.push({ from: ts, to: Math.min(ts + WINDOW - 1, to) });
  if (!windows.length) return to;
  const slice = windows.slice(0, MAX_WINDOWS);
  const seen = new Set<string>();
  const rows: any[] = [];
  for (const w of slice) {                            // sequential = gentle on rate limit (usually 1 window)
    for (const a of await fetchAttackWindow(w.from, w.to)) {
      if (a.attacker_fac !== myFid) continue;         // only OUR members' attacks
      // Ingest ALL hits, flagged: caps fire on war hits only (is_war), outside
      // hits are tracked for the respect split. is_ranked_war when the feed has
      // it; defender-faction match as the fallback approximation.
      const isWarHit = a.ranked !== undefined ? a.ranked : (oppId > 0 && a.defender_fac === oppId);
      if (seen.has(a.code)) continue;
      seen.add(a.code);
      rows.push({ code: a.code, war_id: warId, attacker_id: a.attacker_id, attacker_fac: a.attacker_fac, respect_gain: a.respect, ts: a.ts, is_war: isWarHit });
    }
  }
  if (rows.length) await db.from("attacks").upsert(rows, { onConflict: "code", ignoreDuplicates: true });
  return slice[slice.length - 1].to;
}

Deno.serve(async () => {
  try {
    const { data: cfg, error: cfgErr } = await db.from("config").select("*").eq("id", 1).single();
    if (cfgErr || !cfg) throw new Error("config row missing — run 01_schema.sql + set faction_id");
    const myFid = Number(cfg.faction_id);
    if (!myFid) throw new Error("config.faction_id not set");

    const warsResp = await tornV2("/faction/wars");
    const ranked = warsResp?.wars?.ranked ?? null;
    const now = nowSec();
    const hasWar  = !!ranked && !!ranked.war_id;
    const ended   = hasWar && !!ranked.end && Number(ranked.end) > 0 && Number(ranked.end) <= now;
    const started = hasWar && Number(ranked.start ?? 0) <= now;
    const isActive   = hasWar && started && !ended;
    const isEnlisted = hasWar && !started && !ended;   // matched, not yet started

    if (!hasWar || ended) {
      await db.from("war_state").update({ active: false, enlisted: false, faction_blocked: false, updated_at: isoNow() }).eq("id", 1);
      await db.from("wars").update({ active: false, end_ts: now, updated_at: isoNow() }).eq("active", true);
      return json({ ok: true, war: false });
    }

    const factions: any[] = ranked.factions ?? [];
    const fid = (f: any) => Number(f.id ?? f.ID);
    const mine = factions.find((f) => fid(f) === myFid);
    const opp = factions.find((f) => fid(f) !== myFid);
    const warId = Number(ranked.war_id);
    const startTs = Number(ranked.start ?? now);

    if (isEnlisted) {
      // Enlisted but not started → countdown only. No scoring, no blocking.
      await db.from("war_state").update({
        active: false, enlisted: true, war_id: warId,
        opponent_name: opp?.name ?? null, start_ts: startTs,
        our_score: 0, opp_score: 0, our_attacks: 0, faction_blocked: false,
        win_target: Number(ranked.target ?? 0),
        total_score_target: Number(cfg.total_score_target),
        per_member_score_target: Number(cfg.per_member_score_target),
        max_attacks_per_member: Number(cfg.max_attacks_per_member),
        idle_minutes_target: Number(cfg.idle_minutes_target),
        updated_at: isoNow(),
      }).eq("id", 1);
      return json({ ok: true, war: "enlisted", war_id: warId, start: startTs });
    }

    // ── ACTIVE from here ──
    const ourScore = Number(mine?.score ?? 0);
    const oppScore = Number(opp?.score ?? 0);
    const ourAttacks = Number(mine?.attacks ?? 0);
    const winTarget = Number(ranked.target ?? 0);

    await db.from("wars").upsert({
      war_id: warId, faction_id: myFid,
      opponent_id: opp ? fid(opp) : null, opponent_name: opp?.name ?? null,
      start_ts: startTs, end_ts: null,
      our_score: ourScore, opp_score: oppScore, our_attacks: ourAttacks,
      win_target: winTarget, active: true, updated_at: isoNow(),
    }, { onConflict: "war_id" });

    const totalTarget = Number(cfg.total_score_target);
    const factionBlocked = totalTarget > 0 && ourScore >= totalTarget;   // 0 = no cap

    await db.from("war_state").update({
      active: true, enlisted: false, war_id: warId,
      opponent_name: opp?.name ?? null, start_ts: startTs,
      our_score: ourScore, opp_score: oppScore, our_attacks: ourAttacks,
      win_target: winTarget, total_score_target: Number(cfg.total_score_target),
      per_member_score_target: Number(cfg.per_member_score_target),
      max_attacks_per_member: Number(cfg.max_attacks_per_member),
      idle_minutes_target: Number(cfg.idle_minutes_target),
      faction_blocked: factionBlocked, updated_at: isoNow(),
    }).eq("id", 1);

    // Rule #4: enemy last-action times (1 API call). Non-fatal on error.
    try { await updateEnemyStatus(warId, opp ? fid(opp) : 0); }
    catch (e) { console.error("[war-poll] enemy status", e); }

    // ── Phase 2: per-member ──
    await ensureRoster(warId, myFid);
    const { data: wrow } = await db.from("wars").select("last_poll_ts").eq("war_id", warId).single();
    const last = Number(wrow?.last_poll_ts ?? 0);
    const from = Math.max(startTs, (last > 0 ? last - 120 : startTs));
    const highWater = await tallyAttacks(warId, myFid, opp ? fid(opp) : 0, from, now);
    await db.rpc("recompute_member_verdicts", { p_war_id: warId, p_faction_blocked: factionBlocked });
    await db.from("wars").update({ last_poll_ts: highWater }).eq("war_id", warId);

    return json({ ok: true, war: true, war_id: warId, our_score: ourScore, faction_blocked: factionBlocked });
  } catch (e) {
    console.error("[war-poll]", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});