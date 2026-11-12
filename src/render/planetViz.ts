/**
 * 一颗行星的地表缩略图:同一套生成管线(astroWorlds.planetSurface → rasterize),按预算精度出数据,
 * 再由这里上一层颜色(手绘地形 / 生物群系 / 温度 / 降水)。
 *
 * 放在 render/ 下面:要调 gen 的生成代码和画风,不反过来。生成结果在 worker 里缓存,切图层不用重算地表。
 */
import { BIOMES } from '../gen/biomes';
import { generateAstro } from '../gen/astro';
import { planetSurface, planetSurfaceStats, type SurfaceStats } from '../gen/astroWorlds';
import { rasterize, type Raster } from '../gen/raster';
import type { WorldParams } from '../gen/params';
import { clamp } from '../gen/util';
import { fantasyPixels } from './fantasy';
import { gasColorAt, gasTextureOf } from '../gen/gasTexture';
import { meanMolarKg, pressureContourLevelsM } from '../gen/pressureContours';

export type PlanetLayer = 'terrain' | 'biome' | 'temp' | 'precip';

export const PLANET_LAYERS: { id: PlanetLayer; name: string }[] = [
  { id: 'terrain', name: '地形' },
  { id: 'biome', name: '生物群系' },
  { id: 'temp', name: '温度' },
  { id: 'precip', name: '降水' },
];

/** 缩略图最多多少像素(再大就没必要了,内存和时间都涨) */
export const PLANET_VIZ_PX = 320000;

export interface PlanetVizInput {
  params: WorldParams;
  index: number;
  layer: PlanetLayer;
  /** 这颗行星自己的地形修改(可选;和星系编辑里改的同一份) */
  ops?: import('../gen/edits').TerrainOp[];
  /** 这颗行星自己的地表参数 */
  surf?: import('../gen/astroDesign').SurfaceOverride;
  /** 这颗行星自己的生成参数(板块/造山/气候/精度/种子) */
  gen?: import('../gen/astroDesign').BodyGen;
  /** 这颗行星照的那张手绘图(认好的格子图;不给 = 不照图) */
  sketch?: import('../gen/sketch').Sketch | null;
  /** 叠不叠「以标准气压为基准」的等高线(默认叠) */
  contours?: boolean;
}

export interface PlanetVizOut {
  w: number;
  h: number;
  /** RGBA */
  px: Uint8ClampedArray;
  stats: SurfaceStats;
  layer: PlanetLayer;
}

/** 影响这颗行星地表的参数(缓存键) */
function keyOf(p: WorldParams, index: number, ops: readonly { kind: string }[] = [], surf?: unknown, gen?: unknown): string {
  const base = [p.seed, p.system, p.planets, p.gas, p.moons, p.tilt, p.rotation, p.geo, p.mag, p.arch, p.life, p.home, p.salt, index].join(',');
  const o = ops.length ? JSON.stringify(ops) : '';
  const s = surf ? JSON.stringify(surf) : '';
  const g = gen ? JSON.stringify(gen) : '';
  return o || s || g ? `${base}|${o}|${s}|${g}` : base;
}

const cache = new Map<string, { world: ReturnType<typeof planetSurface>; raster: Raster }>();
const CACHE_MAX = 6;

/** 生成(或复用)一颗行星的缩略图 */
export function planetViz(input: PlanetVizInput): PlanetVizOut {
  // 气态行星:不跑地表生成,只出带纹贴图(用户定)
  const sys0 = generateAstro(input.params);
  const d0 = sys0.design.planets[input.index];
  if (d0 && d0.kind === 'gas') {
    const h = 256;
    const w = 512;
    const px = gasPixels(input.params.seed + input.index * 7919, d0.atmos.pressure, d0.mass, d0.radius, w, h);
    const stats: SurfaceStats = { landPct: 0, meanTempC: Math.round((d0.tempK - 273.15) * 10) / 10, rivers: 0, maxElev: 0, volcanoes: 0, biomes: [] };
    return { w, h, px, stats, layer: input.layer };
  }
  // 照手绘图的不走缓存(草图对象没有稳定指纹,现算一次)
  const e0 = generateAstro(input.params).design.planets[input.index];
  const k = input.sketch ? '' : keyOf(input.params, input.index, input.ops ?? [], input.surf, input.gen);
  let e = k ? cache.get(k) : undefined;
  if (!e) {
    const sys = generateAstro(input.params);
    const world = planetSurface(sys, input.index, input.params, input.ops ?? [], input.surf, input.gen, input.sketch ?? null);
    const mapPx = Math.max(1, world.width * world.height);
    const scale = clamp(Math.sqrt(PLANET_VIZ_PX / mapPx), 0.017, 0.5);
    const raster = rasterize(world, scale);
    e = { world, raster };
    if (k) {
      cache.set(k, e);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    }
  }
  const { world, raster } = e;
  let px: Uint8ClampedArray;
  if (input.layer === 'terrain') {
    try {
      px = fantasyPixels(world, raster).px;
    } catch {
      px = colorize(raster, 'biome');
    }
  } else {
    px = colorize(raster, input.layer);
  }
  // 等高线:以该行星标准气压为基准(气压每 ±10% 一条)
  if (input.contours !== false && input.layer === 'terrain') {
    const g = Math.max(0.05, (e0?.mass ?? 1) / Math.max(0.01, Math.pow(e0?.radius ?? 1, 2)));
    const levels = pressureContourLevelsM({ p0Atm: e0?.atmos.pressure ?? 1, tempK: (e0?.tempK ?? 288), molarKg: meanMolarKg(e0?.atmos ?? null), gravity: g });
    paintContours(px, raster, raster.w, raster.h, levels, 0.7);
  }
  return { w: raster.w, h: raster.h, px, stats: planetSurfaceStats(world), layer: input.layer };
}

