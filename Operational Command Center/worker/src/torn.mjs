// Torn API v2 with the caller's key. The key is used for the calls and never stored.
const TORN = "https://api.torn.com/v2/";

export class TornError extends Error {
  constructor(path, code, msg) {
    super(path + " -> " + code + " " + msg);
    this.code = code;
  }
}

export function tornClient(key) {
  return async (path) => {
    const res = await fetch(TORN + path, { headers: { Authorization: "ApiKey " + key } });
    const body = await res.json().catch(() => ({}));
    if (body.error) throw new TornError(path, body.error.code, body.error.error);
    if (!res.ok) throw new TornError(path, 0, "HTTP " + res.status);
    return body;
  };
}
