/**
 * 恒星:简化赫罗图(只做主序带)。
 *
 * 数据取自维基「哈佛光谱分类」那张表(O–M 各档的有效温度 / 主序质量 / 主序半径 / 主序光度端点),
 * 做法只有三条简化:
 *   1. 不画图:二维赫罗压成"一条主序带",档内用子型 0–9 在对数空间插值;
 *   2. 太阳做硬锚点:G2V ≡ (1.00 M☉, 1.000 L☉, 5772 K, 1.00 R☉),默认世界的恒星数值一位不变;
 *   3. 半径一律由 L=4πR²σT⁴ 反推:R = √L / (T/5772)²,保证 L / T / R 三者自洽。
 *
 * 巨星、白矮星、中子星、黑洞都只登记类型、不实现生成(见 LUM_CLASSES / REMNANTS 与未开放档位),
 * 留给以后的恒星演化 / 科技树那一轮。
 */

export type SpectralClass = 'M' | 'K' | 'G' | 'F' | 'A' | 'B' | 'O';
/** 光度级:现在只做主序 V;其余只登记 */
export type LumClass = 'V';
export const LUM_CLASSES = ['V', 'IV', 'III', 'II', 'Ib', 'Ia', 'D'] as const;
/** 恒星残骸(只登记,不生成) */
export const REMNANTS = ['whiteDwarf', 'neutronStar', 'blackHole'] as const;
export type Remnant = (typeof REMNANTS)[number];

export const SPECTRAL_CLASSES: readonly SpectralClass[] = ['M', 'K', 'G', 'F', 'A', 'B', 'O'];

/** 主序带锚点:子型 0 = 本档最热,9 = 最冷。数值取维基表的端点,G2 用太阳锚定 */
export interface BandPoint {
  cls: SpectralClass;
  sub: number;
  /** 主序质量 M☉ */
  m: number;
  /** 主序光度 L☉ */
  l: number;
  /** 有效温度 K */
  t: number;
}
export const BAND_POINTS: readonly BandPoint[] = [
  { cls: 'M', sub: 0, m: 0.45, l: 0.08, t: 3700 },
  { cls: 'M', sub: 9, m: 0.08, l: 0.0008, t: 2400 },
  { cls: 'K', sub: 0, m: 0.8, l: 0.6, t: 5200 },
  { cls: 'K', sub: 9, m: 0.45, l: 0.08, t: 3700 },
  { cls: 'G', sub: 0, m: 1.04, l: 1.5, t: 6000 },
  { cls: 'G', sub: 2, m: 1.0, l: 1.0, t: 5772 },
  { cls: 'G', sub: 9, m: 0.8, l: 0.6, t: 5200 },
  { cls: 'F', sub: 0, m: 1.4, l: 5.0, t: 7500 },
  { cls: 'F', sub: 9, m: 1.04, l: 1.5, t: 6000 },
  { cls: 'A', sub: 0, m: 2.1, l: 25, t: 10000 },
  { cls: 'A', sub: 9, m: 1.4, l: 5, t: 7500 },
  { cls: 'B', sub: 0, m: 16, l: 30000, t: 30000 },
  { cls: 'B', sub: 9, m: 2.1, l: 25, t: 10000 },
  { cls: 'O', sub: 0, m: 60, l: 1_000_000, t: 50000 },
  { cls: 'O', sub: 9, m: 16, l: 30000, t: 30000 },
];

/** 主序质量的可给范围(超出只作提示,不再按幂律爆掉) */
export const MS_MASS_RANGE: readonly [number, number] = [0.08, 60];
/** 默认使用的主序范围(0.08–16 M☉;16 以上算"极蓝、不稳定") */
export const MS_MASS_SAFE: readonly [number, number] = [0.08, 16];

const SUN_T = 5772;

