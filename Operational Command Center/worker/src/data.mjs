// Small private documents a plug-in keeps for its owner (the Trains tab's paid-trains ledger), so
// every device of that player sees the same data. One KV entry per player and name, written whole.
// Writes carry the revision they were based on: a stale one is refused with the current document,
// so a phone and a PC never overwrite each other's change.
export const DATA_MAX = 256 * 1024;
const NAME = /^[a-z0-9_-]{1,32}$/;

export function validName(name) {
  return NAME.test(String(name || ""));
}

const kvKey = (owner, name) => "data:" + owner + ":" + name;

export async function readData(env, owner, name) {
  const doc = await env.SNAPSHOTS.get(kvKey(owner, name), "json");
  return doc && typeof doc.rev === "number" ? doc : { rev: 0, value: null, at: 0 };
}

// body: { rev, value }. Returns [status, json].
export async function writeData(env, owner, name, body) {
  if (!body || typeof body.rev !== "number" || body.value === undefined) return [400, { error: "Send { rev, value }" }];
  const text = JSON.stringify(body.value);
  if (text.length > DATA_MAX) return [413, { error: "Too big: keep it under " + DATA_MAX + " bytes" }];
  const cur = await readData(env, owner, name);
  if (body.rev !== cur.rev) return [409, { error: "Changed on another device", ...cur }];
  const doc = { rev: cur.rev + 1, value: body.value, at: Date.now() };
  await env.SNAPSHOTS.put(kvKey(owner, name), JSON.stringify(doc));
  return [200, doc];
}
