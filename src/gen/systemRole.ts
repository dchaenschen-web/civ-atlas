/**
 * 星系树的"改结构"逻辑(纯函数,可 Node 测)。
 *
 * 树的三种结构改动都落成「WorldParams 的补丁 + 覆盖表」:
 *   - 恒星数量:单星 / 双恒星        → starCount(+ arch 兼容投影)
 *   - 子星系类型:单行星系 / 双固态行星系 / 气态巨星宜居卫星系 → subSystem(+ arch)
 *   - 增删天体:固态行星 / 气态行星 / 卫星
 *
 * arch 继续写盘(旧代码/旧档只认它):starCount=2 → arch=2;否则 arch=subSystem。
 * 双恒星与子星系类型不再互斥:可以「双恒星 + 双固态行星」。
 */
import type { WorldParams } from './params';
import type { GroupOverride,  PlanetOverride, SystemOverrides } from './astroDesign';

export type SubSystem = 0 | 1 | 3;
export const SUB_SYSTEM_NAME: Record<SubSystem, string> = {
  0: '单行星系',
  1: '双固态行星系',
  3: '气态巨星宜居卫星系',
};
export const SUB_SYSTEMS: readonly SubSystem[] = [0, 1, 3];

type StructureParams = Pick<WorldParams, 'arch'> & Partial<Pick<WorldParams, 'starCount' | 'subSystem'>>;

/** 现在的恒星数量(老数据只有 arch 时按 arch===2 还原) */
export function resolveStarCount(p: StructureParams): 1 | 2 {
  if (p.starCount !== undefined) return p.starCount >= 2 ? 2 : 1;
  return Math.round(p.arch ?? 0) === 2 ? 2 : 1;
}

/** 现在的子星系类型(老数据只有 arch 时按 arch 还原;arch===2 当单行星系) */
export function resolveSubSystem(p: StructureParams): SubSystem {
  const raw = p.subSystem !== undefined ? Math.round(p.subSystem) : Math.round(p.arch ?? 0) === 2 ? 0 : Math.round(p.arch ?? 0);
  return raw === 1 ? 1 : raw === 3 ? 3 : 0;
}

/** 「单星 / 双恒星」→ 参数补丁(arch 跟着投影,旧代码照样读得懂) */
export function applyStarCount(p: StructureParams, n: 1 | 2): Partial<WorldParams> {
  const sub = resolveSubSystem(p);
  return { starCount: n, arch: n === 2 ? 2 : sub };
}

/** 「子星系类型」→ 参数补丁 */
export function applySubSystem(p: StructureParams, sub: SubSystem): Partial<WorldParams> {
  const stars = resolveStarCount(p);
  return { subSystem: sub, arch: stars === 2 ? 2 : sub };
}

/** 天体数量(界面按当前实际数量算好再传进来,这里只夹范围并保证与其他构型兼容) */
export function setBodyCount(kind: 'rocky' | 'gas' | 'moons', n: number): Partial<WorldParams> {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (kind === 'rocky') return { planets: Math.min(6, Math.max(1, v)) };
  if (kind === 'gas') return { gas: Math.min(4, v) };
  return { moons: Math.min(12, v) };
}

