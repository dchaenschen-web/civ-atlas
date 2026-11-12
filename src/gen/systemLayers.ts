/**
 * 星系分层存档(SystemSpec 的持久化形态):把逐行星/卫星覆盖表按「行星 → 卫星」分层写。
 *
 * 只依赖类型(运行时不引任何生成代码),所以能安全地被存档层直接 import,不占首页体积。
 * 兼容策略:老的 `system`(覆盖表)照旧读;新的 `systemSpec` 存在时优先用它,读不懂再回落到老的。
 * 默认世界没有星系 → 这两样都不写,存档逐字节不变。
 */
import type { MoonType, BodyGen, BodyNames, PlanetType, MoonOverride, PlanetOverride, SystemOverrides, SurfaceOverride } from './astroDesign';
import type { TerrainOp } from './edits';

export interface PlanetLayer {
  index: number;
  a?: number;
  ecc?: number;
  incDeg?: number;
  nodeDeg?: number;
  periodDays?: number;
  radius?: number;
  mass?: number;
  geo?: number;
  mag?: number;
  tilt?: number;
  rotation?: number;
  life?: number;
  reroll?: number;
  moonCount?: number;
  home?: boolean;
  /** 手动改的类型(岩石/矮行星/亚海王星/气态巨行星/冰巨行星) */
  type?: PlanetType;
  /** 子星系角色(N2) */
  role?: 'planet' | 'binaryCompanion' | 'gasParent' | 'habitableMoon';
  surface?: SurfaceOverride;
  /** 每颗行星自己的生成参数 */
  gen?: BodyGen;
  terrain?: TerrainOp[];
}

export interface MoonLayer {
  planet: number;
  moon: number;
  distance?: number;
  radius?: number;
  mass?: number;
  periodDays?: number;
  locked?: boolean;
  life?: number;
  reroll?: number;
  surface?: SurfaceOverride;
  /** 每颗卫星自己的生成参数 */
  gen?: BodyGen;
  terrain?: TerrainOp[];
  /** 手动改的卫星类型 */
  type?: MoonType;
}

export interface StarLayer {
  mass?: number;
  companionMass?: number;
  /** AB 间距覆盖(AU) */
  sepAU?: number;
  /** 三合星 C 间距覆盖(AU) */
  outerSepAU?: number;
}
/** R2:子星系(显式成员)的分层存档形态 */
export interface StoredGroup {
  id: number;
  role: 'planet' | 'binaryPair' | 'gasSystem' | 'habitableMoonSystem';
  members: number[];
}

export interface StoredLayers {
  v: 1;
  planets: PlanetLayer[];
  moons: MoonLayer[];
  /** 手动改的星体名 */
  names?: BodyNames;
  /** 恒星质量覆盖 */
  star?: StarLayer;
  /** R2:显式子星系 */
  groups?: StoredGroup[];
}

const SURFACE_KEYS = ['landFraction', 'temperature', 'rainfall', 'cells'] as const;

