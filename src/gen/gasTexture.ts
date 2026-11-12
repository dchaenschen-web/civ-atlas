/**
 * 气态行星的"程序化带纹贴图"(确定性:同一个种子 → 同一张皮)。
 *
 * 气态行星不跑地形生成(用户定):它的表面只用来①缩略图/子星系显示 ②太空殖民里标「采气站」。
 *
 * 走的是"逐像素解析"路线,不是"几块大色带":gen 里只出参数(基色、条带数、涡旋列表),
 * 颜色由 gasColorAt(lat, lon) 逐像素算 —— 细条纹、纬向剪切、涡旋、极涡都在这里,
 * 渲染层(缩略图 / 地球仪预览 / 离线 PNG)统一调用它,粗细一致。
 * 不引进随机数、不用 Math.random。
 */
import { subSeed } from './util';

export interface GasBand {
  fromDeg: number;
  toDeg: number;
  color: [number, number, number];
}

export interface GasStorm {
  lonDeg: number;
  latDeg: number;
  /** 半径(纬度方向,度) */
  sizeDeg: number;
  /** 经度方向拉长倍数(涡旋通常东西向拉长) */
  stretch: number;
  spin: 1 | -1;
  color: [number, number, number];
  strength: number;
}

export interface GasTexture {
  /** 派生用的种子(渲染时逐像素噪声要用) */
  seed: number;
  bands: GasBand[];
  storms: GasStorm[];
  /** 极区色 */
  poleColor: [number, number, number];
  /** 赤道色 */
  equatorColor: [number, number, number];
  /** 细条纹强度(0–1) */
  filigree: number;
  /** 纬向剪切强度 */
  shear: number;
  /** 偏暖(木星/土星)还是偏冷(天王星/海王星) */
  warm: boolean;
}

const unit = (seed: number, tag: string) => (subSeed(seed, `gastex:${tag}`) % 1_000_000) / 1_000_000;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** 由种子 + 类别派生带纹贴图的参数(确定性的) */
export function gasTextureOf(seed: number, opts: { mass?: number; radius?: number } = {}): GasTexture {
  const mass = Math.max(0.01, opts.mass ?? 100);
  const ice = opts.radius !== undefined && opts.radius > 0 && opts.radius < 7;
  // 质量越大 -> 条带越多越细(木星 20+ 条,冰巨星少而柔)
  const bandCount = ice ? Math.round(6 + unit(seed, 'bc') * 4)
    : Math.round(22 + Math.log10(1 + mass) * 7 + unit(seed, 'bc') * 8);
  const warm = !ice && unit(seed, 'warm') > 0.3;
  // 参考真实照片的色板:木星(奶油底 + 赭石带 + 白区)、土星(淡金)、天王星(青白)、海王星(深蓝)
  const palette: [number, number, number][] = ice
    ? unit(seed, 'uranus') > 0.5
      ? [[168, 206, 214], [206, 228, 232], [140, 186, 198], [190, 216, 222]]
      : [[58, 96, 186], [82, 126, 210], [38, 66, 150], [126, 164, 226]]
    : warm
      ? mass >= 200
        ? [[226, 206, 172], [186, 148, 108], [242, 232, 214], [150, 108, 78], [214, 190, 156]] // 木星:奶油 + 赭石带
        : [[232, 216, 186], [214, 194, 158], [242, 230, 206], [196, 170, 132]]   // 土星:淡金、对比柔
      : [[178, 176, 168], [196, 192, 182], [162, 158, 150]]; // 其他暖色巨行星:中性灰褐
  const base = palette[0];

  const bands: GasBand[] = [];
  const step = 180 / bandCount;
  for (let i = 0; i < bandCount; i++) {
    const from = -90 + i * step;
    const to = from + step;
    const t = unit(seed, `band${i}`);
    const latCenter = (from + to) / 2;
    const zonal = 1 - 0.1 * Math.pow(Math.abs(latCenter) / 90, 1.6);
    const pick = palette[(i + Math.floor(t * 3)) % palette.length];
    const white = t > 0.86 ? 0.35 : 0; // 少量特别亮的白区
    bands.push({
      fromDeg: from,
      toDeg: to,
      color: [
        Math.min(255, Math.round(mix(pick[0], 250, white) * zonal)),
        Math.min(255, Math.round(mix(pick[1], 248, white) * zonal)),
        Math.min(255, Math.round(mix(pick[2], 240, white) * zonal)),
      ],
    });
  }
  const storms: GasStorm[] = [];
  const n = Math.max(2, Math.min(9, Math.round(2 + unit(seed, 'storms') * 4)));
  for (let i = 0; i < n; i++) {
    const lat = (unit(seed, `sl${i}`) * 2 - 1) * 62;
    const strength = 0.3 + 0.65 * unit(seed, `ss${i}`);
    storms.push({
      lonDeg: unit(seed, `so${i}`) * 360,
      latDeg: Math.round(lat * 10) / 10,
      sizeDeg: Math.round((3 + 9 * unit(seed, `sz${i}`)) * 10) / 10,
      stretch: Math.round((1.4 + 2.2 * unit(seed, `st${i}`)) * 100) / 100,
      spin: unit(seed, `sd${i}`) > 0.5 ? 1 : -1,
      color: (warm
        ? [Math.round(mix(150, 196, strength)), Math.round(mix(96, 150, strength)), Math.round(mix(66, 118, strength))]
        : [Math.round(mix(210, 246, strength)), Math.round(mix(226, 250, strength)), Math.round(mix(240, 252, strength))]) as [number, number, number],
      strength,
    });
  }
  const pole: [number, number, number] = [Math.round(base[0] * 0.82), Math.round(base[1] * 0.85), Math.round(base[2] * 0.92)];
  const equator: [number, number, number] = [Math.min(255, Math.round(base[0] * 1.08)), Math.min(255, Math.round(base[1] * 1.05)), Math.min(255, Math.round(base[2] * 1.02))];
  return {
    seed,
    bands,
    storms,
    poleColor: pole,
    equatorColor: equator,
    filigree: 0.35 + 0.65 * unit(seed, 'fil'),
    shear: 0.5 + 1.2 * unit(seed, 'shr'),
    warm,
  };
}

