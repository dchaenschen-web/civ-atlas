/**
 * 星球系的名字:恒星、各行星、卫星、邻近恒星。
 *
 * 单独一个文件,因为名字库(12 语感)很大:只有星系页、编年史(天象)和导出设定集要它,
 * 生成流程(gen/world.ts → gen/astro.ts)不带这一份。
 *
 * 全部按种子取:同一个世界、同一套设计 → 同一批名字;换种子名字变,历史(如果没开天象)不变。
 */
import { subSeed } from './util';
import { createNamer } from './names';
import type { AstroSystem } from './astro';
import type { SystemOverrides } from './astroDesign';

export interface NamedAstro {
  /** 恒星名(西幻音译或中式意象,按恒星类型挑语感) */
  star: string;
  /** 和各行星一一对应 */
  planets: string[];
  /** 行星下标 → 卫星名 */
  moons: Record<number, string[]>;
  /** 邻近恒星名(只做星图关系) */
  nearby: string[];
}

/** 恒星用这几种语感里的音译名(听上去像星名,不像国名) */
const STAR_STYLES = ['imperial', 'hellenic', 'kingdom', 'nordic'];
/** 行星用地区名的语感:大多数世界是"偏真实"的中式与音译混排 */
const PLANET_STYLES = ['central', 'frontier', 'xianxia', 'mythic', 'imperial', 'kingdom', 'nordic', 'slavic', 'hellenic', 'desert', 'steppe', 'elven'];
/** 卫星用岛名 / 湖名的语感 */
const MOON_STYLES = ['central', 'xianxia', 'frontier', 'imperial', 'hellenic', 'nordic'];

/** 一种语感一个起名器(同一个世界里每样东西只用一个语感,名字才成套) */
function namers(seed: number, styles: string[], tag: string) {
  return styles.map((id) => createNamer(subSeed(seed, `astro-names:${tag}:${id}`), id));
}

/** 按种子从池子里挑一个(同一类东西在同一个世界用同一个语感) */
function pick(seed: number, tag: string, n: number): number {
  return subSeed(seed, `astro-pick:${tag}`) % Math.max(1, n);
}

/** 给整份星球系起名(seed = 世界的种子;名字只由种子决定,不吃星球系的数值,免得改倾角名字也跟着变) */
export function nameAstro(sys: AstroSystem, seed: number): NamedAstro {
  // 名字只由种子决定(不吃星球系的数值,免得改倾角名字也跟着变)
  const base = seed;
  const starNamer = namers(base, STAR_STYLES, 'star')[pick(base, 'star', STAR_STYLES.length)];
  const star = starNamer.keyed('state', 0, 0)().zh;
  const planetPool = namers(base, PLANET_STYLES, 'planet');
  const planets = sys.design.planets.map((p, i) => {
    const namer = planetPool[pick(base, 'planet' + i, planetPool.length)];
    return namer.keyed('region', i + 1, 0)().zh;
  });
  const moonPool = namers(base, MOON_STYLES, 'moon');
  const moons: Record<number, string[]> = {};
  sys.design.planets.forEach((p, i) => {
    if (!p.moons.length) return;
    const namer = moonPool[pick(base, 'moon' + i, moonPool.length)];
    moons[i] = p.moons.map((_m, k) => namer.keyed('mountain', i + 1, k + 1)().zh);
  });
  const nearbyNamer = namers(base, STAR_STYLES, 'nearby')[pick(base, 'nearby', STAR_STYLES.length)];
  const nearby = sys.design.nearby.map((_s, i) => nearbyNamer.keyed('state', 1, i + 1)().zh);
  return { star, planets, moons, nearby };
}

/** 名字长度上限(和存档层 cleanTitle 的上限一致) */
export function cleanBodyName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  const cs = [...s];
  return cs.length > 12 ? cs.slice(0, 12).join('') : s;
}

/**
 * 带上手动改名的名字(恒星 / 行星 / 卫星);没改的用按种子生成的那一套。
 * 纯函数:界面上凡是要显示星体名的地方都走这里,和存档里的 bodyNames 对得上。
 */
export function namedBodies(sys: AstroSystem, seed: number, overrides?: SystemOverrides | null): NamedAstro {
  const base = nameAstro(sys, seed);
  const bn = overrides?.bodyNames;
  if (!bn) return base;
  const star = cleanBodyName(bn.star) ?? base.star;
  const planets = base.planets.map((nm, i) => cleanBodyName(bn.planets?.[String(i)]) ?? nm);
  const moons: Record<number, string[]> = {};
  for (const p of Object.keys(base.moons)) moons[Number(p)] = base.moons[Number(p)].slice();
  const raw = bn.moons ?? {};
  for (const key of Object.keys(raw)) {
    const parts = key.split(':');
    if (parts.length !== 2) continue;
    const p = Number(parts[0]);
    const m = Number(parts[1]);
    const nm = cleanBodyName(raw[key]);
    if (!nm || !Number.isInteger(p) || !Number.isInteger(m) || p < 0 || m < 0) continue;
    const arr = (moons[p] ??= []);
    arr[m] = nm;
  }
  return { ...base, star, planets, moons };
}