/** 覆盖表 → 分层存档(每颗行星一层、卫星挂在下面;只写有值的字段) */
export function layersOfOverrides(o: SystemOverrides): StoredLayers {
  const planets: PlanetLayer[] = o.planets.map((p) => {
    const out: PlanetLayer = { index: p.index };
    for (const k of ['a', 'ecc', 'incDeg', 'nodeDeg', 'periodDays', 'radius', 'mass', 'geo', 'mag', 'tilt', 'rotation', 'life', 'reroll', 'moonCount'] as const) {
      if (p[k] !== undefined) out[k] = p[k] as number;
    }
    if (p.home !== undefined) out.home = p.home;
    if (p.type !== undefined) out.type = p.type;
    if (p.role !== undefined) out.role = p.role;
    if (p.surface) out.surface = { ...p.surface };
    if (p.gen) out.gen = JSON.parse(JSON.stringify(p.gen)) as BodyGen;
    if (p.terrain) out.terrain = (p.terrain as TerrainOp[]).map((x) => ({ ...x, pts: x.pts.slice() }));
    return out;
  });
  const moons: MoonLayer[] = o.moons.map((m) => {
    const out: MoonLayer = { planet: m.planet, moon: m.moon };
    if (m.type !== undefined) out.type = m.type;
    for (const k of ['distance', 'radius', 'mass', 'periodDays', 'life', 'reroll'] as const) {
      if (m[k] !== undefined) out[k] = m[k] as number;
    }
    if (m.locked !== undefined) out.locked = m.locked;
    if (m.surface) out.surface = { ...m.surface };
    if (m.gen) out.gen = JSON.parse(JSON.stringify(m.gen)) as BodyGen;
    if (m.terrain) out.terrain = (m.terrain as TerrainOp[]).map((x) => ({ ...x, pts: x.pts.slice() }));
    return out;
  });
  const out: StoredLayers = { v: 1, planets, moons };
  if (o.groups?.length) out.groups = o.groups.map((g) => ({ id: g.id, role: g.role, members: g.members.slice() }));
  if (o.bodyNames) out.names = JSON.parse(JSON.stringify(o.bodyNames)) as BodyNames;
if (o.star && Object.keys(o.star).length) out.star = { ...o.star };
  return out;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function takeNums(src: Record<string, unknown>, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function takeSurface(raw: unknown): SurfaceOverride | undefined {
  if (!isObj(raw)) return undefined;
  const nums = takeNums(raw, SURFACE_KEYS);
  return Object.keys(nums).length ? (nums as SurfaceOverride) : undefined;
}

function takeTerrain(raw: unknown): TerrainOp[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  return raw.filter(isObj) as unknown as TerrainOp[];
}

/**
 * 分层存档 → 覆盖表。只做形状层面的搬运(范围与合法性的最终核对交给 savefile 的 cleanSystem),
 * 遇到不认识的形状就返回 null,让调用方回落到老的 `system` 字段。
 */
export function overridesOfLayers(raw: unknown): SystemOverrides | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  if (!Array.isArray(raw.planets) || !Array.isArray(raw.moons)) return null;
  const planets: PlanetOverride[] = [];
  for (const x of raw.planets) {
    if (!isObj(x)) continue;
    const index = x.index;
    if (typeof index !== 'number' || !Number.isInteger(index)) continue;
    const o: PlanetOverride = { index };
    for (const k of ['a', 'ecc', 'incDeg', 'nodeDeg', 'periodDays', 'radius', 'mass', 'geo', 'mag', 'tilt', 'rotation', 'life', 'reroll', 'moonCount'] as const) {
      const v = x[k];
      if (typeof v === 'number' && Number.isFinite(v)) o[k] = v;
    }
    if (typeof x.home === 'boolean') o.home = x.home;
    if (x.type === 'rocky' || x.type === 'dwarf' || x.type === 'subNeptune' || x.type === 'gasGiant' || x.type === 'iceGiant') o.type = x.type;
    if (x.role === 'planet' || x.role === 'binaryCompanion' || x.role === 'gasParent' || x.role === 'habitableMoon') o.role = x.role;
    const surface = takeSurface(x.surface);
    if (surface) o.surface = surface;
    if (isObj(x.gen)) o.gen = JSON.parse(JSON.stringify(x.gen)) as BodyGen;
    const terrain = takeTerrain(x.terrain);
    if (terrain) o.terrain = terrain;
    planets.push(o);
  }
  const moons: MoonOverride[] = [];
  for (const x of raw.moons) {
    if (!isObj(x)) continue;
    const planet = x.planet;
    const moon = x.moon;
    if (typeof planet !== 'number' || !Number.isInteger(planet) || typeof moon !== 'number' || !Number.isInteger(moon)) continue;
    const o: MoonOverride = { planet, moon };
    for (const k of ['distance', 'radius', 'mass', 'periodDays', 'life', 'reroll'] as const) {
      const v = x[k];
      if (typeof v === 'number' && Number.isFinite(v)) o[k] = v;
    }
    if (x.type === 'rocky' || x.type === 'ice' || x.type === 'dwarf') o.type = x.type;
    if (typeof x.locked === 'boolean') o.locked = x.locked;
    const surface = takeSurface(x.surface);
    if (surface) o.surface = surface;
    if (isObj(x.gen)) o.gen = JSON.parse(JSON.stringify(x.gen)) as BodyGen;
    const terrain = takeTerrain(x.terrain);
    if (terrain) o.terrain = terrain;
    moons.push(o);
  }
  let names: BodyNames | undefined;
  const rawNames = raw.names;
  if (isObj(rawNames)) {
    const cleanMap = (m: unknown): Record<string, string> | undefined => {
      if (!isObj(m)) return undefined;
      const out: Record<string, string> = {};
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (typeof v === 'string' && v.trim()) out[k] = v;
      }
      return Object.keys(out).length ? out : undefined;
    };
    const star = typeof rawNames.star === 'string' && rawNames.star.trim() ? rawNames.star : undefined;
    const planets = cleanMap(rawNames.planets);
    const moons = cleanMap(rawNames.moons);
    if (star || planets || moons) names = { ...(star ? { star } : {}), ...(planets ? { planets } : {}), ...(moons ? { moons } : {}) };
  }
  let star: { mass?: number; companionMass?: number; sepAU?: number; outerSepAU?: number } | undefined;
  if (isObj(raw.star)) {
    const out: { mass?: number; companionMass?: number; sepAU?: number; outerSepAU?: number } = {};
    if (typeof raw.star.sepAU === 'number') out.sepAU = raw.star.sepAU;
    if (typeof raw.star.outerSepAU === 'number') out.outerSepAU = raw.star.outerSepAU;
    if (typeof raw.star.mass === 'number') out.mass = raw.star.mass;
    if (typeof raw.star.companionMass === 'number') out.companionMass = raw.star.companionMass;
    if (Object.keys(out).length) star = out;
  }
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  const groups = rawGroups.length
    ? (rawGroups as unknown[]).filter((g): g is { id: number; role: StoredGroup['role']; members: number[] } => isObj(g) && typeof g.id === 'number' && Array.isArray(g.members)).map((g) => ({ id: g.id, role: g.role, members: (g.members as unknown[]).filter((m): m is number => typeof m === 'number') }))
    : [];
  if (!planets.length && !moons.length && !names && !star) return null;
  return { planets, moons, ...(groups.length ? { groups } : {}), ...(names ? { bodyNames: names } : {}), ...(star ? { star } : {}) };
}
