/**
 * 单一数据源:天体视图(BodyView)。
 *
 * 以前界面上「这颗行星叫什么 / 什么类型 / 多大 / 有没有文明」分别从 design、覆盖表、BodyNames、
 * SaveFile.bodies 里各取一处,数值和名字会对不上。这里把它们合成一层**只读视图**:
 *
 *   BodyView = design(已套覆盖表、已派生的有效设计) + 名字(改名优先,否则种子默认) + 存档里的文明
 *
 * 约定:
 *   · 纯函数,不改任何输入;界面各模式都读这一份
 *   · design 必须是已经 applyOverrides / rebuildDesign 过的有效设计
 *   · 名字:bodyNames 改名优先 → defaultNames(nameAstro 的结果)→ 「行星 N / 卫星 N」兜底
 *   · 文明:SaveFile.bodies 里该 id 的 civs(最多 4)
 */
import type { AstroSystem } from './astro';
import type { BodyNames, MoonDesign, PlanetDesign } from './astroDesign';
import { moonPeriodDays } from './skyLayer';
import { isHotJupiter, MOON_TYPE_NAME, moonTypeOf, orbitYears, planetTypeOf, type PlanetType } from './astroDesign';
import type { SaveBody } from './savefile';
import { BODY_CIV_MAX, bodyCivsOf, listBodies, type BodyRef } from './bodies';

/** 行星类型 → 显示名(和 PLANET_TYPE_NAME 同口径,放这里避免循环 import) */
const PLANET_LABEL: Record<PlanetType, string> = {
  rocky: '岩石行星',
  dwarf: '矮行星',
  subNeptune: '亚海王星',
  gasGiant: '气态巨行星',
  iceGiant: '冰巨行星',
};

/** 一个天体的只读视图 */
/** 天体轨道参数(只读视图里也带一份,界面不再各处去 design/覆盖表拼) */
export interface BodyOrbit {
  /** 半长轴(AU;卫星为绕母行星的半径倍数 × 母星半径,见 distanceR) */
  a?: number;
  ecc?: number;
  incDeg?: number;
  nodeDeg?: number;
  /** 公转周期(地球日;行星按开普勒,卫星按绕母行星质量) */
  periodDays: number;
  /** 公转周期(年;只有行星有意义) */
  periodYears?: number;
  /** 卫星:绕母行星的距离(母行星半径倍数) */
  distanceR?: number;
  /** 卫星:是否潮汐锁定 */
  locked?: boolean;
}

export interface BodyView {
  /** 内部 id(`p0`/`m0-1`)—— 只做键,不当显示名 */
  id: string;
  kind: 'planet' | 'moon';
  /** 显示名(改名优先,否则种子默认) */
  name: string;
  /** 类型标签("岩石行星"/"冰卫星"/"热木星"…) */
  typeLabel: string;
  /** 粗类(地表预算/渲染分支用) */
  bodyKind: 'rocky' | 'gas';
  /** 半径(R⊕) */
  radius: number;
  /** 质量(M⊕) */
  mass: number;
  /** 表面温度(K) */
  tempK: number;
  /** 有没有环(和 gen/rings.ts 同一判定:巨行星或质量 ≥ 40) */
  hasRings: boolean;
  /** 父天体 id(卫星才有) */
  parentId?: string;
  /** 能不能住人(能推演文明) */
  alive: boolean;
  /** 轨道参数(行星:绕恒星;卫星:distanceR 是绕母行星的半径倍数) */
  orbit: BodyOrbit;
  /** 存档里已有的文明(最多 4;没有 = 空) */
  civs: unknown[];
  /** 原始 design 对象(只读使用) */
  design: PlanetDesign | MoonDesign;
}

const ringsOf = (p: PlanetDesign): boolean => (p.kind === 'gas' && p.radius >= 1.6 && p.mass >= 8) || p.mass >= 40;

