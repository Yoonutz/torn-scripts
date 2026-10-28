// Key usage for the OCC Keys tab, kept per UTC day (OpenRouter's free quota resets at 00:00 UTC).
//   usage:ai:<day>  the runner's own model calls: { ok, rl, fail, models: { id: [ok, rl, fail] } }
//   usage:or:<day>  OpenRouter's own count for the account: { used, limit, spent, at }
// One KV write per answer and one per hourly snapshot, kept 40 days.
const TTL = 40 * 86400;
const OR_KEY_URL = "https://openrouter.ai/api/v1/key";
export const DAYS = 14;

export const day = (ts) => new Date(ts).toISOString().slice(0, 10);

// tries: [[model, "ok" | "rl" | "fail"], ...] from one answer() run, in try order.
export async function record(env, tries) {
  if (!tries.length) return;
  const k = "usage:ai:" + day(Date.now());
  const d = (await env.SNAPSHOTS.get(k, "json")) || { ok: 0, rl: 0, fail: 0, models: {} };
  const col = { ok: 0, rl: 1, fail: 2 };
  tries.forEach(([model, how]) => {
    d[how] = (d[how] || 0) + 1;
    const m = d.models[model] || (d.models[model] = [0, 0, 0]);
    m[col[how]]++;
  });
  await env.SNAPSHOTS.put(k, JSON.stringify(d), { expirationTtl: TTL });
}

// OpenRouter's count of today's free requests for the account behind this key. Null when unknown.
export async function orSnapshot(env, key) {
  if (!key) return null;
  try {
    const res = await fetch(OR_KEY_URL, { headers: { Authorization: "Bearer " + key }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const d = ((await res.json().catch(() => ({}))) || {}).data || {};
    const f = d.free_model_daily_requests || {};
    const snap = {
      used: typeof f.used === "number" ? f.used : null,
      limit: typeof f.limit === "number" ? f.limit : null,
      spent: typeof d.usage === "number" ? d.usage : null,
      at: Date.now(),
    };
    await env.SNAPSHOTS.put("usage:or:" + day(snap.at), JSON.stringify(snap), { expirationTtl: TTL });
    return snap;
  } catch (e) {
    return null;
  }
}

// Last DAYS days, oldest first, plus a live OpenRouter read.
export async function usage(env, orKey) {
  const now = Date.now();
  const live = await orSnapshot(env, env.OPENROUTER_KEY || orKey);
  const days = await Promise.all(
    Array.from({ length: DAYS }, (_, i) => day(now - (DAYS - 1 - i) * 86400000)).map(async (d) => ({
      day: d,
      ai: await env.SNAPSHOTS.get("usage:ai:" + d, "json"),
      or: await env.SNAPSHOTS.get("usage:or:" + d, "json"),
    }))
  );
  return { days, live, at: now };
}
