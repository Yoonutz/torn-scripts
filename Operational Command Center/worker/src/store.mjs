// KV scoped to one skill and one key hash: skills never see each other's data or another player's.
export function store(env, prefix) {
  const k = (name) => prefix + ":" + name;
  return {
    async index() {
      return (await env.SNAPSHOTS.get(k("index"), "json")) || [];
    },
    async get(name) {
      return env.SNAPSHOTS.get(k(name), "json");
    },
    async put(name, value) {
      await env.SNAPSHOTS.put(k(name), JSON.stringify(value));
      const idx = await this.index();
      if (!idx.includes(name)) {
        idx.push(name);
        idx.sort();
        await env.SNAPSHOTS.put(k("index"), JSON.stringify(idx));
      }
    },
  };
}