// ---- 逐像素求色(值噪声;确定性) ----
function hash2(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smoothT(t: number): number {
  return t * t * (3 - 2 * t);
}
function noise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smoothT(x - xi);
  const fy = smoothT(y - yi);
  const a = hash2(seed, xi, yi);
  const b = hash2(seed, xi + 1, yi);
  const c = hash2(seed, xi, yi + 1);
  const d = hash2(seed, xi + 1, yi + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fy) * 2 - 1;
}
function fbm(seed: number, x: number, y: number, oct: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < oct; i++) {
    sum += noise2(seed + i * 7919, x * freq, y * freq) * amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum;
}

const bandColorAt = (tex: GasTexture, latDeg: number, lonRad: number): [number, number, number] => {
  const n = tex.bands.length;
  if (!n) return tex.poleColor;
  // 条带边界用噪声扰动(不然是尺子画出来的直线)
  const cosLatW = Math.max(0.15, Math.cos((latDeg * Math.PI) / 180));
  const wob = fbm((tex.seed ^ 0x5f3a) >>> 0, lonRad * 2.2, latDeg * 0.12, 3) * 2.6 * cosLatW;
  const v = ((latDeg + 90 + wob) / 180) * n;
  // 细密副条带(木星那种一层层很窄的带):高频正弦 + 噪声
  const fineBand = Math.sin(((latDeg + 90) / 180) * n * 6.2 + wob * 2.4) * 5.5;
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(v)));
  const i1 = Math.max(0, Math.min(n - 1, i0 + 1));
  const t = smoothT(Math.max(0, Math.min(1, v - i0)));
  const a = tex.bands[i0].color;
  const b = tex.bands[i1].color;
  return [mix(a[0], b[0], t) + fineBand, mix(a[1], b[1], t) + fineBand, mix(a[2], b[2], t) + fineBand * 0.9];
};

/**
 * 逐像素求色:细条纹 + 纬向剪切 + 涡旋 + 极涡。
 * @param latDeg -90(南极) … 90(北极)
 * @param lonDeg 0–360
 */
export function gasColorAt(tex: GasTexture, latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (Math.max(-90, Math.min(90, latDeg)) * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  // 经度方向按 1/cos(lat) 抽样(高纬更密),避免极点处条纹挤成一团
  const lonSample = lon * Math.max(0.35, cosLat);
  let rgb = bandColorAt(tex, latDeg, lonSample);

  // 细条纹:纬向拉长的高频噪声
  const fine = fbm((tex.seed ^ 0x9e11) >>> 0, lonSample * 9, latDeg * 0.9, 4) * tex.filigree * 30;
  // 纬向剪切:赤道流和急流边界处把噪声往东/西推
  const shear = Math.sin(lat * 9.5 + fbm((tex.seed ^ 0x33) >>> 0, lonSample * 1.7, latDeg * 0.4, 2) * 2.4) * tex.shear;
  const swirl = fbm((tex.seed ^ 0x7c1) >>> 0, lonSample * 4 + shear, latDeg * 1.6, 3) * 9;
  rgb = [rgb[0] + fine + swirl, rgb[1] + fine + swirl * 0.95, rgb[2] + fine + swirl * 0.7];

  // 涡旋(大红斑这类):椭圆高斯 + 螺旋明暗
  for (const s of tex.storms) {
    let dLon = lonDeg - s.lonDeg;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const dx = (dLon * Math.max(0.15, cosLat)) / s.stretch;
    const dy = latDeg - s.latDeg;
    const dist = Math.sqrt((dx * dx) / (s.sizeDeg * s.sizeDeg) + (dy * dy) / (s.sizeDeg * s.sizeDeg));
    if (dist > 1.8) continue;
    const fall = Math.exp(-dist * dist * 2.2) * s.strength;
    const az = Math.atan2(dy, dx);
    const spiral = Math.sin(az * s.spin + dist * 5.5) * 0.16 * fall;
    const k = Math.max(0, Math.min(1, fall));
    rgb = [
      (mix(rgb[0], s.color[0], k) * (1 + spiral)) as number,
      (mix(rgb[1], s.color[1], k) * (1 + spiral)) as number,
      (mix(rgb[2], s.color[2], k) * (1 + spiral)) as number,
    ];
  }

  // 极涡:极区压暗 + 一点六边形感
  const polar = Math.max(0, (Math.abs(latDeg) - 62) / 28);
  if (polar > 0) {
    const hex = noise2((tex.seed ^ 0x2aa) >>> 0, lon * 3.1, latDeg * 0.2) * 0.1;
    const k = Math.min(1, polar) * (0.2 + hex * 0.5);
    rgb = [mix(rgb[0], tex.poleColor[0], k), mix(rgb[1], tex.poleColor[1], k), mix(rgb[2], tex.poleColor[2], k)];
  }
  return [clamp255(Math.round(rgb[0])), clamp255(Math.round(rgb[1])), clamp255(Math.round(rgb[2]))];
}
