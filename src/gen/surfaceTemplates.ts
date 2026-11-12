/**
 * 地表模板：一键套到任意固态行星 / 卫星。
 *
 * 模板只给「地表生成口径」（陆地比例/气温偏移/降雨倍率/精度），
 * 另外写明这块地表上的物质以什么状态存在，套用时按该天体实际温度/气压
 * 用 materials.phasesOf 复核，不匹配就给提示（如把海洋型套到 200 K 的天体上）。
 */
import type { BodyGen, SurfaceOverride } from './astroDesign';
import { phasesOf, type MaterialPhases } from './materials';

export type SurfaceTemplateId = 'earth' | 'ocean' | 'arid' | 'ice' | 'volcanic' | 'barren' | 'airless';

export interface SurfaceTemplate {
  id: SurfaceTemplateId;
  label: string;
  /** 套用时合并进 SurfaceOverride */
  surface: SurfaceOverride;
  /** 需要大气才成立（套到无大气天体上要提示/降级） */
  needsAtmosphere: boolean;
  /** 大致适用的温度范围 K */
  tempRangeK: [number, number];
  /** 地表物质状态说明（界面上直接显示） */
  materialNote: string;
}

export const SURFACE_TEMPLATES: SurfaceTemplate[] = [
  {
    id: 'earth',
    label: '地球型',
    surface: { landFraction: 0.29, temperature: 0, rainfall: 1, cells: 36000 },
    needsAtmosphere: true,
    tempRangeK: [250, 330],
    materialNote: '液态水（海/湖/河）+ N₂/O₂ 大气；可呼吸',
  },
  {
    id: 'ocean',
    label: '海洋型',
    surface: { landFraction: 0.06, temperature: 4, rainfall: 1.6, cells: 36000 },
    needsAtmosphere: true,
    tempRangeK: [270, 350],
    materialNote: '几乎全海，液态水；水汽循环强',
  },
  {
    id: 'arid',
    label: '干旱型',
    surface: { landFraction: 0.82, temperature: 12, rainfall: 0.22, cells: 36000 },
    needsAtmosphere: true,
    tempRangeK: [230, 340],
    materialNote: '陆地为主，少量液态水/盐湖；CO₂ 气为主',
  },
  {
    id: 'ice',
    label: '冰封型',
    surface: { landFraction: 0.55, temperature: -32, rainfall: 0.3, cells: 36000 },
    needsAtmosphere: true,
    tempRangeK: [60, 273],
    materialNote: '水以冰/雪存在（极区干冰）；稀薄 N₂ 气；液态水几乎没有',
  },
  {
    id: 'volcanic',
    label: '火山型',
    surface: { landFraction: 0.92, temperature: 38, rainfall: 0.05, cells: 36000 },
    needsAtmosphere: true,
    tempRangeK: [300, 1200],
    materialNote: '无液态水；硫化物熔体/熔岩，SO₂ 气；地表多火山口',
  },
  {
    id: 'barren',
    label: '荒芜型',
    surface: { landFraction: 0.95, temperature: -25, rainfall: 0.02, cells: 24000 },
    needsAtmosphere: false,
    tempRangeK: [60, 400],
    materialNote: '无水无冰，岩石尘埃；大气近真空，昼夜温差大',
  },
  {
    id: 'airless',
    label: '无大气型',
    surface: { landFraction: 1, temperature: -20, rainfall: 0, cells: 24000 },
    needsAtmosphere: false,
    tempRangeK: [40, 500],
    materialNote: '无大气、无水无冰；CO₂ 只能以极区固体存在；昼夜温差极大、保留陨击坑',
  },
];

export function surfaceTemplateOf(id: SurfaceTemplateId): SurfaceTemplate | undefined {
  return SURFACE_TEMPLATES.find((t) => t.id === id);
}

/** 把模板合并进现有地表参数（只覆盖模板里给了的项） */
export function applySurfaceTemplate(base: SurfaceOverride | undefined, id: SurfaceTemplateId): SurfaceOverride {
  const tpl = surfaceTemplateOf(id);
  if (!tpl) return { ...(base ?? {}) };
  return { ...(base ?? {}), ...tpl.surface };
}

