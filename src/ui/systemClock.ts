/**
 * 时间轴(本地轨道时钟)的纯函数。
 *
 * 基准速度按用户定的口径:**1× = 主行星公转周期 T 的 1/8 每秒**(T 以年计)。
 * 所以同样是 1×,内圈行星(周期短)一年走得快、外圈行星走得慢,但"一年转一圈"的观感一致。
 * 只驱动天体位置这一个观测量:不写文明状态、不动国界、不进存档。
 */

export type SystemView = 'system' | 'chart' | 'surface';

export function clampSystemYear(year: number, endYear: number): number {
  const end = Math.max(0, Number.isFinite(endYear) ? endYear : 0);
  return Math.min(end, Math.max(0, Number.isFinite(year) ? year : 0));
}

/** 主行星的 1× 速度(年/秒):1/8 个公转周期每秒 */
export function yearsPerSecondOf(orbitYears: number): number {
  const T = Number.isFinite(orbitYears) && orbitYears > 0 ? orbitYears : 1;
  return T / 8;
}

/**
 * 推进一步。
 * @param yearsPerSec 1× 时每秒过多少年(默认 1);世界页 / Studio 各按自己主行星的 T 算
 * @param speed 倍速档(0.5 / 1 / 2 / 4 / 8)
 */
export function timelineStep(year: number, dtSeconds: number, speed: number, endYear: number, yearsPerSec = 1): number {
  const dy = Math.max(0, dtSeconds) * Math.max(0.01, yearsPerSec) * Math.max(0, speed);
  return clampSystemYear(year + dy, endYear);
}
