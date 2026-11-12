/**
 * 本星系其他天体的"进入看详情 / 按需推演文明"。
 *
 * World 仍然是一颗行星一个;这里按天体懒生成它的 World(复用 astroWorlds.planetSurface 的缓存),
 * 再按需跑一份文明(缓存住,同一个星系同一天体只推一次)。只有"有生命迹象"的天体允许推文明。
 */
import type { AstroSystem } from './astro';
import type { PlanetDesign } from './astroDesign';
import type { WorldParams } from './params';
import type { World } from './world';
import type { TerrainOp } from './edits';
import type { SurfaceOverride } from './astroDesign';
import type { Civ } from './civ/types';
import type { SaveBody } from './savefile';
import { generateCiv } from './civ';
import { planetSurface } from './astroWorlds';
import { generateWorld } from './world';
import { moonWorldParams } from './system';

/** 详情/推演只做行星(卫星的地表参数在 gen/system.ts,先只看地形) */
export interface BodyFacts {
  index: number;
  planet: PlanetDesign;
  /** 有生命迹象(生物圈或可呼吸):允许推文明 */
  alive: boolean;
}

/** 这个星系里每颗行星的事实(界面用) */
export function bodyFacts(sys: AstroSystem): BodyFacts[] {
  return sys.design.planets.map((planet, index) => ({
    index,
    planet,
    alive: planet.kind === 'rocky' && (planet.biotic || planet.atmos.breathable),
  }));
}

/** 这颗行星的 World(和星球系页里"生成地表"用的是同一份缓存) */
export function bodyWorld(sys: AstroSystem, index: number, base: WorldParams, ops: readonly TerrainOp[] = [], surf?: SurfaceOverride): World {
  return planetSurface(sys, index, base, ops, surf);
}

const civCache = new WeakMap<AstroSystem, Map<string, Civ>>();

/**
 * 按需推演这颗行星的文明(只对有生命迹象的天体;主行星的文明就是主世界那份,不该走这里)。
 * 年份短一些(默认 800 年):详情页是预览,不是正式世界。
 */
export function bodyCiv(sys: AstroSystem, index: number, base: WorldParams, endYear = 800, ops: readonly TerrainOp[] = [], surf?: SurfaceOverride): Civ {
  let m = civCache.get(sys);
  if (!m) {
    m = new Map();
    civCache.set(sys, m);
  }
  const ckey = ops.length ? `${index}|${JSON.stringify(ops)}` : String(index);
  const hit = m.get(ckey);
  if (hit && hit.endYear >= endYear) return hit;
  const w = bodyWorld(sys, index, base, ops, surf);
  const civ = generateCiv(w, { endYear });
  m.set(ckey, civ);
  return civ;
}


// ---------------------------------------------------------------------------
// 步 11/12:每天体的 id、世界与文明存取(纯函数 + 缓存;不碰 DOM)
// ---------------------------------------------------------------------------

/** 每个天体最多几份文明 */
export const BODY_CIV_MAX = 4;

/** 世界里的一个天体引用 */
export interface BodyRef {
  id: string;
  kind: 'planet' | 'moon';
  planet: number;
  moon?: number;
  name?: string;
  /** 能不能住人(有生物圈/可呼吸/岩质或冰壳卫星) */
  alive: boolean;
}

export function planetBodyId(index: number): string {
  return `p${Math.max(0, Math.round(index))}`;
}

export function moonBodyId(planet: number, moon: number): string {
  return `m${Math.max(0, Math.round(planet))}-${Math.max(0, Math.round(moon))}`;
}

/** id 串 → 下标(解析失败 = null) */
export function parseBodyId(id: string): { kind: 'planet'; planet: number } | { kind: 'moon'; planet: number; moon: number } | null {
  const m = /^([pm])([0-9]+)(?:-([0-9]+))?$/.exec(id);
  if (!m) return null;
  const planet = Number(m[2]);
  if (!Number.isInteger(planet)) return null;
  if (m[1] === 'p' && m[3] === undefined) return { kind: 'planet', planet };
  if (m[1] === 'm' && m[3] !== undefined) return { kind: 'moon', planet, moon: Number(m[3]) };
  return null;
}