function fieldsOf(sys: AstroSystem, ref: BodyRef) {
  if (ref.kind === 'planet') {
    const p = sys.design.planets[ref.planet];
    if (!p) return null;
    const t = planetTypeOf(p);
    return {
      radius: p.radius,
      mass: p.mass,
      tempK: p.tempK,
      bodyKind: p.kind,
      hasRings: ringsOf(p),
      typeLabel: isHotJupiter(p) ? '热木星' : PLANET_LABEL[t],
      design: p as PlanetDesign | MoonDesign,
    };
  }
  const p = sys.design.planets[ref.planet];
  const m = p?.moons?.[ref.moon ?? -1];
  if (!p || !m) return null;
  return {
    radius: m.radius,
    mass: m.mass,
    // 卫星自己的温度没单独建模:按母行星温度减一点(和 gen/system.moonWorldParams 同口径)
    tempK: p.tempK - (m.locked ? 25 : 10),
    bodyKind: 'rocky' as const,
    hasRings: false,
    typeLabel: MOON_TYPE_NAME[moonTypeOf(m, p.tempK)],
    design: m as PlanetDesign | MoonDesign,
  };
}

function orbitOf(sys: AstroSystem, ref: BodyRef): BodyOrbit {
  if (ref.kind === 'planet') {
    const p = sys.design.planets[ref.planet];
    const years = orbitYears(p.a);
    return { a: p.a, ecc: p.ecc, incDeg: p.incDeg, nodeDeg: p.nodeDeg, periodYears: years, periodDays: years * 365.25 };
  }
  const p = sys.design.planets[ref.planet];
  const m = p?.moons?.[ref.moon ?? -1];
  if (!p || !m) return { periodDays: 0 };
  const sepR = Math.max(1, m.distance);
  return {
    a: sepR * m.radius * (6371 / 1.496e8),
    distanceR: sepR,
    locked: m.locked,
    periodDays: Math.max(0.01, moonPeriodDays(sepR, Math.max(0.2, p.radius), p.mass)),
  };
}

function nameOf(ref: BodyRef, opts: { names?: BodyNames | null; defaultNames?: { planets?: string[]; moons?: Record<number, string[]> } | null }): string {
  const custom = opts.names;
  const def = opts.defaultNames;
  if (ref.kind === 'planet') {
    const c = custom?.planets?.[String(ref.planet)];
    if (c) return c;
    return def?.planets?.[ref.planet] ?? `行星 ${ref.planet + 1}`;
  }
  const key = `${ref.planet}:${ref.moon}`;
  const c = custom?.moons?.[key];
  if (c) return c;
  return def?.moons?.[ref.planet]?.[ref.moon ?? 0] ?? `卫星 ${(ref.moon ?? 0) + 1}`;
}

/** 合成天体视图列表(界面唯一入口) */
export function buildBodyViews(
  sys: AstroSystem,
  opts: {
    /** 手动改名(存档里那份) */
    names?: BodyNames | null;
    /** 默认名(nameAstro 的结果;不传 = 只用改名,剩下兜底) */
    defaultNames?: { planets?: string[]; moons?: Record<number, string[]> } | null;
    /** 每天体的存档(取 civs) */
    bodies?: readonly SaveBody[] | null;
  } = {},
): BodyView[] {
  const out: BodyView[] = [];
  for (const ref of listBodies(sys)) {
    const f = fieldsOf(sys, ref);
    if (!f) continue;
    out.push({
      id: ref.id,
      kind: ref.kind,
      name: nameOf(ref, opts),
      typeLabel: f.typeLabel,
      bodyKind: f.bodyKind,
      radius: f.radius,
      mass: f.mass,
      tempK: f.tempK,
      hasRings: f.hasRings,
      parentId: ref.kind === 'moon' ? `p${ref.planet}` : undefined,
      alive: ref.alive,
      civs: bodyCivsOf(opts.bodies ?? undefined, ref.id),
      design: f.design,
      orbit: orbitOf(sys, ref),
    });
  }
  return out;
}

/** 单个天体视图(找不到 = null) */
export function bodyViewOf(sys: AstroSystem, id: string, opts: Parameters<typeof buildBodyViews>[1] = {}): BodyView | null {
  return buildBodyViews(sys, opts).find((b) => b.id === id) ?? null;
}

/** 文明上限(和存档一致) */
export { BODY_CIV_MAX };