/** 由光度与温度反推半径(R☉);L=4πR²σT⁴ */
export function radiusOf(lum: number, temp: number): number {
  const q = temp / SUN_T;
  return Math.sqrt(Math.max(1e-9, lum)) / Math.max(1e-6, q * q);
}

/** 温度 → 屏幕色(按黑体近似分档;和原来 starFromMass 的分段一致) */
export function colorOfTemp(temp: number): [number, number, number] {
  return temp < 3500
    ? [255, 165, 120]
    : temp < 4500
      ? [255, 195, 140]
      : temp < 5600
        ? [255, 228, 185]
        : temp < 6500
          ? [255, 246, 224]
          : temp < 8000
            ? [240, 244, 255]
            : temp < 12000
              ? [206, 219, 255]
              : [172, 196, 255];
}

/** 光谱型 → 短 id(给 StarType.id 用) */
export function starIdOf(cls: SpectralClass): 'm' | 'k' | 'g' | 'f' | 'a' | 'b' | 'o' {
  return ({ M: 'm', K: 'k', G: 'g', F: 'f', A: 'a', B: 'b', O: 'o' } as const)[cls];
}

/** 光谱型 → 中文名(界面标签) */
export function starLabelOf(cls: SpectralClass): string {
  return ({ M: '红矮星', K: '橙矮星', G: '黄矮星', F: '白黄矮星', A: '白色星', B: '蓝白星', O: '蓝色巨星' } as const)[cls];
}

