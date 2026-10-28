// Free OpenRouter models, best first. Shared by the runner (Worker) and the userscripts, so the
// list lives in one place. isFree() guards every call: a paid model can never be billed.
// Pure module: no DOM, no Node, safe to import from the Worker.
export const MODELS_FREE = [
  'thinkingmachines/inkling:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-31b-it:free',
  'cohere/north-mini-code:free',
  'openrouter/free',
];

export function isFree(id) {
  return id === 'openrouter/free' || /:free$/.test(id);
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
