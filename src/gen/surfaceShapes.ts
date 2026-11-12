/**
 * 独立的地形塑形(步 6b):坑场 / 冰盖 / 裂谷。
 *
 * 与「地貌配方」不同,这三样是真的改地形:在海拔场上砸坑、堆冰盖、切裂谷。
 * 纯函数 + 确定性(种子决定位置/大小),只吃 Mesh 与海拔数组,不碰 World/climate,
 * 所以能在世界生成的「侵蚀之后、湖泊与水系之前」插进去,让后续水/湖/河/气候自然响应。
 */
import type { Mesh } from './mesh';
import { keyed, subSeed } from './util';
import { geometryOf } from './geometry';

/** 把 t 夹到 [lo,hi] */
const clamp = (t: number, lo: number, hi: number) => (t < lo ? lo : t > hi ? hi : t);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / Math.max(1e-9, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * 抹平大起伏:每个地块朝它周围一圈的平均高度靠(没有大气/没有水的世界,风化和沉积都不在,
 * 大尺度的山看着太"新";先抹平再砸坑,才像月球/水星那种老地表)。
 * @param strength 0–1:1 = 完全变成邻域平均
 * @param radius 邻域半径(世界单位)
 */
export function smoothRelief(mesh: Mesh, elevation: Float32Array, strength: number, radius: number): number {
  const n = mesh.n;
  const geo = geometryOf(mesh);
  if (!(strength > 0) || !(radius > 0)) return 0;
  const src = Float32Array.from(elevation);
  let touched = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (const j of geo.cellsNear(i, radius)) {
      const d = geo.near2(i, j, radius);
      if (!(d < radius * radius)) continue;
      sum += src[j];
      cnt++;
    }
    if (!cnt) continue;
    elevation[i] = src[i] * (1 - strength) + (sum / cnt) * strength;
    touched++;
  }
  return touched;
}

export interface CraterOptions {
  /** 砸多少个 */
  count: number;
  /** 半径范围(世界单位;等距圆柱里 1 单位 ≈ 1 度经度的像素) */
  minR: number;
  maxR: number;
  /** 半径 → 深度的比例(坑的深径比,月球陨石坑约 1/5–1/3) */
  depthK: number;
}

/** 陨击坑场:碗形 + 环形坑缘(坑缘比周围略高),坑底可能压到海平面以下(以后积水成湖) */
export function stampCraters(mesh: Mesh, elevation: Float32Array, seed: number, opts: CraterOptions): number {
  const n = mesh.n;
  const geo = geometryOf(mesh);
  const base = subSeed(seed, 'craters');
  let made = 0;
  for (let k = 0; k < opts.count; k++) {
    const c = Math.min(n - 1, Math.floor(keyed(base, k, 0) * n));
    const x = mesh.x[c];
    const y = mesh.y[c];
    const r = opts.minR + (opts.maxR - opts.minR) * keyed(base, k, 1);
    // r 是世界单位(约 110 km/单位):按深径比换成米,并夹在 60–1500 m,免得坑深到看不见/离谱
    const depth = Math.min(4200, Math.max(100, r * 340 * opts.depthK * (0.6 + 0.8 * keyed(base, k, 2))));
    const reach = r * 1.35;
    const near = geo.cellsNear(c, reach);
    if (!near.length) continue;
    for (const i of near) {
      const d = geo.near2(i, c, reach);
      if (!(d < reach * reach)) continue;
      const kk = Math.sqrt(d) / r;
      if (kk >= 1.25) continue;
      // 碗形坑底
      let dh = 0;
      if (kk < 1) dh -= depth * Math.pow(1 - kk * kk, 1.6);
      // 坑缘:1.0–1.25 半径之间抬一圈
      if (kk > 0.82) dh += depth * 0.5 * Math.sin(Math.PI * Math.min(1, (kk - 0.82) / 0.3));
      // 轻微噪声,别像同心圆
      dh += (keyed(base, k, 3 + (i % 3)) - 0.5) * depth * 0.1;
      elevation[i] += dh;
    }
    made++;
    void x;
    void y;
  }
  return made;
}

