/**
 * 星环(步 6c):按质量判定的行星环系统(参考 https://en.wikipedia.org/wiki/Ring_system)。
 *
 * 现实里环系统几乎只出现在巨行星:土星最亮,木星/天王星/海王星是暗环;
 * 类地行星至今没有确认的环。这里按「质量 + 半径」给阈值:
 *   · 气态/冰巨(半径 ≥ 1.6 R⊕ 且质量 ≥ 8 M⊕):有环,质量越大越亮越厚
 *   · 其它质量 ≥ 40 M⊕ 的天体:给一圈很淡的尘环(满足"所有满足质量要求的星体")
 * 环的几何:内径 1.2–1.5 R、外径 2.1–2.6 R,缝隙(Cassini 式)按种子挑,
 * 倾角用行星自转倾角;颜色暖巨偏金/褐,冰巨偏青白。
 */
import { subSeed } from './util';

export interface RingSystem {
  /** 内径 / 外径(行星半径为单位) */
  innerR: number;
  outerR: number;
  /** 0–1:整体不透明度 */
  opacity: number;
  /** 环色 */
  color: [number, number, number];
  /** 环隙(宽度比例 0–1,0 = 没有) */
  gap: number;
  /** 环隙位置(在内到外的比例上) */
  gapAt: number;
  /** 倾角(度;沿行星赤道面) */
  tiltDeg: number;
  /** 环的细分数(画的时候要不要再分几层) */
  bands: { from: number; to: number; alpha: number }[];
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const unit = (seed: number, tag: string) => (subSeed(seed, `ring:${tag}`) % 1_000_000) / 1_000_000;

/** 这个天体该不该有环(按质量/半径;没有 = null) */
export function ringsOf(body: { mass: number; radius: number; kind: 'rocky' | 'gas'; tilt?: number }, seed: number): RingSystem | null {
  const m = body.mass;
  const r = body.radius;
  const giant = body.kind === 'gas' && r >= 1.6 && m >= 8;
  const heavy = m >= 40;
  if (!giant && !heavy) return null;
  // 质量越大越亮:土星级(m ≳ 90)最亮,木星/冰巨暗
  const strength = clamp(Math.log10(1 + m / 6) / 2.4, 0.12, 1);
  const warm = giant && body.kind === 'gas' && r >= 4;
  const color: [number, number, number] = warm
? [Math.round(216 + 24 * unit(seed, 'cr')), Math.round(198 + 22 * unit(seed, 'cg')), Math.round(164 + 20 * unit(seed, 'cb'))]
: [Math.round(198 + 30 * unit(seed, 'cr')), Math.round(216 + 26 * unit(seed, 'cg')), Math.round(226 + 24 * unit(seed, 'cb'))];
  const innerR = Math.round((1.2 + 0.35 * unit(seed, 'ir')) * 100) / 100;
  const outerR = Math.round((innerR + 0.9 + 0.6 * unit(seed, 'or')) * 100) / 100;
  const gap = 0.12 + 0.18 * unit(seed, 'gp');
  const gapAt = 0.45 + 0.3 * unit(seed, 'ga');
  const tiltDeg = clamp(body.tilt ?? 15, 0, 45);
  // 分几层:细环圈
const layerN = 9 + Math.floor(unit(seed, 'bn') * 7);
  const bands: { from: number; to: number; alpha: number }[] = [];
  for (let i = 0; i < layerN; i++) {
    const t0 = i / layerN;
    const t1 = (i + 1) / layerN;
const alpha = 0.28 + 0.72 * (0.35 + 0.65 * unit(seed, `ba${i}`));
    bands.push({ from: t0, to: t1, alpha });
  }
return { innerR, outerR, opacity: 0.34 + 0.62 * strength, color, gap, gapAt, tiltDeg, bands };
}
