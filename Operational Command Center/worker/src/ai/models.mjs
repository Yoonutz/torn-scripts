// Model order and health, shared by every run: the last model that answered goes first, models
// that failed lately go last (10 minutes, 6 hours when refused or masking). One small KV value, written only when it changes.
// The free list and the free-only guard come from occ-kit, the same file the userscripts use.
import { MODELS_FREE, isFree } from "../../../../occ-kit/core/models.js";

export { isFree };
export const COOL_MS = 10 * 60000;
export const LONG_COOL_MS = 6 * 3600000; // refused for good (403/404) or masking names

export function modelList(env) {
  const list = env.MODELS ? String(env.MODELS).split(",") : MODELS_FREE;
  return list.map((x) => x.trim()).filter(isFree);
}

export async function health(env) {
  const h = (await env.SNAPSHOTS.get("ai:health", "json")) || {};
  const now = Date.now();
  const cool = {};
  Object.keys(h.cool || {}).forEach((m) => {
    if (h.cool[m] > now) cool[m] = h.cool[m];
  });
  return { last: h.last || "", cool };
}

export function ranked(models, h) {
  const now = Date.now();
  const ready = models.filter((m) => !(h.cool[m] > now));
  const cooling = models.filter((m) => h.cool[m] > now).sort((a, b) => h.cool[a] - h.cool[b]);
  ready.sort((a, b) => (a === h.last ? -1 : b === h.last ? 1 : 0));
  return ready.concat(cooling);
}
