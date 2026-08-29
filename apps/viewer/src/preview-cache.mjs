/** Owns verified file snapshots only, never mutable review state or decisions. */
export function createPreviewCache({
  maxBytes = 64 * 1024 * 1024,
  maxEntries = 100,
} = {}) {
  const entries = new Map();
  let bytes = 0;
  const remove = (key) => {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.size;
    entries.delete(key);
  };
  return {
    get(key) {
      return entries.get(key)?.snapshot;
    },
    set(key, { revision, files }) {
      const size = [...files.values()].reduce(
        (sum, file) => sum + file.length,
        0,
      );
      if (size > maxBytes || maxEntries < 1)
        throw new Error("Preview exceeds cache limit");
      remove(key);
      while (entries.size >= maxEntries || bytes + size > maxBytes)
        remove(entries.keys().next().value);
      entries.set(key, { size, snapshot: { revision, files } });
      bytes += size;
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
  };
}
