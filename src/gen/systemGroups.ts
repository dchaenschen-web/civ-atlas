/**
 * N2:把"平铺的一串行星"折成"子星系"分组(纯函数,可 Node 测)。
 *
 * 一个星系里可以有多个子星系(用户要求):
 *   · 双固态行星系:主行星 + 伴星 → 一组
 *   · 气态巨星宜居卫星系 / 普通木星系:气态母行星 + 它的卫星 → 一组
 *   · 其余:每颗行星 + 自己的卫星 → 各自一组
 * 组名优先用 bodyNames.groups[组主天体下标],没有就默认「{主天体名}系」。
 */
import type { SystemOverrides } from './astroDesign';

/** 只需要这几样,免得调用方硬造一个 AstroDesign */
export interface GroupDesignInput {
  planets: { index: number; kind: 'rocky' | 'gas'; moons: readonly unknown[] }[];
  home: { index: number };
  binary?: { index: number };
  habitableMoon?: { parent: number; index: number };
}

export type GroupRole = 'planet' | 'binaryPair' | 'gasSystem' | 'habitableMoonSystem';

export interface SubSystemGroup {
  /** 组主天体的下标(行星下标;双固态用主行星下标) */
  /** 显式子星系的 id(R2);派生组没有 */
  id?: number;
  key: number;
  /** 组里有哪些行星(下标,按轨道排好) */
  planets: number[];
  role: GroupRole;
  /** 组名(默认 = 主天体名 + 系) */
  name: string;
  /** 组里的卫星(键 = 行星下标 → 卫星下标列表) */
  moons: Record<number, number[]>;
}

export interface GroupInput {
  design: GroupDesignInput;
  /** 行星名(按下标;没有就用「第 N 颗行星」) */
  planetNames: string[];
  overrides?: SystemOverrides | null;
}

/** 组名:手改优先,否则「{主天体名}系」 */
function nameOf(key: number, planetNames: string[], overrides?: SystemOverrides | null): string {
  const custom = overrides?.bodyNames?.groups?.[String(key)];
  if (custom) return custom;
  const base = planetNames[key];
  return base ? `${base}系` : `第 ${key + 1} 星系`;
}

/** 折成子星系分组 */
export function subSystemGroupsOf(input: GroupInput): SubSystemGroup[] {
  const { design, planetNames, overrides } = input;
  // R2:覆盖表里有显式 groups → 照它建组(成员没了的组自动丢弃;卫星仍按 design 挂到成员下面)
  const explicit = overrides?.groups;
  if (explicit && explicit.length) {
    const out: SubSystemGroup[] = [];
    const used = new Set<number>();
    for (const g of explicit) {
      const members = (g.members ?? []).filter((m) => m >= 0 && m < design.planets.length && !used.has(m));
      if (!members.length) continue;
      for (const m of members) used.add(m);
      const moons: Record<number, number[]> = {};
      for (const m of members) {
        const ms = (design.planets[m]?.moons ?? []).map((_, k) => k);
        if (ms.length) moons[m] = ms;
      }
      out.push({ id: g.id, key: members[0], planets: [...members].sort((a, b) => a - b), role: g.role, name: nameOf(members[0], planetNames, overrides), moons });
    }
    // 没被任何显式组收走的行星:各成一组(不丢天体)
    for (const p of design.planets) {
      if (used.has(p.index)) continue;
      const ms = (p.moons ?? []).map((_, k) => k);
      out.push({ key: p.index, planets: [p.index], role: p.kind === 'gas' ? 'gasSystem' : 'planet', name: nameOf(p.index, planetNames, overrides), moons: ms.length ? { [p.index]: ms } : {} });
    }
    return out.sort((a, b) => a.key - b.key);
  }
  const groups: SubSystemGroup[] = [];
  const used = new Set<number>();
  const moonsOf = (i: number) => (design.planets[i]?.moons ?? []).map((_, k) => k);

  const push = (key: number, planets: number[], role: GroupRole) => {
    const moons: Record<number, number[]> = {};
    for (const p of planets) {
      used.add(p);
      const ms = moonsOf(p);
      if (ms.length) moons[p] = ms;
    }
    groups.push({ key, planets: [...planets].sort((a, b) => a - b), role, name: nameOf(key, planetNames, overrides), moons });
  };

  // 双固态:主行星 + 伴星一组
  const bin = design.binary;
  if (bin && bin.index >= 0 && bin.index < design.planets.length && bin.index !== design.home.index) {
    push(design.home.index, [design.home.index, bin.index], 'binaryPair');
  }
  // 气态母行星 + 卫星(宜居卫星系 / 普通木星系)
  for (const p of design.planets) {
    if (used.has(p.index) || p.kind !== 'gas') continue;
    push(p.index, [p.index], 'gasSystem');
  }
  // 其余行星各成一组
  for (const p of design.planets) {
    if (used.has(p.index)) continue;
    const isHabParent = design.habitableMoon?.parent === p.index;
    push(p.index, [p.index], isHabParent ? 'habitableMoonSystem' : 'planet');
  }
  return groups.sort((a, b) => a.key - b.key);
}

/** 改组名(空 = 恢复默认) */
export function renameGroup(overrides: SystemOverrides, key: number, name: string): SystemOverrides {
  const cur = overrides.bodyNames ?? {};
  const groups = { ...(cur.groups ?? {}) };
  const nm = name.trim().slice(0, 12);
  if (nm) groups[String(key)] = nm;
  else delete groups[String(key)];
  return { ...overrides, bodyNames: { ...cur, groups: Object.keys(groups).length ? groups : undefined } };
}
