// Update only unchanged built-in copy; preserve merchant-edited content and product data.
export function migrateContent(current: unknown, previous: unknown, next: unknown): unknown {
  if (typeof previous === 'string') return current === previous ? next : current;
  if (Array.isArray(current) && Array.isArray(previous) && Array.isArray(next)) {
    const key = (value: unknown) => value && typeof value === 'object'
      ? ('id' in value ? value.id : 'question' in value ? value.question : undefined) : undefined;
    return current.map((item, index) => {
      const identity = key(item);
      const oldItem = identity ? previous.find(value => key(value) === identity) : previous[index];
      const newItem = identity ? next.find(value => key(value) === identity) : next[index];
      return migrateContent(item, oldItem, newItem);
    });
  }
  if (current && previous && next && typeof current === 'object' && typeof previous === 'object' && typeof next === 'object') {
    const result = { ...current } as Record<string, unknown>;
    for (const name of Object.keys(result)) {
      result[name] = migrateContent(result[name], (previous as Record<string, unknown>)[name], (next as Record<string, unknown>)[name]);
    }
    return result;
  }
  return current;
}
