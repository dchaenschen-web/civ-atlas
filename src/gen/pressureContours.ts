/**
 * 以「该行星标准气压」为基准的等高线(纯函数,可 Node 测)。
 *
 * 物理:等压面高度 z(p) = H · ln(p₀ / p),标高 H = R·T / (M̄·g)
 *   R = 8.314 J/(mol·K)、T = 地表均温、M̄ = 大气平均摩尔质量、g = 该行星表面重力。
 * 于是「气压每 ±10% 一条」在每颗行星上是不同的米数(地球约 0.8 km、火星约 1 km 出头),
 * 这正是"以标准气压为基准"的意思:同一条线在两颗行星上表示同样的气压比。
 */
import { GAS_MOLAR, type GasId, type Atmosphere } from './astroDesign';

/** 气体常数 J/(mol·K) */
export const R_GAS = 8.314;

/** 大气平均摩尔质量(kg/mol):按各气体占比加权;没有成分 = 地球空气(0.029) */
export function meanMolarKg(air: Pick<Atmosphere, 'gases'> | null | undefined): number {
  const gases = air?.gases ?? [];
  let sum = 0;
  let frac = 0;
  for (const g of gases) {
    if (!(g.frac > 0)) continue;
    const molar = GAS_MOLAR[g.id as GasId];
    if (molar === undefined) continue;
    sum += molar * g.frac;
    frac += g.frac;
  }
  // 缺项按氮气补齐;成分表为空就当地球空气
  if (!(frac > 0)) return 0.029;
  return Math.max(0.002, (sum + (1 - Math.min(1, frac)) * 28) / 1000);
}

/** 气压标高 H(米) */
export function scaleHeightM(tempK: number, molarKg: number, gravity: number): number {
  return (R_GAS * Math.max(1, tempK)) / (Math.max(0.002, molarKg) * Math.max(0.05, gravity));
}

/** 气压比 p/p₀ → 高度(米;水下为负) */
export function heightAtPressureRatio(ratio: number, H: number): number {
  return H * Math.log(1 / Math.max(1e-6, ratio));
}

/**
 * 等高线的高度档(米)。默认气压每 ±10% 一条,并带上「标准气压」那条(z=0)。
 * 只取该行星地形能覆盖到的范围(|z| ≤ maxElevM 或 maxDepthM),免得画一堆不存在的线。
 */
export function pressureContourLevelsM(opts: { p0Atm: number; tempK: number; molarKg: number; gravity: number; maxElevM?: number; maxDepthM?: number; step?: number }): number[] {
  const H = scaleHeightM(opts.tempK, opts.molarKg, opts.gravity);
  const step = Math.max(0.01, opts.step ?? 0.1);
  const maxUp = Math.max(50, opts.maxElevM ?? 9000);
  const maxDown = Math.max(0, opts.maxDepthM ?? 6000);
  const out: number[] = [0];
  for (let k = 1; k <= 64; k++) {
    const up = heightAtPressureRatio(1 - k * step, H);
    if (!Number.isFinite(up) || up > maxUp) break;
    out.push(Math.round(up));
  }
  for (let k = 1; k <= 64; k++) {
    const down = heightAtPressureRatio(1 + k * step, H);
    if (!Number.isFinite(down) || -down > maxDown) break;
    out.push(Math.round(down));
  }
  return out.sort((a, b) => a - b);
}

/** 相邻两条等高线在这个行星上大约差多少米(角标文案用) */
export function contourSpacingM(tempK: number, molarKg: number, gravity: number, step = 0.1): number {
  const H = scaleHeightM(tempK, molarKg, gravity);
  return Math.round(H * Math.log(1 / (1 - step)));
}
