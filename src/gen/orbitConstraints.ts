/**
 * 行星轨道相对双星的稳定性(纯函数)。
 *   P 型(环双星):a > 2.5 × AB 间距;
 *   S 型(绕单星):a < 0.3 × AB 间距;
 *   介于两者之间 = 不稳定。
 * 三合星的 C 在数百到上万 AU 外,对行星轨道视为几乎不动,按 AB 间距判定即可。
 */
export type OrbitZone = 'P' | 'S' | 'unstable';

export function orbitZoneOf(aAU: number, abSepAU: number): OrbitZone {
  const a = Math.max(1e-6, aAU);
  const sep = Math.max(1e-6, abSepAU);
  if (a > 2.5 * sep) return 'P';
  if (a < 0.3 * sep) return 'S';
  return 'unstable';
}

/** 这组行星在 AB 间距下是否都落在稳定区 */
export function planetsStable(planetAs: readonly number[], abSepAU: number): boolean {
  return planetAs.every((a) => orbitZoneOf(a, abSepAU) !== 'unstable');
}

/** 给一组行星挑一个让它们都稳定的 AB 间距(保留种子值,不够就抬到 S 型下限) */
export function abSepForPlanets(planetAs: readonly number[], seededSepAU: number): number {
  const maxA = planetAs.length ? Math.max(...planetAs) : 0;
  const needS = maxA > 0 ? (maxA / 0.3) * 1.05 : 0;
  return Math.max(seededSepAU, needS);
}


/**
 * 把「想要的双星间距」夹到行星轨道允许的稳定区:
 *   P 型上限 = 最近行星 a / 2.5;S 型下限 = 最远行星 a / 0.3 × 1.05;
 * 想要的值落在中间(不稳定带)时,取离它更近的那一端。
 */
export function stableSepFor(planetAs: readonly number[], wantAU: number): number {
  const want = Math.max(0.005, wantAU);
  const as = planetAs.filter((a) => Number.isFinite(a) && a > 0);
  if (!as.length) return want;
  const pMax = (Math.min(...as) / 2.5) * 0.98;
  const sMin = (Math.max(...as) / 0.3) * 1.05;
  if (want <= pMax || want >= sMin) return want;
  return want - pMax <= sMin - want ? pMax : sMin;
}