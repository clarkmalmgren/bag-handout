export interface GroupStat {
  group: number;
  houses: number;
  length: number;
  minutes: number;
  delta: number;
}

export function groupStats(
  sizes: number[],
  lengths: number[],
  cfg: { walkSpeed: number; secPerHouse: number },
): GroupStat[] {
  const mean = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  return sizes.map((houses, group) => {
    const length = lengths[group] ?? 0;
    return {
      group,
      houses,
      length,
      minutes: (length / cfg.walkSpeed + houses * cfg.secPerHouse) / 60,
      delta: houses - mean,
    };
  });
}
