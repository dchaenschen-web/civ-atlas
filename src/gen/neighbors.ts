/**
 * 邻近恒星（100 光年内）：距离、光谱型、质量、相对本星系的 3D 位置。
 *
 * 只做「星图 / 数据展示 / 以后恒星际航行的接口」，不参与主世界生成。
 * 全部按种子确定性派生：同一个世界同一个种子 → 同一张星图。
 */
import { subSeed } from './util';

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

/** 星图只收录这个距离内的恒星；更远的只当背景星 */
export const NEIGHBOR_MAX_LY = 100;
/** 每个世界生成多少颗邻近恒星 */
export const NEIGHBOR_COUNT = 42;

export interface NearbyStar {
  /** 稳定 id（以后殖民/航行引用） */
  id: string;
  /** 显示名（占位；以后可改名） */
  name: string;
  /** 距离（光年，3–100） */
  distanceLy: number;
  /** 单位方向向量（相对本星系，右手系，本星系在原点） */
  dir: [number, number, number];
  /** 光年坐标 = dir × distanceLy */
  xyz: [number, number, number];
  spectral: SpectralClass;
  /** 质量 M☉ */
  mass: number;
  /** 有效温度 K */
  tempK: number;
  /** 光度（相对太阳） */
  lum: number;
  /** 画星图用的颜色 */
  color: [number, number, number];
  /** 年龄（十亿年） */
  ageGyr: number;
}

interface ClassDef {
  c: SpectralClass;
  /** 抽中权重 */
  w: number;
  mass: [number, number];
  temp: [number, number];
  color: [number, number, number];
}

const CLASSES: ClassDef[] = [
  { c: 'M', w: 60, mass: [0.1, 0.55], temp: [3000, 3900], color: [255, 155, 107] },
  { c: 'K', w: 20, mass: [0.55, 0.9], temp: [3900, 5300], color: [255, 196, 138] },
  { c: 'G', w: 10, mass: [0.9, 1.2], temp: [5300, 6000], color: [255, 242, 201] },
  { c: 'F', w: 6, mass: [1.2, 2.0], temp: [6000, 7500], color: [245, 247, 255] },
  { c: 'A', w: 3, mass: [2.0, 4.0], temp: [7500, 10000], color: [223, 232, 255] },
  { c: 'B', w: 0.9, mass: [5.0, 20], temp: [10000, 30000], color: [188, 210, 255] },
  { c: 'O', w: 0.1, mass: [20, 40], temp: [30000, 50000], color: [159, 188, 255] },
];
const TOTAL_W = CLASSES.reduce((n, c) => n + c.w, 0);

const u = (seed: number, tag: string) => (subSeed(seed, 'neighbors:' + tag) % 1_000_000) / 1_000_000;
const between = (a: number, b: number, t: number) => a + (b - a) * t;

/** 按种子生成 100 光年内的邻近恒星（确定性） */
export function nearbyStarsOf(seed: number): NearbyStar[] {
  const out: NearbyStar[] = [];
  for (let i = 0; i < NEIGHBOR_COUNT; i++) {
    // 体积均匀：d = 100 · ∛u（去掉 3 ly 以内的本星系空间）
    const distanceLy = 3 + (NEIGHBOR_MAX_LY - 3) * Math.cbrt(u(seed, `${i}:dist`));
    const z = 2 * u(seed, `${i}:z`) - 1;
    const phi = 2 * Math.PI * u(seed, `${i}:phi`);
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    const dir: [number, number, number] = [s * Math.cos(phi), s * Math.sin(phi), z];

    // 光谱型按权重抽
    let pick = u(seed, `${i}:class`) * TOTAL_W;
    let def = CLASSES[CLASSES.length - 1];
    for (const c of CLASSES) {
      pick -= c.w;
      if (pick <= 0) {
        def = c;
        break;
      }
    }
    const mass = between(def.mass[0], def.mass[1], u(seed, `${i}:mass`));
    const tempK = between(def.temp[0], def.temp[1], u(seed, `${i}:temp`));
    out.push({
      id: 'nb-' + String(i + 1).padStart(2, '0'),
      name: '邻星 ' + String(i + 1).padStart(2, '0'),
      distanceLy,
      dir,
      xyz: [dir[0] * distanceLy, dir[1] * distanceLy, dir[2] * distanceLy],
      spectral: def.c,
      mass: Math.round(mass * 1000) / 1000,
      tempK: Math.round(tempK),
      lum: Math.round(Math.pow(mass, 3.5) * 1_000_000) / 1_000_000,
      color: def.color,
      ageGyr: Math.round(between(0.3, 12, u(seed, `${i}:age`)) * 100) / 100,
    });
  }
  return out;
}

/** 距离本星系多少光年内（升序） */
export function nearbyWithin(seed: number, maxLy: number): NearbyStar[] {
  return nearbyStarsOf(seed)
    .filter((s) => s.distanceLy <= maxLy)
    .sort((a, b) => a.distanceLy - b.distanceLy);
}