/** 这个星系里所有天体(先行星、后卫星;顺序稳定) */
export function listBodies(sys: AstroSystem, names?: { planets?: string[]; moons?: Record<string, string[]> }): BodyRef[] {
  const out: BodyRef[] = [];
  sys.design.planets.forEach((p, i) => {
    out.push({ id: planetBodyId(i), kind: 'planet', planet: i, name: names?.planets?.[i], alive: p.kind === 'rocky' && (p.biotic || p.atmos.breathable) });
    (p.moons ?? []).forEach((m, k) => {
      const parentTemp = p.tempK;
      const alive = m.radius >= 0.15 && m.mass >= 0.01 && (parentTemp > 240 || p.atmos.breathable);
      out.push({ id: moonBodyId(i, k), kind: 'moon', planet: i, moon: k, name: names?.moons?.[i]?.[k], alive });
    });
  });
  return out;
}

/** 主天体 id(没有星系 = p0) */
export function homeBodyId(sys: AstroSystem | null | undefined): string {
  return sys ? planetBodyId(sys.design.home.index) : 'p0';
}

/** 旧存档(没有 bodies)→ 只有主天体;已有的原样(去掉多余字段) */
export function bodiesOrDefault(saved: readonly SaveBody[] | undefined, sys: AstroSystem | null | undefined): SaveBody[] {
  if (saved && saved.length) return saved.map((b) => ({ id: b.id, ...(b.seedShift !== undefined ? { seedShift: b.seedShift } : {}), ...(b.civs ? { civs: b.civs } : {}) }));
  return [{ id: homeBodyId(sys) }];
}

export function bodySaveOf(bodies: readonly SaveBody[] | undefined, id: string): SaveBody | undefined {
  return bodies?.find((b) => b.id === id);
}

/** 某个天体的文明(没有 = 空;超过 4 截断) */
export function bodyCivsOf(bodies: readonly SaveBody[] | undefined, id: string): unknown[] {
  return (bodySaveOf(bodies, id)?.civs ?? []).slice(0, BODY_CIV_MAX);
}

/** 写入某个天体的文明(不能住人的天体清空;纯函数) */
export function setBodyCivs(bodies: readonly SaveBody[] | undefined, ref: BodyRef, civs: readonly unknown[]): SaveBody[] {
  const list = ref.alive ? civs.slice(0, BODY_CIV_MAX) : [];
  const cur = bodies ? [...bodies] : [];
  const i = cur.findIndex((b) => b.id === ref.id);
  const next: SaveBody = { id: ref.id, ...(list.length ? { civs: list } : {}) };
  if (i >= 0) cur[i] = next;
  else cur.push(next);
  return cur;
}


/**
 * 步12:按天体引用推演文明(行星或卫星)。只对 alive(能住人)的天体跑;卫星的世界用
 * moonWorldParams + generateWorld(和卫星地表页同一套),缓存住避免重复推演。
 */
const refCivCache = new WeakMap<AstroSystem, Map<string, Civ>>();

export function bodyCivByRef(
  sys: AstroSystem,
  ref: BodyRef,
  base: WorldParams,
  endYear = 800,
  opts: {
    planetOps?: readonly TerrainOp[];
    planetSurf?: SurfaceOverride;
    moonSurf?: SurfaceOverride;
    moonGen?: import('./astroDesign').BodyGen;
  } = {},
): Civ | null {
  if (!ref.alive) return null;
  let m = refCivCache.get(sys);
  if (!m) {
    m = new Map();
    refCivCache.set(sys, m);
  }
  const key = `${ref.id}|${endYear}`;
  const hit = m.get(key);
  if (hit) return hit;
  let w: World;
  if (ref.kind === 'planet') {
    w = bodyWorld(sys, ref.planet, base, opts.planetOps, opts.planetSurf);
  } else {
    const params = moonWorldParams(sys.design, ref.planet, ref.moon ?? 0, base, opts.moonSurf, opts.moonGen);
    w = generateWorld(params);
  }
  const civ = generateCiv(w, { endYear });
  m.set(key, civ);
  return civ;
}