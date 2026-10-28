// Who may run anything: the caller's Torn key is the only credential. Torn itself says who owns
// the key (user/basic, any access level), cached a day per key hash, and only player IDs in
// ALLOWED_PLAYERS (wrangler.toml) get through. Plus rate limits per key and per IP.
import { tornClient } from "./torn.mjs";

export function tornKey(req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^(?:ApiKey|Bearer)\s+(\S+)$/i);
  return m ? m[1] : "";
}

export async function keyHash(key) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function keyOwner(env, key, hash) {
  const cached = await env.SNAPSHOTS.get("auth:" + hash);
  if (cached) return cached;
  const body = await tornClient(key)("user/basic");
  const id = body && body.profile && body.profile.id ? String(body.profile.id) : "";
  if (id) await env.SNAPSHOTS.put("auth:" + hash, id, { expirationTtl: 86400 });
  return id;
}

export function allowed(env, id) {
  return String(env.ALLOWED_PLAYERS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .includes(id);
}

// Returns { key, hash, owner } for an allowed caller, or { status, error } to send back.
// Torn errors from the owner lookup are thrown for the router to map. limiter: the per-key rate
// limit binding to use (the data route gets its own, roomier one: a few taps = a few writes).
export async function gate(req, env, limiter) {
  const key = tornKey(req);
  if (!key) return { status: 401, error: "No Torn API key sent" };
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const hash = await keyHash(key);
  const lim = limiter || env.RUN_PER_KEY;
  const perKey = lim ? await lim.limit({ key: hash }) : { success: true };
  const perIp = env.RUN_PER_IP && ip ? await env.RUN_PER_IP.limit({ key: ip }) : { success: true };
  if (!perKey.success || !perIp.success) return { status: 429, error: "Too many runs, wait a minute" };
  const owner = await keyOwner(env, key, hash);
  if (!allowed(env, owner)) return { status: 403, error: "This Command Center is private" };
  return { key, hash, owner };
}
