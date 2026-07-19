// Supabase Edge Function: oc-gateway
// Locked gateway for the Torn OC Best-Fit userscript.
//
// Why: tables have RLS that denies ALL direct anon access. Every read/write goes through
// this function, which verifies the caller against Torn's own API (/key/info) and then
// reads/writes with the service-role key — tagging rows with the SERVER-VERIFIED
// faction_id / user_id. This makes spoofing impossible (you can only write data for the
// faction your key actually belongs to) and scopes reads to your own faction.
//
// The Torn API key is received only to call /key/info, then discarded. It is never
// stored and never logged.
//
// Deploy:
//   supabase functions deploy oc-gateway --no-verify-jwt
// (--no-verify-jwt because we authenticate via the Torn key, not a Supabase user JWT.
//  The function is still only reachable with the project's anon key as apikey.)

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCHEMA = "torn_oc_cpr";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Verify the caller via Torn; returns server-trusted ids. Throws if invalid / no faction.
async function verify(key: string): Promise<{ user_id: number; faction_id: number }> {
  if (!key || typeof key !== "string") throw new Error("missing key");
  const r = await fetch(`https://api.torn.com/v2/key/info?key=${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
  });
  const j = await r.json();
  if (j?.error) throw new Error(`torn key rejected (${j.error.code})`);
  const u = j?.info?.user ?? j?.user ?? {};
  if (!u.id || !u.faction_id) throw new Error("key has no faction access");
  return { user_id: u.id, faction_id: u.faction_id };
}

// PostgREST call with the service-role key (bypasses RLS), scoped to our schema.
function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      "Content-Type": "application/json",
      "Accept-Profile": SCHEMA,
      "Content-Profile": SCHEMA,
      ...(init.headers || {}),
    },
  });
}

// Curated, faction-tunable keys with inclusive numeric bounds. Mirrors OCScore.CFG_BOUNDS.
const CFG_BOUNDS: Record<string, [number, number]> = {
  W_WIN: [0, 100], W_FAIL: [-100, 0], W_OFFENCE: [-100, 0], W_GOODCRIT: [0, 100],
  W_FOLLOW: [0, 100], HALF_LIFE_DAYS: [1, 365], FLAG_BELOW: [1, 1999], SCORE_PER_DIFF: [0, 200],
};
function sanitizeCfg(raw: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of Object.keys(CFG_BOUNDS)) {
    const v = raw[k];
    if (typeof v !== "number" || !isFinite(v)) continue;
    const [lo, hi] = CFG_BOUNDS[k];
    if (v < lo || v > hi) continue;
    out[k] = v;
  }
  return out;
}
// True only if the verified user is the faction's Leader or Co-leader (canonical names).
async function isFactionAdmin(key: string, userId: number): Promise<boolean> {
  const r = await fetch(`https://api.torn.com/v2/faction/members?key=${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
  });
  const j = await r.json();
  if (j?.error) return false;
  const members = Array.isArray(j?.members) ? j.members : Object.values(j?.members ?? {});
  const me = (members as any[]).find((m) => Number(m.id) === Number(userId));
  const pos = String(me?.position ?? "").trim().toLowerCase();
  return pos === "leader" || pos === "co-leader";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  let id: { user_id: number; faction_id: number };
  try { id = await verify(body.key); } catch (e) { return json({ error: String((e as Error).message) }, 401); }

  try {
    if (body.action === "pull") {
      const q = `oc_crime_stats?faction_id=eq.${id.faction_id}` +
        `&select=difficulty,name,ok,fail,med_money,med_respect,samples,payout_pct,participants`;
      const r = await rest(q, { method: "GET" });
      if (!r.ok) return json({ error: `read failed ${r.status}` }, 502);
      const rows = await r.json();
      return json({ rows });
    }

    if (body.action === "snapshots") {
      // this user's own CPR snapshots (for the personal trend), oldest first
      const r = await rest(
        `cpr_snapshots?user_id=eq.${id.user_id}&select=ts,cprs&order=ts.asc&limit=1000`,
        { method: "GET" },
      );
      if (!r.ok) return json({ error: `snapshots read failed ${r.status}` }, 502);
      const rows = await r.json();
      return json({ rows });
    }

    if (body.action === "community") {
      // Shared knowledge base: crime-level facts pooled across ALL factions, gated by
      // k-anonymity (only published once >= K_ANON distinct factions contributed). No
      // faction_id / user_id leaves; not scoped to the caller's faction (intentionally global).
      const K_ANON = 3;
      const q = `community_crime_stats?factions=gte.${K_ANON}` +
        `&select=name,difficulty,ok,fail,samples,med_money,med_respect`;
      const r = await rest(q, { method: "GET" });
      if (!r.ok) return json({ error: `community read failed ${r.status}` }, 502);
      return json({ rows: await r.json(), k: K_ANON });
    }

    if (body.action === "weights") {
      const r = await rest(`role_weights?select=name,position,weight`, { method: "GET" });
      if (!r.ok) return json({ error: `weights read failed ${r.status}` }, 502);
      return json({ rows: await r.json() });
    }

    if (body.action === "pushweights") {
      if (Array.isArray(body.weights) && body.weights.length) {
        const rows = body.weights.slice(0, 3000).map((w: any) => ({
          name: w.name, position: w.position, weight: w.weight, updated_at: w.updated_at || 0,
        }));
        const r = await rest("role_weights", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        });
        if (!r.ok) return json({ error: `weights write failed ${r.status}` }, 502);
      }
      return json({ ok: true });
    }


    if (body.action === "scoringcfg") {
      const r = await rest(
        `scoring_config?faction_id=eq.${id.faction_id}&select=cfg,updated_at`,
        { method: "GET" },
      );
      if (!r.ok) return json({ error: `scoringcfg read failed ${r.status}` }, 502);
      const rows = await r.json();
      return json({ cfg: rows[0]?.cfg ?? {}, updated_at: rows[0]?.updated_at ?? null });
    }

    if (body.action === "pushscoringcfg") {
      if (!(await isFactionAdmin(body.key, id.user_id)))
        return json({ error: "only the faction Leader or Co-leader can change scoring" }, 403);
      const cfg = sanitizeCfg(body.cfg);
      const r = await rest("scoring_config", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          faction_id: id.faction_id, cfg, updated_by: id.user_id,
          updated_at: new Date().toISOString(),
        }]),
      });
      if (!r.ok) return json({ error: `scoringcfg write failed ${r.status}` }, 502);
      return json({ ok: true, cfg });
    }

    if (body.action === "recs") {
      const r = await rest(`recommendations?faction_id=eq.${id.faction_id}&select=user_id,name,position,direction`, { method: "GET" });
      if (!r.ok) return json({ error: `recs read failed ${r.status}` }, 502);
      return json({ rows: await r.json() });
    }

    if (body.action === "pushrec") {
      if (body.rec && body.rec.name && body.rec.position) {
        const r = await rest("recommendations", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ user_id: id.user_id, faction_id: id.faction_id, name: body.rec.name, position: body.rec.position, direction: body.rec.direction || null, ts: Math.floor(Date.now() / 1000) }]),
        });
        if (!r.ok) return json({ error: `rec write failed ${r.status}` }, 502);
      }
      return json({ ok: true });
    }

    if (body.action === "push") {
      // crimes upsert — server forces faction_id from the verified key
      if (Array.isArray(body.crimes) && body.crimes.length) {
        const rows = body.crimes.slice(0, 200).map((c: any) => ({
          crime_id: c.id, faction_id: id.faction_id, name: c.name, difficulty: c.difficulty,
          status: c.status, money: c.money, respect: c.respect, scope: c.scope,
          executed_at: c.executed_at, payout_pct: c.payout_pct, participants: c.participants,
          slots: c.slots || [], // per-slot {position,user_id} — CPR is stripped client-side (privacy)
        }));
        const r = await rest("oc_crimes", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        });
        if (!r.ok) return json({ error: `crimes write failed ${r.status}` }, 502);
      }
      // cpr snapshot — server forces user_id/faction_id from the verified key
      if (body.snapshot && Array.isArray(body.snapshot.cprs)) {
        const r = await rest("cpr_snapshots", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{
            user_id: id.user_id, faction_id: id.faction_id,
            ts: body.snapshot.ts, cprs: body.snapshot.cprs,
          }]),
        });
        if (!r.ok) return json({ error: `snapshot write failed ${r.status}` }, 502);
      }
      return json({ ok: true });
    }

    if (body.action === "player_events") {
      // Per-player OC participation for the CALLER'S OWN FACTION ONLY (faction_id is
      // forced from the verified key — never client-supplied), so scores can be computed
      // from the shared backend instead of each viewer's personal faction-API permission.
      // Slots carry {position,user_id} only (CPR stripped on push), so the client can
      // compute wins/fails decay; the cpr-gated offences/good branch is skipped client-side.
      const hl = Math.min(365, Math.max(1, Number(body.half_life_days) || 30));
      const since = Math.floor(Date.now() / 1000) - Math.ceil(hl * 3 * 86400);
      const q = `oc_crimes?faction_id=eq.${id.faction_id}&executed_at=gte.${since}` +
        `&select=crime_id,name,difficulty,status,executed_at,slots` +
        `&order=executed_at.desc&limit=3000`;
      const r = await rest(q, { method: "GET" });
      if (!r.ok) return json({ error: `events read failed ${r.status}` }, 502);
      return json({ rows: await r.json() });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message) }, 500);
  }
});