export interface RiftOptions {
  /** 几条 */
  count: number;
  /** 每条多长(世界单位的比例,0–1) */
  minLen: number;
  maxLen: number;
  /** 裂谷半宽(世界单位) */
  minWidth: number;
  maxWidth: number;
  /** 最深处下切多少米 */
  depth: number;
}

/** 裂谷:沿球面走一条折线,中心线最深、两侧渐浅;下切得够深时会切到海平面以下(成线状海/熔岩裂谷) */
export function carveRifts(mesh: Mesh, elevation: Float32Array, seed: number, opts: RiftOptions): number {
  const n = mesh.n;
  const geo = geometryOf(mesh);
  const base = subSeed(seed, 'rifts');
  const W = mesh.width;
  const H = mesh.height;
  let made = 0;
  for (let k = 0; k < opts.count; k++) {
    let x = keyed(base, k, 0) * W;
    let y = keyed(base, k, 1) * H;
    const ang = keyed(base, k, 2) * Math.PI * 2;
    const len = (opts.minLen + (opts.maxLen - opts.minLen) * keyed(base, k, 3)) * W;
    const width = opts.minWidth + (opts.maxWidth - opts.minWidth) * keyed(base, k, 4);
    const depth = opts.depth * (0.7 + 0.6 * keyed(base, k, 5));
    const steps = Math.max(8, Math.round(len / Math.max(1, width * 0.6)));
    let hint = 0;
    for (let s = 0; s <= steps; s++) {
      // 折线:主方向 + 缓慢摆动
      const t = s / steps;
      const wob = Math.sin(t * Math.PI * 3 + k) * 0.35;
      const dx = Math.cos(ang + wob);
      const dy = Math.sin(ang + wob);
      x += (dx * len) / steps;
      y += (dy * len) / steps;
      // 纬向收窄(球面上高纬的经度间距缩小)
      const latRad = ((90 - (y / H) * 180) * Math.PI) / 180;
      const shrink = Math.max(0.25, Math.cos(latRad));
      const w = width / shrink;
      const cx = ((x % W) + W) % W;
      const cy = clamp(y, 0, H - 1);
      const cell = geo.nearest(cx, cy, hint);
      hint = cell;
      if (cell < 0) continue;
      for (const i of geo.cellsNear(cell, w * 2.2)) {
        const d = geo.near2(i, cell, w * 2.2);
        if (!(d < w * w)) continue;
        const kk = Math.sqrt(d) / w;
        elevation[i] -= depth * Math.exp(-kk * kk * 2.2);
      }
    }
    made++;
  }
  return made;
}

export interface IceSheetOptions {
  /** 开始有冰盖的纬度(度) */
  fromLat: number;
  /** 到哪个纬度冰盖最厚(度) */
  fullLat: number;
  /** 冰盖中央厚度(米) */
  height: number;
  /** 平滑程度 0–1:越大越平(冰盖盖住原来的山) */
  flatten: number;
}

/** 冰盖:极区陆地上叠一个光滑穹顶,并把原本的起伏压平(冰川把山磨平的样子) */
export function applyIceSheets(mesh: Mesh, elevation: Float32Array, seed: number, opts: IceSheetOptions): number {
  const n = mesh.n;
  const H = mesh.height;
  const base = subSeed(seed, 'icesheet');
  const geo = geometryOf(mesh);
  let touched = 0;
  for (let i = 0; i < n; i++) {
    const lat = Math.abs(90 - (mesh.y[i] / H) * 180);
    const t = smoothstep(opts.fromLat, opts.fullLat, lat);
    if (t <= 0) continue;
    // 冰盖高度:随纬度逐渐增厚,再叠一点低频起伏(穹顶不是平的)
    const nz = (geo.fbm(base, 3).atScale(i, 240) + 1) / 2;
    const dome = opts.height * t * (0.75 + 0.5 * nz);
    const e = elevation[i];
    if (e <= 0) continue; // 海面不抬(海冰由 gen/seaice 管)
    // 先朝穹顶高度压平,再加穹顶
    elevation[i] = e * (1 - opts.flatten * t) + dome * t;
    touched++;
  }
  return touched;
}
