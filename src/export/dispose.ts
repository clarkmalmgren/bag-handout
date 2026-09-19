/** Remove every item and empty the set, even if some removals throw (one bad map must not strand the rest). */
export function disposeAll(items: Set<{ remove(): unknown }>): void {
  const all = [...items];
  items.clear();
  for (const it of all) {
    try {
      it.remove();
    } catch (e) {
      console.warn('print map dispose failed', e);
    }
  }
}
