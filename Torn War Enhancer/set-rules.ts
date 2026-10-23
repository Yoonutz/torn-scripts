// supabase/functions/set-rules/index.ts
// ============================================================
// Admin-only: update the 3 war rules in `config`.
// Auth: caller must send header  x-admin-token: <ADMIN_TOKEN secret>
// (The anon JWT in Authorization only satisfies the gateway; the real
//  gate is the admin token, which is NEVER shipped in the userscript.)
// Env: ADMIN_TOKEN (secret), SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto)
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// CORS so the standalone HTML dashboard (opened from file:// or any host) can call this.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-admin-token, content-type, apikey",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

function intIn(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
    const token = req.headers.get("x-admin-token") ?? "";
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const total = intIn(body.total_score_target, 0, 100_000_000);   // 0 = no limit
    const perm  = intIn(body.per_member_score_target, 0, 100_000_000);
    const hits  = intIn(body.max_attacks_per_member, 0, 100_000);
    const idle  = intIn(body.idle_minutes_target, 0, 1440);         // 0 = no activity restriction
    if (total === null || perm === null || hits === null || idle === null)
      return json({ ok: false, error: "invalid values (non-negative integers required)" }, 400);

    const { error } = await db.from("config").update({
      total_score_target: total,
      per_member_score_target: perm,
      max_attacks_per_member: hits,
      idle_minutes_target: idle,
    }).eq("id", 1);
    if (error) throw error;

    return json({ ok: true, total_score_target: total, per_member_score_target: perm, max_attacks_per_member: hits, idle_minutes_target: idle });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});