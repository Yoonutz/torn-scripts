// Every plug-in AI answer (/write) the runner writes, kept for later review: what was asked (system rules and the
// numbers sent), the model's raw reply, which model, failed tries and timing. One KV entry per
// answer under the key owner's player ID, kept 30 days; read back with GET /ailog. /ask is not
// logged: its prompt is a skill report of live personal data, which the runner never keeps.
// Keys sort by time: ailog:<owner>:<13-digit ms>-<4 hex>.
const TTL = 30 * 86400;
const REPLY_MAX = 20000;
export const LOG_MAX = 500; // entries one /ailog read returns at most

const prefix = (owner) => "ailog:" + owner + ":";

// Never lets a failed log write break the answer it logs.
export async function logAi(env, owner, entry) {
  try {
    const at = Date.now();
    const id = String(at).padStart(13, "0") + "-" + Math.random().toString(16).slice(2, 6);
    const doc = { at: new Date(at).toISOString(), ...entry, reply: String(entry.reply || "").slice(0, REPLY_MAX) };
    await env.SNAPSHOTS.put(prefix(owner) + id, JSON.stringify(doc), { expirationTtl: TTL });
  } catch (e) {
    console.error("ailog write failed: " + ((e && e.message) || e));
  }
}

// Newest first, at most `limit`, only entries at or after `since` (ms) when given.
export async function readAiLog(env, owner, { limit = 100, since = 0 } = {}) {
  const names = [];
  let cursor;
  do {
    const page = await env.SNAPSHOTS.list({ prefix: prefix(owner), cursor });
    page.keys.forEach((k) => names.push(k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const keep = names
    .filter((n) => Number(n.slice(prefix(owner).length, prefix(owner).length + 13)) >= since)
    .sort()
    .reverse()
    .slice(0, Math.min(Math.max(1, limit), LOG_MAX));
  const entries = (await Promise.all(keep.map((n) => env.SNAPSHOTS.get(n, "json")))).filter(Boolean);
  return { total: names.length, entries };
}