export interface StarAt {
  cls: SpectralClass;
  /** 子型 0–9(0 最热) */
  sub: number;
  lumClass: LumClass;
  /** M☉ */
  mass: number;
  /** L☉ */
  lum: number;
  /** 有效温度 K */
  temp: number;
  /** R☉ */
  radius: number;
  color: [number, number, number];
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** 对数插值(跨量级时更接近真实分布) */
const logLerp = (a: number, b: number, f: number) => Math.exp(lerp(Math.log(Math.max(1e-12, a)), Math.log(Math.max(1e-12, b)), f));

/** 某一档的锚点(按子型升序) */
function anchorsOf(cls: SpectralClass): BandPoint[] {
  return BAND_POINTS.filter((p) => p.cls === cls).slice().sort((a, b) => a.sub - b.sub);
}

/**
 * 光谱型 + 子型 → 恒星参数。子型 0 最热、9 最冷;档内两端锚点之间做对数插值。
 * 走到 G/2 时直接返回太阳那一点(硬锚点,默认世界不能变)。
 */
export function starAt(cls: SpectralClass, sub: number, lumClass: LumClass = 'V'): StarAt {
  const s = Math.round(Math.min(9, Math.max(0, Number.isFinite(sub) ? sub : 5)));
  const pts = anchorsOf(cls);
  let m = 1;
  let l = 1;
  let t = SUN_T;
  if (pts.length === 1) {
    m = pts[0].m;
    l = pts[0].l;
    t = pts[0].t;
  } else {
    let i = 0;
    while (i + 2 < pts.length && pts[i + 1].sub <= s) i++;
    const a = pts[i];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const span = Math.max(1e-9, b.sub - a.sub);
    const f = Math.min(1, Math.max(0, (s - a.sub) / span));
    m = logLerp(a.m, b.m, f);
    l = logLerp(a.l, b.l, f);
    t = lerp(a.t, b.t, f);
  }
  // 太阳硬锚点:默认世界(按种子挑到 G 型)一个数都不能动
  if (cls === 'G' && s === 2) {
    m = 1;
    l = 1;
    t = SUN_T;
  }
  return { cls, sub: s, lumClass, mass: m, lum: l, temp: Math.round(t), radius: radiusOf(l, t), color: colorOfTemp(t) };
}

/** 主序带上的所有采样点(按质量从大到小排好,给"按质量反查"用) */
const MS_SAMPLES: { cls: SpectralClass; sub: number }[] = (() => {
  const out: { cls: SpectralClass; sub: number; m: number }[] = [];
  for (const cls of SPECTRAL_CLASSES) for (let sub = 0; sub <= 9; sub++) out.push({ cls, sub, m: starAt(cls, sub).mass });
  return out.sort((a, b) => b.m - a.m).map(({ cls, sub }) => ({ cls, sub }));
})();

/**
 * 质量 → 主序上的位置(光谱型 + 子型)与那一档的 L/T/R。
 * 只有主序:给出范围外的质量不按 M^3.5 外推,而是夹到端点并标 offMainSequence。
 */
export function starFromMassHR(mass: number): StarAt & { offMainSequence: boolean } {
  const m0 = Number.isFinite(mass) ? mass : 1;
  const off = m0 > MS_MASS_SAFE[1] || m0 < MS_MASS_SAFE[0];
  const m = Math.min(MS_MASS_RANGE[1], Math.max(MS_MASS_RANGE[0], m0));
  // 在采样表里找夹住 m 的两档
  let lo = 0;
  let hi = MS_SAMPLES.length - 1;
  const massAt = (i: number) => starAt(MS_SAMPLES[i].cls, MS_SAMPLES[i].sub).mass;
  if (m >= massAt(0)) return { ...starAt(MS_SAMPLES[0].cls, MS_SAMPLES[0].sub), offMainSequence: off };
  if (m <= massAt(MS_SAMPLES.length - 1)) {
    const last = MS_SAMPLES[MS_SAMPLES.length - 1];
    return { ...starAt(last.cls, last.sub), offMainSequence: off };
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (massAt(mid) >= m) lo = mid;
    else hi = mid;
  }
  const a = MS_SAMPLES[lo];
  const b = MS_SAMPLES[hi];
  const ma = massAt(lo);
  const mb = massAt(hi);
  const f = Math.min(1, Math.max(0, (Math.log(ma) - Math.log(m)) / Math.max(1e-9, Math.log(ma) - Math.log(mb))));
  const sa = starAt(a.cls, a.sub);
  const sb = starAt(b.cls, b.sub);
  const l = logLerp(sa.lum, sb.lum, f);
  const t = lerp(sa.temp, sb.temp, f);
  return {
    cls: f < 0.5 ? a.cls : b.cls,
    sub: Math.round(lerp(a.sub, b.sub, f)),
    lumClass: 'V',
    mass: m,
    lum: l,
    temp: Math.round(t),
    radius: radiusOf(l, t),
    color: colorOfTemp(t),
    offMainSequence: off,
  };
}

/** 温度 → 光谱型/子型(伴星、旧存档反查用) */
export function spectralOf(tempK: number): { cls: SpectralClass; sub: number } {
  const t = Number.isFinite(tempK) ? tempK : SUN_T;
  let best: { cls: SpectralClass; sub: number; d: number } = { cls: 'G', sub: 2, d: Infinity };
  for (const cls of SPECTRAL_CLASSES) {
    for (let sub = 0; sub <= 9; sub++) {
      const d = Math.abs(starAt(cls, sub).temp - t);
      if (d < best.d) best = { cls, sub, d };
    }
  }
  return { cls: best.cls, sub: best.sub };
}

/** 宜居带(AU):内 0.95√L、外 1.37√L(地球 L=1 → 0.95–1.37) */
export function habitableZone(lum: number): { innerAU: number; outerAU: number } {
  const s = Math.sqrt(Math.max(1e-9, lum));
  return { innerAU: 0.95 * s, outerAU: 1.37 * s };
}

/** 太阳(G2V)基准值,给默认世界/断言用 */
export const SUN: StarAt = starAt('G', 2);

/** 未实现档位的统一报错(巨星 / 残骸留给以后) */
export function unimplementedLumClass(lc: string): never {
  throw new Error(`${lc} 档位未实现:现在只有主序 V(巨星 / 白矮星 / 中子星 / 黑洞见 LUM_CLASSES、REMNANTS)`);
}
