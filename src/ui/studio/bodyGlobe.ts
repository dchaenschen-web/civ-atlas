/**
 * WP7-7B:把「某一颗行星」的地表画成整张等距圆柱图,交给 Studio 的地球仪当纹理。
 *
 * Studio 的地球仪原本只认主行星(App.baseCanvas 渲染的是当前世界)。看别的行星时需要:
 *   planetSurface(该行星, 预算精度) → rasterize → 画风渲染 → 一张 canvas
 * 走 LRU 缓存(默认留 3 张:换样式/换行星时不至于每次都重算 100–400ms + 8MB)。
 *
 * 只读预览:不改参数、不进存档;主行星仍然走原来的 App 缓存。
 */
import { planetSurface } from '../../gen/astroWorlds';
import { generateWorld } from '../../gen/world';
import { moonWorldParams } from '../../gen/system';
import { gasColorAt, gasTextureOf } from '../../gen/gasTexture';
import { planetTypeOf } from '../../gen/astroDesign';
import type { AstroSystem } from '../../gen/astro';
import type { WorldParams } from '../../gen/params';
import type { BodyGen, SurfaceOverride } from '../../gen/astroDesign';
import type { TerrainOp } from '../../gen/edits';
import { rasterize, type Raster } from '../../gen/raster';
import { renderRealistic } from '../../render/realistic';
import { renderFantasy } from '../../render/fantasy';
import { renderLayer, type LayerId } from '../../render/layers';
import type { World } from '../../gen/world';

/** 预览纹理的宽度上限(2048 够贴球;再大只是白占内存) */
const MAX_W = 2048;
/** 缓存几张 */
const MAX_ENTRIES = 3;

interface Entry {
  key: string;
  canvas: HTMLCanvasElement;
  /** 用它的行星/样式/参数,便于排查 */
  label: string;
}
const cache: Entry[] = [];

export interface BodyTextureOptions {
  sys: AstroSystem;
  index: number;
  params: WorldParams;
  /** 画风键(和 App 的 styleKey 同一套:realistic / fantasy / data:<layer>) */
  styleKey: string;
  /** 该行星自己的地形修改 / 地表参数 / 生成参数(存档里那份;不传 = 不套) */
  ops?: readonly TerrainOp[];
  surface?: SurfaceOverride;
  gen?: BodyGen;
}

function keyOf(o: BodyTextureOptions): string {
  return [o.params.seed, o.index, o.styleKey, o.ops?.length ?? 0, o.surface ? JSON.stringify(o.surface) : '', o.gen ? JSON.stringify(o.gen) : ''].join('|');
}

/** 画一张(不缓存):行星地表 → 栅格 → 画风 */
/** 气态行星:不生成地表,按种子画一张等距圆柱的带纹贴图(条带 + 风暴) */
function gasCanvas(seed: number, mass: number, radius: number): HTMLCanvasElement {
  const tex = gasTextureOf(seed, { mass, radius });
  const w = 1024;
  const h = 512;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * 360;
      const c = gasColorAt(tex, lat, lon);
      const k = (y * w + x) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 极区压暗一点,球上更像真的
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(0.22, 'rgba(0,0,0,0)');
  g.addColorStop(0.78, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return cv;
}

function renderBody(o: BodyTextureOptions): HTMLCanvasElement | null {
  // 气态行星:只出贴图(没有地表可渲染)
  const gasPlanet = (() => {
    try {
      const t = planetTypeOf(o.sys.design.planets[o.index]);
      return t !== 'rocky' && t !== 'dwarf';
    } catch {
      return false;
    }
  })();
  if (gasPlanet) {
    const pl = o.sys.design.planets[o.index];
    return gasCanvas(o.params.seed + o.index * 7919, pl.mass, pl.radius);
  }
  let world: World;
  try {
    world = planetSurface(o.sys, o.index, o.params, o.ops ?? [], o.surface, o.gen, null);
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_W / Math.max(1, world.width));
  let raster: Raster;
  try {
    raster = rasterize(world, scale);
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = raster.w;
  canvas.height = raster.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const key = o.styleKey;
  if (key === 'realistic') renderRealistic(ctx, world, raster);
  else if (key === 'fantasy') renderFantasy(ctx, world, raster);
  else if (key.startsWith('data:')) renderLayer(ctx, world, raster, key.slice(5) as LayerId);
  else renderLayer(ctx, world, raster, 'elevation' as LayerId);
  return canvas;
}

/**
 * 取某颗行星的贴图(canvas)。命中缓存就立刻返回;没有就现画(约 100–400ms)。
 * 返回 null = 这颗行星没有地表(气态行星 / 预算为 0)。
 */
export function bodyTexture(o: BodyTextureOptions): HTMLCanvasElement | null {
  const key = keyOf(o);
  const hit = cache.find((e) => e.key === key);
  if (hit) {
    // 挪到最前(最近用过)
    cache.splice(cache.indexOf(hit), 1);
    cache.unshift(hit);
    return hit.canvas;
  }
  const canvas = renderBody(o);
  if (!canvas) return null;
  cache.unshift({ key, canvas, label: `#${o.index}:${o.styleKey}` });
  while (cache.length > MAX_ENTRIES) cache.pop();
  return canvas;
}

/** 预先丢掉某颗行星的缓存(改参数后重新取) */
export function dropBodyTextures(): void {
  cache.length = 0;
}

/** 缓存里有几张(调试 / 测试用) */
export function bodyTextureCount(): number {
  return cache.length;
}
/** 卫星贴图(程序化等距圆柱):按类型给底色 + 陨坑 + 极冠(真生成会让星系页卡死,先保留这个) */
export function moonTextureOf(moon: { type?: string; radius: number; mass: number }, seed: number): HTMLCanvasElement {
  const W = 1024;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const kind = moon.type ?? (moon.radius < 0.12 || moon.mass < 0.005 ? 'dwarf' : 'rocky');
  const base = kind === 'ice' ? '#c9d6e4' : kind === 'dwarf' ? '#6d6d72' : '#8f8b86';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 1600; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 3 + rnd() * 26;
    const v = 0.45 + rnd() * 0.55;
    ctx.fillStyle = `rgba(${Math.round(255 * v * 0.62)},${Math.round(255 * v * 0.6)},${Math.round(255 * v * 0.57)},0.2)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 420; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 2 + rnd() * 10;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(20,20,24,${0.4 + rnd() * 0.4})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.08 + rnd() * 0.12})`;
    ctx.fill();
  }
  if (kind === 'ice' || moon.radius < 0.4) {
    const g1 = ctx.createLinearGradient(0, 0, 0, H * 0.14);
    g1.addColorStop(0, 'rgba(245,250,255,0.85)');
    g1.addColorStop(1, 'rgba(245,250,255,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H * 0.14);
    const g2 = ctx.createLinearGradient(0, H, 0, H * 0.86);
    g2.addColorStop(0, 'rgba(245,250,255,0.85)');
    g2.addColorStop(1, 'rgba(245,250,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, H * 0.86, W, H * 0.14);
  }
  return cv;
}
