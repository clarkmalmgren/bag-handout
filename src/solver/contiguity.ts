import type { Dist } from '../types';

/** Connected components of `members`, linking any two houses within `link` metres (walking distance). */
export function countComponents(members: number[], dist: Dist, link: number): number {
  const n = members.length;
  if (n === 0) return 0;
  const seen = new Array<boolean>(n).fill(false);
  let comps = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    comps++;
    seen[s] = true;
    const stack = [s];
    while (stack.length) {
      const u = stack.pop()!;
      for (let v = 0; v < n; v++) {
        if (!seen[v] && dist(members[u], members[v]) <= link) {
          seen[v] = true;
          stack.push(v);
        }
      }
    }
  }
  return comps;
}
