// Resolves repo paths and loads TORN_API_KEY_FULL from the repo-root .env.local when not already set.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = resolve(here, "..");
export const REPO_ROOT = resolve(SKILL_DIR, "..", "..", "..");
export const DATA_DIR = resolve(SKILL_DIR, "data");
export const SNAPSHOT_DIR = resolve(DATA_DIR, "snapshots");
export const REPORT_DIR = resolve(DATA_DIR, "reports");

export function loadEnv() {
  if (process.env.TORN_API_KEY_FULL) return;
  const file = resolve(REPO_ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function requireKey() {
  loadEnv();
  const key = process.env.TORN_API_KEY_FULL;
  if (!key) {
    console.error("TORN_API_KEY_FULL is not set (expected in repo-root .env.local).");
    process.exit(1);
  }
  return key;
}
