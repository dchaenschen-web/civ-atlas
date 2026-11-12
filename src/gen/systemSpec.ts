/**
 * SystemSpec:星系的分层视图(目标树里的"星系 → 行星 → 卫星")。
 *
 * 只读、纯派生:从设计层(`AstroSystem.design`) + 作者覆盖表(`SystemOverrides`)拼出来,
 * 给界面当唯一的结构来源,不再让各处自己去 `design.planets[i]` + `overrides.planets.find(...)` 混着读。
 *
 * 注意:这一步**不改存档格式**;`parts/system.gz` 仍旧只写覆盖表(见 S1 的兼容底线)。
 */
import type { AstroSystem } from './astro';
import type { AstroDesign, BodyGen, MoonDesign, PlanetDesign, SurfaceOverride, SystemOverrides } from './astroDesign';
import type { TerrainOp } from './edits';
import type { WorldParams } from './params';
import { beltsOf, type BeltDesign } from './system';
import { moonPeriodDaysOf, periodDaysOf } from './orbitTime';

export interface OrbitalSpec {
  /** 半长轴(AU;卫星这里是母行星半径数) */
  a: number;
  ecc: number;
  incDeg: number;
  nodeDeg: number;
  /** 公转周期(天;开普勒导出或覆盖表覆盖) */
  periodDays: number;
}

export interface PhysicalSpec {
  /** 质量(M⊕;卫星也是 M⊕) */
  mass: number;
  radius: number;
  /** 自转倾角(度) */
  tilt: number;
  /** 一天多少小时 */
  rotation: number;
  /** 有生物圈 / 无生命 / 按种子(覆盖表口径) */
  life: number;
  geo: number;
  mag: number;
}

export interface MoonSpec {
  planet: number;
  moon: number;
  design: MoonDesign;
  /** 离母星(母行星半径数) */
  distance: number;
  radius: number;
  /** 绕母行星周期(天) */
  periodDays: number;
  locked: boolean;
  surface?: SurfaceOverride;
  /** 这颗卫星自己的生成参数 */
  gen?: BodyGen;
  terrain: TerrainOp[];
}

export interface BodySpec {
  index: number;
  /** 这颗天体在星系里的角色:主行星 / 伴星 / 宜居卫星 / 普通行星 */
  role: 'home' | 'companion' | 'habitableMoon' | 'planet';
  design: PlanetDesign;
  orbit: OrbitalSpec;
  physical: PhysicalSpec;
  /** 这颗行星自己的地表参数(不写 = 按温度/相态自动) */
  surface?: SurfaceOverride;
  /** 这颗行星自己的生成参数(板块/造山/气候/精度/种子/生成方式) */
  gen?: BodyGen;
  /** 这颗行星自己的地形修改 */
  terrain: TerrainOp[];
  moons: MoonSpec[];
}

/** 递归树节点(星系 → 行星 → 卫星;深度 ≤3,给树页直接用) */
export interface SystemNode {
  kind: 'star' | 'planet' | 'moon';
  /** 稳定 id:star / p0 / p0m1 */
  id: string;
  /** 显示名(由界面用 names 填) */
  label: string;
  physical: { mass: number; radius: number; tempK?: number };
  orbit?: OrbitalSpec;
  children: SystemNode[];
}

export interface SystemSpec {
  star: AstroDesign['star'];
  /** 构型 0 单星 / 1 双固态行星 / 2 双恒星 / 3 气态巨星的宜居卫星 */
  arch: number;
  /** 小行星带 */
  belts: BeltDesign[];
  /** 撞击频率参数(0 关 / 1 自然 / 2 频繁) */
  impact: number;
  /** 主行星在 planets 里的下标 */
  home: number;
  planets: BodySpec[];
  binary?: AstroDesign['binary'];
  binaryStar?: AstroDesign['binaryStar'];
  habitableMoon?: AstroDesign['habitableMoon'];
  /** 递归树(只读视图;左树直接用) */
  tree: SystemNode;
}

function terrainOf(list: readonly { terrain?: readonly unknown[] }[] | undefined, match: (x: { terrain?: readonly unknown[] }) => boolean): TerrainOp[] {
  const hit = list?.find(match);
  return (hit?.terrain as TerrainOp[] | undefined) ?? [];
}

/** 组装一棵 SystemSpec(纯读;设计层 + 覆盖表都只读不写) */
export function systemSpecOf(sys: AstroSystem, params: WorldParams, overrides?: SystemOverrides | null): SystemSpec {
  const design = sys.design;
  const ov = overrides ?? null;
  const starMass = Math.max(0.01, design.star.mass);
  const planets: BodySpec[] = design.planets.map((p, index) => {
    const o = ov?.planets.find((x) => x.index === index);
    const role: BodySpec['role'] =
      index === design.home.index ? 'home' : design.binary?.index === index ? 'companion' : design.habitableMoon?.index === index ? 'habitableMoon' : 'planet';
    const planetPeriod = o?.periodDays && o.periodDays > 0 ? o.periodDays : periodDaysOf(p.a, starMass);
    return {
      index,
      role,
      design: p,
      orbit: { a: p.a, ecc: p.ecc, incDeg: p.incDeg, nodeDeg: p.nodeDeg, periodDays: planetPeriod },
      physical: {
        mass: p.mass,
        radius: p.radius,
        tilt: p.tilt,
        rotation: p.rotation,
        life: o?.life ?? 0,
        geo: p.geoActivity,
        mag: p.magnetic,
      },
      surface: o?.surface,
      gen: o?.gen,
      terrain: terrainOf(ov?.planets, (x) => (x as { index?: number }).index === index),
      moons: p.moons.map((m, moon) => {
        const mo = ov?.moons.find((x) => x.planet === index && x.moon === moon);
        const moonPeriod = mo?.periodDays && mo.periodDays > 0 ? mo.periodDays : moonPeriodDaysOf(m.distance, p.radius, p.mass);
        return {
          planet: index,
          moon,
          design: m,
          distance: m.distance,
          radius: m.radius,
          periodDays: moonPeriod,
          locked: m.locked,
          surface: mo?.surface,
          gen: mo?.gen,
          terrain: terrainOf(ov?.moons, (x) => (x as { planet?: number; moon?: number }).planet === index && (x as { moon?: number }).moon === moon),
        };
      }),
    };
  });
  const tree: SystemNode = {
    kind: 'star',
    id: 'star',
    label: design.star.label,
    physical: { mass: design.star.mass, radius: 1, tempK: design.star.temp },
    children: planets.map((b) => ({
      kind: 'planet' as const,
      id: 'p' + b.index,
      label: '',
      physical: { mass: b.design.mass, radius: b.design.radius, tempK: b.design.tempK },
      orbit: b.orbit,
      children: b.moons.map((m) => ({
        kind: 'moon' as const,
        id: 'p' + b.index + 'm' + m.moon,
        label: '',
        physical: { mass: m.design.mass, radius: m.radius },
        orbit: { a: m.distance, ecc: 0, incDeg: 0, nodeDeg: 0, periodDays: m.periodDays },
        children: [],
      })),
    })),
  };
  return {
    star: design.star,
    arch: design.arch,
    belts: beltsOf(design, params.seed, params.impact),
    impact: params.impact,
    home: design.home.index,
    planets,
    binary: design.binary,
    binaryStar: design.binaryStar,
    habitableMoon: design.habitableMoon,
    tree,
  };
}
