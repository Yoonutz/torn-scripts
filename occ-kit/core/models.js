// Free OpenRouter models, best first. Shared by the runner (Worker) and the userscripts, so the
// list lives in one place. isFree() guards every call: a paid model can never be billed.
// Pure module: no DOM, no Node, safe to import from the Worker.
// Picked from the runner's answer log (GET /ailog, 28-30 Oct 2026): inkling (403, agentic apps only)
// and nemotron-3.5-super-vl (404 under the account's free-training guardrail) never answered and
// are gone; Cohere masks countries and names as [ADDRESS]/[PERSON_NAME], so it goes last.
export const MODELS_FREE = [
  'dots-studio/dots-3-note-preview:free',
  'xingchen-agi/xing4.0-29b-a4b:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'openrouter/free',
  'cohere/north-mini-code:free',
];

export function isFree(id) {
  return id === 'openrouter/free' || /:free$/.test(id);
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