/** 在缩略图上画「以标准气压为基准」的等高线(直接在 RGBA 里点暗像素;320k 像素只要几毫秒) */
function paintContours(px: Uint8ClampedArray, r: Raster, w: number, h: number, levels: number[], dark: number): void {
  const e = r.elev;
  if (!e || e.length < w * h) return;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const v = e[i];
      for (let k = 0; k < levels.length; k++) {
        const L = levels[k];
        const a = v - L;
        const b = e[i + 1] - L;
        const c = e[i + w] - L;
        if ((a < 0 && b >= 0) || (a > 0 && b <= 0) || (a < 0 && c >= 0) || (a > 0 && c <= 0)) {
          const o = i * 4;
          // 标准气压那条(z=0)最粗最暗
          const k2 = L === 0 ? 0.45 : 0.72;
          px[o] = Math.round(px[o] * k2);
          px[o + 1] = Math.round(px[o + 1] * k2);
          px[o + 2] = Math.round(px[o + 2] * k2);
          void dark;
          break;
        }
      }
    }
  }
}
/** 气态行星:不生成地表,只按种子出一张带纹贴图(条带 + 风暴) */
function gasPixels(seed: number, pressure: number, mass: number, radius: number, w: number, h: number): Uint8ClampedArray {
  const tex = gasTextureOf(seed, { mass, radius });
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * 360;
      const c = gasColorAt(tex, lat, lon);
      const o = (y * w + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    }
  void pressure;
  }
  return px;
}

/** 线性插值(0–255 分量用) */
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
/** 温度色带:-40°C 深蓝 → 0 青 → 15 绿 → 30 黄 → 45 红 */
function tempColor(t: number): [number, number, number] {
  const x = clamp((t + 40) / 85, 0, 1);
  if (x < 0.25) return [28, 58 + Math.round(x * 4 * 90), 150];
  if (x < 0.45) return [40 + Math.round((x - 0.25) * 800), 160, 120];
  if (x < 0.62) return [60 + Math.round((x - 0.45) * 1200), 190, 70];
  if (x < 0.8) return [200, 200 - Math.round((x - 0.62) * 400), 40];
  return [220, 80 - Math.round((x - 0.8) * 200), 30];
}

/** 降水色带:0 沙黄 → 400 草绿 → 1200 蓝绿 → 3000+ 深蓝 */
function precipColor(mm: number): [number, number, number] {
  const x = clamp(mm / 3000, 0, 1);
  if (x < 0.2) return [190, 170 - Math.round(x * 100), 110];
  if (x < 0.45) return [Math.round(140 - (x - 0.2) * 200), 170, 90];
  if (x < 0.7) return [60, 150 + Math.round((x - 0.45) * 100), 150];
  return [40, 120 + Math.round((x - 0.7) * 100), 190];
}

function colorize(r: Raster, layer: Exclude<PlanetLayer, 'terrain'>): Uint8ClampedArray {
  const px = new Uint8ClampedArray(r.w * r.h * 4);
  for (let i = 0; i < r.w * r.h; i++) {
    let c: [number, number, number];
    if (layer === 'biome') {
      const b = BIOMES[r.biome[i]];
      c = b ? b.real : [110, 110, 110];
    } else if (layer === 'temp') {
      c = tempColor(r.temp[i]);
    } else {
      c = precipColor(r.precip[i]);
    }
    // 海面压暗一点,陆地留原色:让水陆分得清
    const k = r.water[i] === 1 ? 0.72 : 1;
    const o = i * 4;
    px[o] = c[0] * k;
    px[o + 1] = c[1] * k;
    px[o + 2] = c[2] * k;
    px[o + 3] = 255;
  }
  return px;
}