/**
 * 模板和一颗天体的实际温度/气压是否相容：
 * 返回 true = 直接可用；false = 需要提示（例如冰封型套到 400 K 天体：
 * 水会是蒸汽，模板的"冰"不成立）。
 */
export function templateFits(
  id: SurfaceTemplateId,
  tempK: number,
  pressure: number,
  opts: { hasWater?: boolean } = {},
): { fits: boolean; phases: MaterialPhases; reason?: string } {
  const tpl = surfaceTemplateOf(id);
  const phases = phasesOf(tempK, pressure, opts);
  if (!tpl) return { fits: false, phases, reason: '没有这个模板' };
  const [lo, hi] = tpl.tempRangeK;
  if (tempK < lo || tempK > hi) return { fits: false, phases, reason: `温度 ${Math.round(tempK)} K 超出模板范围 ${lo}–${hi} K` };
  if (tpl.needsAtmosphere && pressure < 0.05) return { fits: false, phases, reason: '需要大气，但这颗天体气压太低' };
  if ((id === 'earth' || id === 'ocean') && phases.water !== 'liquid') return { fits: false, phases, reason: '模板要求液态水，这颗天体上的水不是液态' };
  if (id === 'ice' && phases.water === 'vapor') return { fits: false, phases, reason: '模板要求冰，但这颗天体太热，水是蒸汽' };
  return { fits: true, phases };
}
/** 模板的完整形态：生成参数 + 物理/生命 + 地表参数（一键套用） */
export interface BodyTemplate {
  surface: SurfaceTemplate;
  gen: BodyGen;
  physical: { mass?: number; radius?: number; life?: number };
}

const BODY_EXTRA: Record<SurfaceTemplateId, { gen: BodyGen; physical: BodyTemplate['physical'] }> = {
  earth: { gen: { plates: 36, mountains: 1.2, water: true }, physical: { mass: 1, radius: 1, life: 1 } },
  ocean: { gen: { plates: 28, mountains: 0.8, water: true }, physical: { mass: 1.1, radius: 1.05, life: 1 } },
  arid: { gen: { plates: 22, mountains: 1.6, water: true }, physical: { mass: 0.7, radius: 0.85, life: 2 } },
  ice: { gen: { plates: 18, mountains: 1.2, water: true }, physical: { mass: 0.6, radius: 0.8, life: 2 } },
  volcanic: { gen: { plates: 48, mountains: 4.2, water: false }, physical: { mass: 0.9, radius: 0.9, life: 2 } },
  barren: { gen: { plates: 8, mountains: 0.5, water: false }, physical: { mass: 0.3, radius: 0.6, life: 2 } },
  airless: { gen: { plates: 6, mountains: 0.4, water: false }, physical: { mass: 0.2, radius: 0.55, life: 2 } },
};

/** 所有模板的完整形态（地表 + 生成参数 + 物理/生命） */
export const BODY_TEMPLATES: BodyTemplate[] = SURFACE_TEMPLATES.map((s) => ({ surface: s, ...BODY_EXTRA[s.id] }));

export function bodyTemplateOf(id: SurfaceTemplateId): BodyTemplate | undefined {
  return BODY_TEMPLATES.find((t) => t.surface.id === id);
}

/**
 * 一键套用模板：返回要写进覆盖表的 surface + gen + 物理字段。
 * base 传入当前值（保留模板没给的部分）。
 */
export function applyBodyTemplate(
  id: SurfaceTemplateId,
  baseSurface?: SurfaceOverride,
  baseGen?: BodyGen,
): { surface: SurfaceOverride; gen: BodyGen; physical: BodyTemplate['physical'] } | null {
  const t = bodyTemplateOf(id);
  if (!t) return null;
  return {
    surface: { ...(baseSurface ?? {}), ...t.surface.surface },
    gen: { ...(baseGen ?? {}), ...t.gen },
    physical: t.physical,
  };
}