/** 删一颗行星时,把覆盖表按下标重排(后面的一起往前挪) */
function reindexPlanets(ov: SystemOverrides, drop: number): { planets: PlanetOverride[]; moons: SystemOverrides['moons']; bodyNames?: SystemOverrides['bodyNames']; groups?: SystemOverrides['groups'] } {
  const planets = ov.planets
    .filter((o) => o.index !== drop)
    .map((o) => (o.index > drop ? { ...o, index: o.index - 1 } : o))
    .sort((a, b) => a.index - b.index);
  const moons = ov.moons
    .filter((o) => o.planet !== drop)
    .map((o) => (o.planet > drop ? { ...o, planet: o.planet - 1 } : o))
    .sort((a, b) => a.planet - b.planet || a.moon - b.moon);
  let bodyNames = ov.bodyNames;
  if (bodyNames) {
    const named: Record<string, string> = {};
    for (const [k, v] of Object.entries(bodyNames.planets ?? {})) {
      const idx = Number(k);
      if (idx === drop) continue;
      named[String(idx > drop ? idx - 1 : idx)] = v;
    }
    const namedMoons: Record<string, string> = {};
    for (const [k, v] of Object.entries(bodyNames.moons ?? {})) {
      const [p, m] = k.split(':').map((x) => Number(x));
      if (p === drop) continue;
      namedMoons[`${p > drop ? p - 1 : p}:${m}`] = v;
    }
    bodyNames = {
      ...bodyNames,
      planets: Object.keys(named).length ? named : undefined,
      moons: Object.keys(namedMoons).length ? namedMoons : undefined,
    };
  }
  // R2:显式子星系成员按下标重排(删掉第 drop 颗;后面的前移)
  const groups = ov.groups
    ? ov.groups
        .map((g) => ({ ...g, members: g.members.filter((m) => m !== drop).map((m) => (m > drop ? m - 1 : m)) }))
        .filter((g) => g.members.length)
    : undefined;
  return { planets, moons, bodyNames, ...(groups ? { groups } : {}) };
}

/** 删一颗卫星时,把同行星后面的卫星下标重排 */
function reindexMoon(ov: SystemOverrides, planet: number, moon: number): SystemOverrides['moons'] {
  return ov.moons
    .filter((o) => !(o.planet === planet && o.moon === moon))
    .map((o) => (o.planet === planet && o.moon > moon ? { ...o, moon: o.moon - 1 } : o))
    .sort((a, b) => a.planet - b.planet || a.moon - b.moon);
}

export type TreeNodeRef =
  | { kind: 'star' }
  | { kind: 'companion' }
  | { kind: 'planet'; index: number; bodyKind?: 'rocky' | 'gas' }
  | { kind: 'moon'; planet: number; moon: number };

export interface DeleteResult {
  params: Partial<WorldParams>;
  overrides: SystemOverrides;
  /** 一颗都不剩 / 不能删时给界面看的原因 */
  refused?: string;
}

/**
 * 删除树上的一个节点。按类型分派(以前一律 planets−1,删气态行星时错减了固态数):
 *   - 双恒星伴星 → 回到单星
 *   - 双固态的伴星 → 子星系回到单行星系
 *   - 气态行星   → gas−1
 *   - 固态行星   → planets−1(至少留 1 颗)
 *   - 卫星       → 该行星 moonCount−1
 */
export function deleteNode(
  p: Pick<WorldParams, 'arch' | 'planets' | 'gas'> & Partial<Pick<WorldParams, 'starCount' | 'subSystem' | 'moons' | 'home'>>,
  ov: SystemOverrides,
  node: TreeNodeRef,
  counts: { planets: number; gas: number; moons: Record<number, number> },
): DeleteResult {
  if (node.kind === 'star') return { params: {}, overrides: ov, refused: '恒星不能删(要改数量用「单星 / 双恒星」)' };
  if (node.kind === 'companion') {
    return { params: { ...applyStarCount(p, 1) }, overrides: { ...ov, star: ov.star ? { ...ov.star, companionMass: undefined } : undefined } };
  }
  if (node.kind === 'planet') {
    const i = node.index;
    const sub = resolveSubSystem(p);
    // 双固态行星系里的伴星:删它 = 子星系回到单行星系(两颗是一对,删一颗就没有"双"了)
    if (sub === 1 && node.bodyKind === 'rocky' && i !== 0 && counts.planets <= 2) {
      const next = reindexPlanets(ov, i);
      return { params: { ...applySubSystem(p, 0), planets: Math.min(6, Math.max(1, counts.planets - 1)) }, overrides: { ...ov, ...next } };
    }
    const isGas = node.bodyKind === 'gas';
    const left = isGas ? counts.gas : counts.planets;
    if (left <= (isGas ? 0 : 1)) {
      return { params: {}, overrides: ov, refused: isGas ? '至少留一颗气态行星(要清空先改子星系类型)' : '至少留一颗固态行星' };
    }
    const next = reindexPlanets(ov, i);
    return {
      params: { ...(isGas ? setBodyCount('gas', left - 1) : setBodyCount('rocky', left - 1)), ...(sub === 1 && !isGas ? applySubSystem(p, 1) : {}) },
      overrides: { ...ov, ...next },
    };
  }
  // 卫星
  const { planet, moon } = node;
  const own = counts.moons[planet] ?? 0;
  if (own <= 0) return { params: {}, overrides: ov, refused: '这颗行星没有卫星' };
  return {
    params: {},
    overrides: {
      ...ov,
      moons: reindexMoon(ov, planet, moon),
      // 这颗行星可能没有任何覆盖项:也要建一条,否则删卫星不生效
      planets: (() => {
        const cur = ov.planets.find((o) => o.index === planet);
        const next = { ...(cur ?? { index: planet }), moonCount: Math.max(0, own - 1) };
        return [...ov.planets.filter((o) => o.index !== planet), next].sort((a, b) => a.index - b.index);
      })(),
    },
  };
}

/** 把某颗卫星设成"宜居卫星"(子星系切到气态巨星宜居卫星系,主行星选这颗) */
export function setHabitableMoon(p: StructureParams, moonIndex: number): Partial<WorldParams> {
  return { ...applySubSystem(p, 3), home: moonIndex + 1 };
}


/** R2:子星系(显式成员)增删改 —— 纯函数,只改覆盖表 */
export type GroupRoleId = GroupOverride['role'];

export function addGroup(o: SystemOverrides, role: GroupRoleId, members: number[]): SystemOverrides {
  const cur = o.groups ?? [];
  const id = cur.length ? Math.max(...cur.map((g) => g.id)) + 1 : 1;
  const ms = members.filter((m) => Number.isInteger(m) && m >= 0);
  return { ...o, groups: [...cur, { id, role, members: ms }] };
}

export function setGroupRole(o: SystemOverrides, id: number, role: GroupRoleId): SystemOverrides {
  return { ...o, groups: (o.groups ?? []).map((g) => (g.id === id ? { ...g, role } : g)) };
}

export function addGroupMember(o: SystemOverrides, id: number, planet: number): SystemOverrides {
  return { ...o, groups: (o.groups ?? []).map((g) => (g.id === id ? { ...g, members: Array.from(new Set([...g.members, planet])) } : g)) };
}

export function removeGroupMember(o: SystemOverrides, id: number, planet: number): SystemOverrides {
  const groups = (o.groups ?? []).map((g) => (g.id === id ? { ...g, members: g.members.filter((m) => m !== planet) } : g));
  const kept = groups.filter((g) => g.members.length);
  return { ...o, groups: kept.length ? kept : undefined };
}

export function deleteGroup(o: SystemOverrides, id: number): SystemOverrides {
  const groups = (o.groups ?? []).filter((g) => g.id !== id);
  return { ...o, groups: groups.length ? groups : undefined };
}

export function renameGroupById(o: SystemOverrides, id: number, name: string): SystemOverrides {
  const g = (o.groups ?? []).find((x) => x.id === id);
  if (!g || !g.members.length) return o;
  const key = String(Math.min(...g.members));
  const cur = o.bodyNames ?? {};
  const groups = { ...(cur.groups ?? {}) };
  if (name.trim()) groups[key] = name.trim().slice(0, 12);
  else delete groups[key];
  return { ...o, bodyNames: { ...cur, groups: Object.keys(groups).length ? groups : undefined } };
}

/** 删一颗卫星:重新编号 + 减 moonCount(纯函数;和 deleteNode 的卫星分支同口径,但不用再算 counts) */
export function deleteMoon(ov: SystemOverrides, planet: number, moon: number): SystemOverrides {
  const own = ov.planets.find((o) => o.index === planet)?.moonCount;
  return {
    ...ov,
    moons: reindexMoon(ov, planet, moon),
    planets: (() => {
      const cur = ov.planets.find((o) => o.index === planet);
      const next = { ...(cur ?? { index: planet }), moonCount: Math.max(0, (own ?? 1) - 1) };
      return [...ov.planets.filter((o) => o.index !== planet), next].sort((a, b) => a.index - b.index);
    })(),
  };
}