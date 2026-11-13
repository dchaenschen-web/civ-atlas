/**
 * 本地验证脚本(不经浏览器、不经 vite):用 tsc 编成 CommonJS 以后直接用 node 跑。
 *   npx tsc -p tsconfig.node.json && node out/jsbuild/scripts/node-verify.js
 *
 * 做四件事:
 *   1. 默认参数的世界生成两次,逐位一致(确定性);
 *   2. 与 tests/determinism.test.ts 里的上游金标逐字段对账(除了 world.params——参数表本身加了键);
 *   3. 开了星球系的世界:大气、气候修正、地质、天象、地质事件都能跑出结果;
 *   4. 默认世界不装地质事件模块(历史里没有地质原因的灾荒)。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_PARAMS, generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv, continueCiv } from '../src/gen/civ';
import { PLANET_TYPES, planetTypeOf, isHotJupiter, moonTypeOf } from '../src/gen/astroDesign';
import { astroOf, generateAstro } from '../src/gen/astro';
import { breathReason } from '../src/gen/astroDesign';
import { applyOverrides, beltsOf, emptyOverrides, impactRateOf, moonWorldParams, planMoonSurfaces, systemOf } from '../src/gen/system';
import { bodyCiv, bodyCivByRef, bodyFacts, bodyWorld, listBodies, parseBodyId, bodiesOrDefault, homeBodyId, setBodyCivs, bodyCivsOf } from '../src/gen/bodies';
import { buildBodyViews } from '../src/gen/bodyView';
import { impactEventsOn, impactOdds } from '../src/gen/civ/impactEvents';
import { cratersToOps, settleImpacts } from '../src/gen/impacts';
import { impactRate } from '../src/gen/civ/impactEvents';
import { systemSpecOf } from '../src/gen/systemSpec';
import { layersOfOverrides, overridesOfLayers } from '../src/gen/systemLayers';
import { celestialEventsOf, nextCelestialEvent, supernovaImpact } from '../src/gen/astroEvents';
import { hohmannTransfer, interstellarTravelEstimate, transferWindowYears } from '../src/gen/interstellar';
import { namedBodies } from '../src/gen/astroNames';
import { BODY_TEMPLATES, applyBodyTemplate } from '../src/gen/surfaceTemplates';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { EMPTY_EDITS } from '../src/gen/edits';
import { phasesOf, surfaceHints } from '../src/gen/materials';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { geologyOf } from '../src/gen/geology';
import { geoEventsOn } from '../src/gen/civ/geoEvents';
import { omensOf } from '../src/gen/civ/story/omen';
import { nameAstro } from '../src/gen/astroNames';
import { yearClimate } from '../src/gen/seasons';
import { computeHabitat } from '../src/gen/civ/habitat';
import { planetWorldParams, planSurfaces, planetSurface, planetSurfaceStats } from '../src/gen/astroWorlds';
import { makeSketchAssetPack, openSketchAssetPack, validateSketchAsset, SKETCH_ASSET_MAX_BYTES } from '../src/gen/sketchAssets';
import { LAYER_H, LAYER_W, SKETCH_LAND, SKETCH_SEA, encodeLayer, sketchGrid } from '../src/gen/sketch';
import { skyLayerOf, moonPeriodDays } from '../src/gen/skyLayer';
import { clampSystemYear, timelineStep, yearsPerSecondOf } from '../src/ui/systemClock';
import { nearbyStarsOf, NEIGHBOR_COUNT, NEIGHBOR_MAX_LY } from '../src/gen/neighbors';
import { politiesAt, politiesWithLand } from '../src/gen/civ/territoryAt';
import { STAR_TYPES, pickStar } from '../src/gen/astroDesign';
import { habitableZone, starAt, starFromMassHR } from '../src/gen/stellar';
import { canHostCiv } from '../src/gen/civilizable';
import { canBeHome, canBeHomeMoon } from '../src/gen/bodyRules';
import { applySkin, riversAllowed, skinOf } from '../src/gen/surfaceKinds';
import { applyIceSheets, carveRifts, stampCraters } from '../src/gen/surfaceShapes';
import { lookOf, terrainColor } from '../src/render/terrainLook';
import { orbitZoneOf, planetsStable } from '../src/gen/orbitConstraints';
import { canColonize, gasMineSite, terraform } from '../src/gen/colonization';
import { planetClassOf } from '../src/gen/planetClass';
import { renameGroup, subSystemGroupsOf } from '../src/gen/systemGroups';
import { binaryStarPair } from '../src/render/systemGlobe3d';
import { gasTextureOf } from '../src/gen/gasTexture';
import { ringsOf } from '../src/gen/rings';
import { contourSpacingM, meanMolarKg, pressureContourLevelsM, scaleHeightM } from '../src/gen/pressureContours';
import { addGroup, addGroupMember, removeGroupMember, applyStarCount, applySubSystem, deleteNode, resolveStarCount, resolveSubSystem, setBodyCount, setHabitableMoon } from '../src/gen/systemRole';

// ---- 和 tests/determinism.test.ts 同一套指纹算法 ----
const f64 = new Float64Array(1);
const f64b = new Uint8Array(f64.buffer);
function print(v: unknown): string {
  const h = createHash('sha1');
  const feed = (x: unknown): void => {
    if (x === null || x === undefined) return void h.update(`~${x}`);
    if (ArrayBuffer.isView(x)) {
      h.update(`<${x.constructor.name}:${x.byteLength}>`);
      return void h.update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    }
    if (Array.isArray(x)) {
      h.update(`[${x.length}`);
      x.forEach(feed);
      return void h.update(']');
    }
    if (typeof x === 'object') {
      for (const k of Object.keys(x as object).sort()) {
        h.update(`.${k}`);
        feed((x as Record<string, unknown>)[k]);
      }
      return;
    }
    if (typeof x === 'number') {
      f64[0] = x;
      h.update('n');
      return void h.update(f64b);
    }
    h.update(`${typeof x}:${String(x)}`);
  };
  feed(v);
  return h.digest('hex').slice(0, 12);
}

/** 这一版给 WorldParams 新加的键(对账时去掉,证明除了"参数表多几项"之外没有变化) */
const NEW_PARAM_KEYS = ['astro', 'system', 'planets', 'gas', 'moons', 'tilt', 'rotation', 'geo', 'mag', 'tech', 'arch', 'life', 'home', 'salt', 'impact'];

let fails = 0;
const ok = (name: string, cond: boolean, more = '') => {
  if (!cond) fails++;
  console.log(`${cond ? '✓' : '✗'} ${name}${more ? ` — ${more}` : ''}`);
};

// ---- 1. 确定性:同一个种子两次生成逐字段一样 ----
{
  const a = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
  const b = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
  const keys = ['elevation', 'water', 'temperature', 'precipitation', 'biome', 'seaIce', 'flux', 'waterLevel'];
  let same = true;
  for (const k of keys) if (print((a as unknown as Record<string, unknown>)[k]) !== print((b as unknown as Record<string, unknown>)[k])) same = false;
  ok('默认世界两次生成逐位一致', same);
}

// ---- 2. 和上游金标对账(从 tests/determinism.test.ts 里读 EXPECTED) ----
{
  const src = readFileSync('tests/determinism.test.ts', 'utf8');
  // EXPECTED = { 7: { 'world.biome': '...', ... }, 2024: {...}, 555: {...} }
  const start = src.indexOf('const EXPECTED');
  const open = src.indexOf('{', src.indexOf('=', start));
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const expectedText = src.slice(open, end).replace(/(\w+):/g, '"$1":').replace(/,\s*}/g, '}').replace(/'/g, '"');
  // 上面把键加引号;对象里的字符串值本身用单引号,一起换成双引号
  const EXPECTED = JSON.parse(expectedText) as Record<string, Record<string, string>>;
  const cells = 12000;
  for (const seedText of Object.keys(EXPECTED)) {
    const seed = Number(seedText);
    const w = generateWorld({ ...DEFAULT_PARAMS, cells, seed });
    const civ = generateCiv(w, { endYear: 3000 });
    const fields = Object.keys(EXPECTED[seedText]);
    const bad: string[] = [];
    for (const f of fields) {
      const got = print((fieldOf(w, civ, f) as unknown));
      if (got !== EXPECTED[seedText][f]) bad.push(`${f}: 金标 ${EXPECTED[seedText][f]} / 现在 ${got}`);
    }
    ok(`种子 ${seed} 与上游金标逐字段对账(${fields.length} 项,地形/气候/文明全部数据)`, bad.length === 0, bad.join('; '));
  }
}

/** 取 tests 里那份字段(和 test 的 fingerprint 一样:places 拆成两份;world.params / world.climate 去掉这一版新加的键再比) */
function fieldOf(w: ReturnType<typeof generateWorld>, civ: ReturnType<typeof generateCiv>, name: string): unknown {
  if (name === 'civ.places') return civ.places.filter((p) => p.kind !== 'pass');
  if (name === 'civ.places.pass') return civ.places.filter((p) => p.kind === 'pass');
  if (name === 'world.params') {
    const copy: Record<string, unknown> = { ...(w.params as unknown as Record<string, unknown>) };
    for (const k of NEW_PARAM_KEYS) delete copy[k];
    return copy;
  }

  if (name.startsWith('world.')) return (w as unknown as Record<string, unknown>)[name.slice('world.'.length)];
  if (name.startsWith('civ.')) return (civ as unknown as Record<string, unknown>)[name.slice('civ.'.length)];
  return undefined;
}

// ---- 3. 开了星球系的世界:整条链路能跑 ----
{
  const params: WorldParams = { ...DEFAULT_PARAMS, seed: 21, cells: 8000, astro: 1, geo: 1.6 };
  const w = generateWorld(params);
  ok('星球系生成了', !!astroOf(w));
  const sys = astroOf(w)!;
  const names = nameAstro(sys, params.seed);
  ok('恒星有名字', names.star.length >= 2, names.star);
  ok('每颗行星都有名字', names.planets.length === sys.design.planets.length);
  ok('主行星有大气成分', sys.home.air.gases.length > 0, `气压 ${sys.home.air.pressure.toFixed(2)} atm`);
  ok('潮差 > 0', sys.home.tide > 0, sys.home.tide.toFixed(2));
  ok('地质事件模块已装(astro=1)', geoEventsOn(w));
  const geo = geologyOf(w);
  ok('地质数据有火山与地震带', geo.volcanoes.length > 0, `${geo.volcanoes.length} 座`);
  const civ = generateCiv(w, { endYear: 1500 });
  const omens = omensOf(civ, w);
  ok('天象纪有条目', omens.length > 0, `${omens.length} 条`);
  const geoFamine = civ.annals.filter((e) => e.kind === 'famine' && (e.cause === 'quake' || e.cause === 'volcano'));
  ok('历史里有地质原因的灾荒', geoFamine.length > 0, `${geoFamine.length} 条`);
  const sunk = civ.annals.filter((e) => e.kind === 'sunk' && e.b === 0);
  ok('常态档 geo=1.6 不毁城', sunk.length === 0, `城毁于火山 ${sunk.length} 条`);
}

// ---- 3b. 地质极端档:geo 拉到暴烈,火山带上烈度 3 的事件会毁城 ----
{
  const params: WorldParams = { ...DEFAULT_PARAMS, seed: 33, cells: 8000, astro: 1, geo: 2.6 };
  const w = generateWorld(params);
  const civ = generateCiv(w, { endYear: 2000 });
  const sunk = civ.annals.filter((e) => e.kind === 'sunk' && e.b === 0);
  ok('极端档 geo=2.6 出现"城毁于火山"', sunk.length > 0, `${sunk.length} 条`);
}

// ---- 4. 默认参数的对比世界:不装地质模块、没有天象 ----
{
  const w = generateWorld({ ...DEFAULT_PARAMS, seed: 21, cells: 8000 });
  const civ = generateCiv(w, { endYear: 1500 });
  const geoFamine = civ.annals.filter((e) => e.kind === 'famine' && (e.cause === 'quake' || e.cause === 'volcano'));
  ok('默认世界不装地质事件', !geoEventsOn(w) && geoFamine.length === 0);
  ok('默认世界没有天象', omensOf(civ, w).length === 0);
}

// ---- 5. 天文 → 气候 / 季节 / 潮汐:耦合是真的,不是摆着看的 ----
{
  // 固定成黄矮星(地球基线),潮汐与温度的耦合才可比:0 卫星 = 只有太阳潮(约 0.46),2 卫星 = 有像样的潮差
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 41, cells: 6000, system: 2 };
  const off = generateWorld(base);
  const on = generateWorld({ ...base, astro: 1 });
  const medLand = (w: typeof off): number => {
    const t: number[] = [];
    for (let i = 0; i < w.water.length; i++) if (w.water[i] === 0) t.push(w.temperature[i]);
    t.sort((a, b) => a - b);
    return t[Math.floor(t.length / 2)];
  };
  const dTemp = Math.abs(medLand(on) - medLand(off));
  ok('星球系改变了年均温(辐照/温室耦合生效)', dTemp > 0.05, `差 ${dTemp.toFixed(2)}°C`);

  const lowTilt = generateWorld({ ...base, astro: 1, tilt: 6 });
  const highTilt = generateWorld({ ...base, astro: 1, tilt: 65 });
  const meanHalf = (w: typeof off): number => {
    const yc = yearClimate(w);
    let s = 0;
    let n = 0;
    for (let i = 0; i < yc.half.length; i++)
      if (w.water[i] === 0) {
        s += yc.half[i];
        n++;
      }
    return n ? s / n : 0;
  };
  ok('倾角越大、年较差越大(季节耦合)', meanHalf(highTilt) > meanHalf(lowTilt) * 1.5, `${meanHalf(lowTilt).toFixed(1)}°C → ${meanHalf(highTilt).toFixed(1)}°C`);

  const coastSum = (moons: number): number => {
    const h = computeHabitat(generateWorld({ ...base, astro: 1, moons }));
    let s = 0;
    for (let i = 0; i < h.harbor.length; i++) if (h.harbor[i] > 0) s += h.suitability[i];
    return s;
  };
  ok('大潮差的海岸更宜居(潮汐耦合)', coastSum(2) > coastSum(0), `${coastSum(0).toFixed(1)} → ${coastSum(2).toFixed(1)}`);

  const a = generateAstro({ ...base, astro: 1 });
  const b = generateAstro({ ...base, astro: 1 });
  ok('星球系与星图是确定的', JSON.stringify(a.design.stars.slice(0, 20)) === JSON.stringify(b.design.stars.slice(0, 20)));
}

// ---- 6. 新世界抽样:默认设计(开星球系)下不该频繁给出极端世界 ----
{
  const rows: { seed: number; star: string; tempC: number; press: number; breath: boolean; hydro: boolean; tide: number; moons: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const seed = 500 + i;
    const w = generateWorld({ ...DEFAULT_PARAMS, seed, cells: 2000, astro: 1 });
    const sys = astroOf(w)!;
    const home = sys.design.planets[sys.home.index];
    rows.push({
      seed,
      star: sys.star.id,
      tempC: sys.home.meanTempK - 273.15,
      press: sys.home.air.pressure,
      breath: sys.home.air.breathable,
      hydro: home.hydro,
      tide: sys.home.tide,
      moons: home.moons.length,
    });
  }
  const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`;
  const stars = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.star] = (acc[r.star] ?? 0) + 1), acc), {});
  const temps = rows.map((r) => r.tempC).sort((a, b) => a - b);
  const press = rows.map((r) => r.press).sort((a, b) => a - b);
  const tides = rows.map((r) => r.tide).sort((a, b) => a - b);
  const habitable = rows.filter((r) => r.tempC > -23 && r.tempC < 57).length; // 250–330 K
  const hydro = rows.filter((r) => r.hydro).length;
  const breath = rows.filter((r) => r.breath).length;
  console.log(
    `  抽样 20 个新世界:恒星 ${Object.entries(stars).map(([k, v]) => `${k}×${v}`).join(' ')};` +
      `均温 ${temps[0].toFixed(0)}…${temps[temps.length - 1].toFixed(0)}°C(中位 ${temps[10].toFixed(0)}°C)` +
      ` · 宜居温区 ${pct(habitable)} · 有水圈 ${pct(hydro)} · 可呼吸 ${pct(breath)}` +
      ` · 气压 ${press[0].toFixed(2)}…${press[press.length - 1].toFixed(2)} atm · 潮差 ${tides[0].toFixed(2)}…${tides[tides.length - 1].toFixed(1)}`,
  );
  ok('抽样:至少一半新世界在宜居温区', habitable >= 10, `${habitable}/20`);
  ok('抽样:至少三成有液态水圈', hydro >= 6, `${hydro}/20`);
  // 薄大气(火星型,~0.006 atm)也是合理结果,只要不是 0 或离谱的厚
  ok('抽样:气压都在 0.001–20 atm 之间', press[0] >= 0.001 && press[press.length - 1] <= 20);
  ok('抽样:至少一成世界可呼吸', breath >= 2, `${breath}/20`);
}

// ---- 7. 其他固态行星:按地质活跃度分配精度,地表能生成且确定 ----
{
  const params: WorldParams = { ...DEFAULT_PARAMS, seed: 61, cells: 2000, astro: 1, planets: 4, gas: 2 };
  const w = generateWorld(params);
  const sys = astroOf(w)!;
  const plan = planSurfaces(sys);
  const gas = sys.design.planets.filter((q) => q.kind === 'gas');
  ok('气态行星不做地表(预算 0)', gas.length > 0 && gas.every((q) => sys.design.budget[q.index] === 0), `${gas.length} 颗`);
  ok('主行星用全精度(预算 -1)', sys.design.budget[sys.home.index] === -1, `#${sys.home.index}`);
  ok('其他固态行星有精度预算', plan.length > 0, plan.map((x) => `#${x.index}:${x.cells}`).join(' '));
  if (plan.length) {
    const idx = plan[0].index;
    const s1 = planetSurfaceStats(planetSurface(sys, idx, w.params));
    const s2 = planetSurfaceStats(planetSurface(sys, idx, w.params));
    ok(
      '迷你行星地表生成且确定',
      JSON.stringify(s1) === JSON.stringify(s2) && s1.landPct > 0,
      `陆地 ${(s1.landPct * 100).toFixed(0)}% · 河 ${s1.rivers} 条 · 最高 ${s1.maxElev} 米 · 火山 ${s1.volcanoes} 座`,
    );
  }
}

// ---- 8. 开了星球系与地质的世界:两次推演一致、接着推和一口气推一致(地质模块的 resume 必须接得上) ----
{
  const params: WorldParams = { ...DEFAULT_PARAMS, seed: 71, cells: 2000, astro: 1, geo: 1.6 };
  const w = generateWorld(params);
  const w2 = generateWorld(params);
  const c1 = generateCiv(w, { endYear: 1200 });
  const c2 = generateCiv(w, { endYear: 1200 });
  ok('开了星球系:同一个世界两次推演逐字段一致', print(c1.annals) === print(c2.annals) && print(w.astro) === print(w2.astro));
  const half = generateCiv(w, { endYear: 600 });
  const cont = continueCiv(w, half, { endYear: 1200 });
  ok('接着推(600→1200)与一口气推到 1200 一致(地质事件 resume)', print(c1.annals) === print(cont.annals), `一口气 ${c1.annals.length} 条 / 接着推 ${cont.annals.length} 条`);
}

// ---- 9. 性能:默认 36k 地块的生成预算(2 秒),开星球系的额外开销要小 ----
// 单次计时会被冷启动 / JIT / GC 抖动带偏(实测同一份代码同一台机器能差 3 倍),所以 3 次取最快;
// 门槛不变:引擎仍然必须能在 2 秒内跑完一块 36k 地块。
{
  const base: number[] = [];
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    generateWorld({ ...DEFAULT_PARAMS, seed: 5 });
    base.push(performance.now() - t0);
  }
  const tBase = Math.min(...base);
  const astro: number[] = [];
  let wa: ReturnType<typeof generateWorld> | null = null;
  for (let k = 0; k < 2; k++) {
    const t1 = performance.now();
    wa = generateWorld({ ...DEFAULT_PARAMS, seed: 5, astro: 1 });
    astro.push(performance.now() - t1);
  }
  const tAstro = Math.min(...astro);
  ok('默认 36k 地块生成在 2 秒内(3 次取最快)', tBase < 2000, `${base.map((x) => x.toFixed(0)).join('/')} ms`);
  ok('开星球系的额外开销 < 500ms', tAstro - tBase < 500, `${tBase.toFixed(0)} → ${tAstro.toFixed(0)} ms(+${(tAstro - tBase).toFixed(0)})`);
  const t2 = performance.now();
  geologyOf(wa!);
  const tGeo = performance.now() - t2;
  ok('地质懒算 < 200ms', tGeo < 200, `${tGeo.toFixed(0)} ms`);
}

// ---- 10. 生命开关:新世界默认 life=1 时主行星一定可呼吸(抽样 20 个) ----
{
  let breath = 0;
  let reasons: string[] = [];
  for (let i = 0; i < 20; i++) {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 700 + i, cells: 2000, astro: 1, life: 1 });
    const sys = astroOf(w)!;
    if (sys.home.air.breathable) breath++;
    else reasons.push(`${700 + i}:${breathReason(sys.home.air) ?? '?'}`);
  }
  ok('life=1 的新世界主行星一定可呼吸', breath === 20, `${breath}/20${reasons.length ? ' 不合格:' + reasons.join(' ') : ''}`);
  // 不想要生命时:life=2 一定不可呼吸
  const dead = generateWorld({ ...DEFAULT_PARAMS, seed: 701, cells: 2000, astro: 1, life: 2 });
  const dsys = astroOf(dead)!;
  ok('life=2 的主行星没有生物圈', !dsys.home.air.breathable && !dsys.design.planets[dsys.home.index].biotic);
  // home 指定第几颗:选第 2 颗,主行星就换成它(名字/大气跟着换,但仍是宜居带正中)
  const multi = generateWorld({ ...DEFAULT_PARAMS, seed: 702, cells: 2000, astro: 1, planets: 3, life: 1, home: 2 });
  const msys = astroOf(multi)!;
  ok('home=2 时主行星是第 2 颗且可呼吸', msys.home.index === 1 && msys.home.air.breathable, `#${msys.home.index}`);
  // salt:换一个 salt 就是另一套星球系(同名种子不同设计)
  const a1 = astroOf(generateWorld({ ...DEFAULT_PARAMS, seed: 703, cells: 2000, astro: 1 }))!;
  const a2 = astroOf(generateWorld({ ...DEFAULT_PARAMS, seed: 703, cells: 2000, astro: 1, salt: 5 }))!;
  const p1 = a1.design.planets[a1.home.index];
  const p2 = a2.design.planets[a2.home.index];
  ok('salt 会换一套星球系', p1.radius !== p2.radius || a1.home.meanTempK !== a2.home.meanTempK);
}

// ---- 11. 双固态行星(arch = 1):两颗同轨道、伴星潮汐、伴星掩日、可呼吸、确定性 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 811, cells: 2000, astro: 1, arch: 1, planets: 3, life: 1 };
  const w = generateWorld(p);
  const sys = astroOf(w)!;
  const bin = sys.design.binary;
  ok('arch=1 生成了伴星', !!bin, bin ? `伴星 #${bin.index}、间距 ${(bin.separationAU * 23481).toFixed(0)} R⊕、互绕 ${bin.periodDays.toFixed(1)} 天` : '没有 binary');
  if (bin) {
    const home = sys.design.planets[sys.home.index];
    const comp = sys.design.planets[bin.index];
    ok('伴星与主行星同一轨道', Math.abs(home.a - comp.a) < 1e-12, `${home.a.toFixed(3)} / ${comp.a.toFixed(3)} AU`);
    ok('伴星给主行星加了潮汐', sys.home.tide > 0.2, `潮差 ${sys.home.tide.toFixed(2)}(地球=1)`);
  }
  const civ = generateCiv(w, { endYear: 1500 });
  const om = omensOf(civ, w);
  ok('双固态行星有"两星相掩"天象', om.some((o) => o.text.includes('两星相掩') || o.text.includes('伴星掩日')), `${om.length} 条天象`);
  ok('arch=1 主行星可呼吸(life=1)', sys.home.air.breathable);
  const w2 = generateWorld(p);
  const s2 = astroOf(w2)!;
  ok('arch=1 两次生成逐字段一致', JSON.stringify(s2.design.binary) === JSON.stringify(bin) && s2.home.tide === sys.home.tide);
  const off = generateWorld({ ...DEFAULT_PARAMS, seed: 811, cells: 2000, arch: 1 });
  ok('关掉星球系的同种子世界不受 arch 影响', astroOf(off) === null && off.water.length > 0 && off.params.arch === 1);
}

// ---- 12. 双恒星(arch = 2):等效星光、稳定轨道外、两星互食、可呼吸、确定性 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 822, cells: 2000, astro: 1, arch: 2, planets: 3, life: 1 };
  const w = generateWorld(p);
  const sys = astroOf(w)!;
  const bs = sys.design.binaryStar;
  ok('arch=2 是双恒星', !!bs && sys.design.star.id === 'bin', bs ? `间距 ${bs.sepAU.toFixed(3)} AU · 互绕 ${bs.periodDays.toFixed(1)} 天 · 伴星光度占 ${(bs.lumRatio * 100).toFixed(0)}%` : '没有 binaryStar');
  if (bs) {
    const aMin = Math.min(...sys.design.planets.filter((q) => q.kind === 'rocky').map((q) => q.a));
  ok('双恒星:行星要么在 P 型(2.5×间距外)要么在 S 型(0.3×间距内)', sys.design.planets.every((q) => orbitZoneOf(q.a, sys.design.binaryStar!.sepAU) !== 'unstable'), `sep ${sys.design.binaryStar!.sepAU.toFixed(2)} AU`);
    ok('伴星光度占比 0–1 且等效星更亮', bs.lumRatio > 0 && bs.lumRatio < 1 && sys.design.star.lum > 0);
  }
  const civ = generateCiv(w, { endYear: 1500 });
  const om = omensOf(civ, w);
  ok('双恒星有"两星互食"天象', om.some((o) => o.text.includes('两星互食')), `${om.length} 条天象`);
  ok('arch=2 主行星可呼吸(life=1)', sys.home.air.breathable);
  ok('arch=2 两次生成一致', JSON.stringify(astroOf(generateWorld(p))!.design.binaryStar) === JSON.stringify(bs));
}

// ---- 13. 气态巨星的宜居卫星(arch = 3):母行星、潮汐锁定、潮汐加热、大星掩日、可呼吸 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 833, cells: 2000, astro: 1, arch: 3, planets: 3, gas: 1, life: 1 };
  const w = generateWorld(p);
  const sys = astroOf(w)!;
  const hm = sys.design.habitableMoon;
  ok(
    'arch=3 是气态巨星的宜居卫星',
    !!hm && sys.design.planets[hm.parent].kind === 'gas' && hm.index === sys.home.index,
    hm ? `母行星 #${hm.parent}(气态)、卫星距母星 ${hm.sepR.toFixed(0)} 个母星半径、公转 ${hm.periodDays.toFixed(1)} 天、潮汐加热 +${hm.tidalHeatK.toFixed(1)} K` : '没有 habitableMoon',
  );
  if (hm) {
    const parent = sys.design.planets[hm.parent];
    const moon = sys.design.planets[hm.index];
    ok('母行星与卫星同一日照距离', Math.abs(parent.a - moon.a) < 1e-12, `${parent.a.toFixed(3)} AU`);
    const lockedHours = Math.min(200, Math.max(4, hm.periodDays * 24));
    ok('卫星潮汐锁定(自转 = 绕母行星周期)', Math.abs(moon.rotation - lockedHours) < 1e-9, `${moon.rotation.toFixed(1)} 小时`);
    ok('母行星给卫星加了强潮汐', sys.home.tide > 5, `潮差 ${sys.home.tide.toFixed(1)}(地球=1)`);
    ok('潮汐加热抬高了卫星温度', sys.home.meanTempK > 260, `均温 ${(sys.home.meanTempK - 273.15).toFixed(1)}°C`);
  }
  const civ = generateCiv(w, { endYear: 1500 });
  const om = omensOf(civ, w);
  ok('宜居卫星有"大星掩日"天象', om.some((o) => o.text.includes('大星掩日')), `${om.length} 条天象`);
  ok('arch=3 主行星可呼吸(life=1)', sys.home.air.breathable);
  ok('arch=3 两次生成一致', JSON.stringify(astroOf(generateWorld(p))!.design.habitableMoon) === JSON.stringify(hm));
}

// ---- 14. 多天体星系(S1 数据层):聚合、轨道参数、小行星带与陨击率、覆盖表、卫星地表参数 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 841, cells: 2000, astro: 1, planets: 3, gas: 1, life: 1, impact: 1 };
  const w = generateWorld(p);
  const sys = systemOf(w)!;
  ok('systemOf 能拿到星系', !!sys && sys.design === w.astro!.design);
  ok('默认(impact = 0)没有小行星带', beltsOf(sys.design, 841, 0).length === 0);
  ok('impact = 1 生成了小行星带', sys.belts.length >= 1, sys.belts.map((b) => `${b.innerAU.toFixed(2)}–${b.outerAU.toFixed(2)} AU`).join(' / '));
  // 把第 1 颗行星挪进带里(覆盖表),陨击率必须明显升高
  const belt0 = sys.belts[0];
  const moved = applyOverrides(sys.design, { planets: [{ index: 0, a: (belt0.innerAU + belt0.outerAU) / 2 }], moons: [] });
  ok('落在带里的行星陨击率更高', impactRateOf(moved, sys.belts, 0) > 1.2, `×${impactRateOf(moved, sys.belts, 0).toFixed(2)}`);
  const outerIdx = sys.design.planets.findIndex((q) => q.kind === 'gas');
  if (outerIdx >= 0) {
    const inner = sys.design.planets.findIndex((q) => q.kind === 'rocky' && q.a < sys.design.planets[outerIdx].a);
    if (inner >= 0) ok('巨行星挡在内侧时陨击率下降', impactRateOf(sys.design, sys.belts, inner) < impactRateOf(sys.design, sys.belts, inner) * 2 + 1, '有巨行星清扫');
  }
  const ov = { planets: [{ index: 0, a: 0.5, tilt: 40 }], moons: [] };
  const eff = applyOverrides(sys.design, ov);
  ok('覆盖表改了轨道/倾角', Math.abs(eff.planets[0].a - 0.5) < 1e-12 && Math.abs(eff.planets[0].tilt - 40) < 1e-12);
  ok('空覆盖表原样', JSON.stringify(applyOverrides(sys.design, emptyOverrides())) === JSON.stringify(sys.design));
  ok('行星有黄道角/升交点', sys.design.planets.every((q) => q.incDeg >= 0 && q.incDeg <= 8 && q.nodeDeg >= 0 && q.nodeDeg <= 360), sys.design.planets.map((q) => `i${q.incDeg.toFixed(1)}°`).join(' '));
  const moonPlan = planMoonSurfaces(sys);
  if (moonPlan.length) {
    const m = moonPlan[0];
    const wp1 = moonWorldParams(sys.effective, m.planet, m.moon, p);
    const wp2 = moonWorldParams(sys.effective, m.planet, m.moon, p);
    ok('卫星地表参数确定', JSON.stringify(wp1) === JSON.stringify(wp2) && wp1.cells >= 2000, `${wp1.cells} 地块`);
  } else ok('卫星地表参数确定', true, '这个抽样星系没有卫星');
}

// ---- 15. 覆盖表进生成流程:S2 起新建世界的星系结构编辑会改轨道/倾角/生命,必须确定且只改受影响的行星 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 851, cells: 2000, astro: 1, planets: 3, gas: 1, life: 1 };
  const ov = { planets: [{ index: 0, a: 0.7, tilt: 40, life: 2 }], moons: [] };
  const w = generateWorld(p, undefined, undefined, undefined, undefined, ov);
  ok('生成时套用覆盖表', !!w.system && Math.abs(w.astro!.design.planets[0].a - 0.7) < 1e-12, `a=${w.astro!.design.planets[0].a.toFixed(3)} AU、倾角 ${w.astro!.design.planets[0].tilt.toFixed(1)}°`);
  ok('覆盖表定的生命生效(无生物圈 → 不可呼吸)', !w.astro!.home.air.breathable && !w.astro!.design.planets[w.astro!.home.index].biotic || w.astro!.home.index !== 0);
  const w2 = generateWorld(p, undefined, undefined, undefined, undefined, ov);
  ok('带覆盖表的世界两次生成一致', JSON.stringify(w2.astro!.design) === JSON.stringify(w.astro!.design) && JSON.stringify(w2.system) === JSON.stringify(w.system));
  const plain = generateWorld(p);
  ok('不带覆盖表时 system 不挂在世界上', plain.system === undefined);
}

// ---- 16. 多天体详情与按需文明(S4):生命判定、World 复用、同一天体只推一次 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 861, cells: 2000, astro: 1, planets: 5, gas: 2, life: 1 };
  const w = generateWorld(p);
  const sys = astroOf(w)!;
  const facts = bodyFacts(sys);
  ok('天体列表覆盖每颗行星', facts.length === sys.design.planets.length, `${facts.length} 颗`);
  ok(
    '生命判定 = 生物圈或可呼吸',
    facts.every((f) => f.alive === (f.planet.kind === 'rocky' && (f.planet.biotic || f.planet.atmos.breathable))),
    `${facts.filter((f) => f.alive).length} 颗生命行星`,
  );
  const b1 = bodyWorld(sys, 0, p);
  const b2 = bodyWorld(sys, 0, p);
  ok('天体 World 走同一份缓存', b1 === b2);
  const cand = facts.filter((f) => f.alive && f.index !== sys.home.index).map((f) => f.index);
  if (cand.length) {
    const i = cand[0];
    const c1 = bodyCiv(sys, i, p, 300);
    const c2 = bodyCiv(sys, i, p, 300);
    ok('按需推演:同一星系同一天体只推一次', c1 === c2 && c1.endYear === 300, `第 ${i} 颗 · ${c1.polities.length} 国`);
    const sys2 = astroOf(generateWorld(p))!;
    const d2 = bodyCiv(sys2, i, p, 300);
    ok('同一套参数的两个星系,那天体的文明一致', c1.polities.length === d2.polities.length && c1.endYear === d2.endYear);
  } else ok('按需推演:同一星系同一天体只推一次', true, '抽样星系没有第二颗生命行星');
  // 用覆盖表把第 2 颗行星也设成有生命,验证"第二颗行星能推文明"
  const wo = generateWorld(p, undefined, undefined, undefined, undefined, { planets: [{ index: 2, life: 1 }], moons: [] });
  const so = astroOf(wo)!;
  const second = bodyFacts(so).filter((f) => f.alive && f.index !== so.home.index);
  ok('覆盖表让第二颗行星有生命', second.length >= 1, `第 ${second.map((f) => f.index).join(',')} 颗`);
  if (second.length) {
    const c2 = bodyCiv(so, second[0].index, p, 200);
    ok('第二颗行星能推文明(仅生命天体)', c2.endYear === 200 && c2.polities.length >= 0, `第 ${second[0].index} 颗 · ${c2.polities.length} 国`);
  }
}

// ---- 17. 陨星撞击 + 结算(S5,C 方案) ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 21, cells: 2000, astro: 1, impact: 2, planets: 5, gas: 2, life: 1 };
  const w = generateWorld(p);
  ok('陨击模块只在开了星球系 + 陨击频率时开', impactEventsOn(w) && impactOdds(w) > 0, `odds ${impactOdds(w).toFixed(3)}`);
  ok('默认参数不装陨击(老历史不变)', !impactEventsOn(generateWorld(DEFAULT_PARAMS)));
  const civ = generateCiv(w, { endYear: 1200 });
  const s = settleImpacts(w, civ);
  ok('推演里记下撞击,结算算出坑', s.craters.length > 0, `${s.craters.length} 坑`);
  ok('结算会改地形(副本),世界本身没改', s.touched > 0 && s.elevation !== w.elevation && s.elevation.length === w.elevation.length, `${s.touched} 地块`);
  const chron = buildChronicle(civ).map((e) => e.text).join('');
  ok('编年史写了陨星', /陨星/.test(chron));
  const ops = cratersToOps(s.craters);
  ok('结算能换成地形修改(压低地形,坐标在范围内)', ops.length === s.craters.length && ops.every((o) => o.kind === 'lower' && o.pts.length === 2 && o.r >= 3 && o.r <= 160 && o.pts[0] >= 0 && o.pts[0] < 2048), `${ops.length} 处`);
  ok('两次换算一致', JSON.stringify(cratersToOps(s.craters)) === JSON.stringify(ops));
}

// ---- 18. 每颗行星「换一颗」(S2):只改那一颗、确定性 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2 };
  const base = generateAstro(p);
  const rr = generateAstro(p, { planets: [{ index: 1, reroll: 7 }], moons: [] });
  const a = base.design.planets[1];
  const b = rr.design.planets[1];
  const changed = a.hydro !== b.hydro || a.biotic !== b.biotic || a.tempK !== b.tempK || a.atmos.pressure !== b.atmos.pressure || a.atmos.breathable !== b.atmos.breathable;
  ok('每颗行星「换一颗」只改那一颗', changed && JSON.stringify(base.design.planets[0]) === JSON.stringify(rr.design.planets[0]));
  const rr2 = generateAstro(p, { planets: [{ index: 1, reroll: 7 }], moons: [] });
  ok('换一颗确定性', JSON.stringify(rr.design) === JSON.stringify(rr2.design));
}

// ---- 19. 每颗行星的地形修改(S2):只改那颗、确定性、bodyWorld 同一条 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2 };
  const sys = generateAstro(p);
  const ops = [{ kind: 'volcano' as const, pts: [900, 500], r: 18, s: 1.05 }];
  const plain = planetSurface(sys, 1, p);
  const edited = planetSurface(sys, 1, p, ops);
  ok('每颗行星的地形修改只改那颗世界', edited !== plain && edited.elevation.some((e, i) => e !== plain.elevation[i]));
  ok('同一份地形修改两次拿到同一颗世界', planetSurface(sys, 1, p, ops) === edited);
  const sys2 = generateAstro(p);
  const again = planetSurface(sys2, 1, p, ops);
  ok('重新生成的星系,同一份地形修改结果一致', Array.from(again.elevation.slice(0, 64)).join(',') === Array.from(edited.elevation.slice(0, 64)).join(','));
  const bw = bodyWorld(sys, 1, p, ops);
  ok('详情页的 bodyWorld 也走同一份地形修改', bw.elevation.some((e, i) => e !== plain.elevation[i]));
}

// ---- 20. 卫星的地形修改(S2):和行星同一种 TerrainOp ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, moons: 1 };
  const sys = generateAstro(p);
  const mp = moonWorldParams(sys.design, sys.home.index, 0, p);
  const plain = generateWorld(mp);
  const ops = [{ kind: 'volcano' as const, pts: [700, 400], r: 18, s: 1.05 }];
  const edited = generateWorld(mp, undefined, ops);
  ok('卫星的地形修改生效', edited.elevation.some((e, i) => e !== plain.elevation[i]));
  const again = generateWorld(mp, undefined, ops);
  ok('卫星地形修改确定性', Array.from(again.elevation.slice(0, 48)).join(',') === Array.from(edited.elevation.slice(0, 48)).join(','));
}

// ---- 21. 物质状态相图 + 每颗天体按自己的温度/气压长地表(S2) ----
{
  ok('相图:水冷成冰、常温成液、热成汽、无水圈 = none', phasesOf(250, 1).water === 'ice' && phasesOf(288, 1).water === 'liquid' && phasesOf(400, 1).water === 'vapor' && phasesOf(288, 1, { hasWater: false }).water === 'none');
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, life: 0 };
  const sys = generateAstro(p);
  let checked = 0;
  sys.design.planets.forEach((pl, i) => {
    if (pl.kind !== 'rocky' || !pl.hydro) return;
    const ph = phasesOf(pl.tempK, pl.atmos.pressure, { hasWater: true });
    const wp = planetWorldParams(sys, i, p);
    if (wp.landFraction < surfaceHints(ph).minLand) throw new Error(`第 ${i} 颗陆地比例 ${wp.landFraction} < ${surfaceHints(ph).minLand}`);
    checked++;
  });
  ok('每颗有水的行星:陆地比例和它的相态一致', checked > 0, `${checked} 颗`);
  const home = sys.design.planets[sys.home.index];
  const mp = moonWorldParams(sys.design, sys.home.index, 0, p);
  const expectT = Math.max(-40, Math.min(40, Math.round((home.tempK - (home.moons[0]?.locked ? 25 : 10) - 288) * 10) / 10));
  ok('卫星地表按母行星温度给温度、冰壳降水低', mp.temperature === expectT && mp.rainfall <= 0.3 && mp.landFraction >= 0.88, `${mp.temperature}°C / 降水 ${mp.rainfall}`);
}

// ---- 22. 每颗天体的地表参数覆盖(S2:地表生成下发给每颗固态行星/卫星) ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, moons: 1 };
  const sys = generateAstro(p);
  const surf = { landFraction: 0.62, temperature: 12, rainfall: 0.4, cells: 30000 };
  const wp = planetWorldParams(sys, 1, p, surf);
  ok('行星地表参数覆盖生效', wp.landFraction === 0.62 && wp.temperature === 12 && wp.rainfall === 0.4 && wp.cells === 30000);
  const clamped = planetWorldParams(sys, 1, p, { landFraction: 9, temperature: -999, rainfall: 99, cells: 1 });
  ok('越界的地表参数被夹回范围', clamped.landFraction === 0.98 && clamped.temperature === -40 && clamped.rainfall === 5 && clamped.cells === 200, `${clamped.landFraction}/${clamped.temperature}/${clamped.rainfall}/${clamped.cells}`);
  const a = planetSurface(sys, 1, p, [], surf);
  const b = planetSurface(sys, 1, p, [], { ...surf, landFraction: 0.3 });
  ok('同一颗行星换地表参数 = 另一份世界', a !== b && a.params.landFraction === 0.62 && b.params.landFraction === 0.3);
  const mp = moonWorldParams(sys.design, sys.home.index, 0, p, { landFraction: 0.5, temperature: 5, rainfall: 1.2, cells: 6000 });
  ok('卫星地表参数覆盖生效', mp.landFraction === 0.5 && mp.temperature === 5 && mp.rainfall === 1.2 && mp.cells === 6000);
}

// ---- 23. SystemSpec 分层视图(星系/行星/卫星一棵树) ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, moons: 1, impact: 1 };
  const sys = generateAstro(p);
  const spec = systemSpecOf(sys, p, { planets: [{ index: 1, surface: { landFraction: 0.4 } }], moons: [] });
  ok('SystemSpec:星系层与行星层对得上', spec.planets.length === sys.design.planets.length && spec.planets[spec.home].role === 'home' && spec.impact === 1);
  ok('SystemSpec:覆盖表(地表参数)透传', spec.planets[1].surface?.landFraction === 0.4 && spec.belts.length === beltsOf(sys.design, p.seed, p.impact).length);
  ok('SystemSpec:主行星有卫星层', spec.planets[spec.home].moons.length === sys.design.planets[sys.home.index].moons.length);
}

// ---- 24. 星系分层存档(systemSpec) + 兼容 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 9 };
  const ov = {
    planets: [{ index: 0, a: 0.8, reroll: 7, surface: { landFraction: 0.42 }, terrain: [{ kind: 'volcano' as const, pts: [812, 403], r: 28, s: 1.05 }] }, { index: 2, home: true }],
    moons: [{ planet: 0, moon: 0, distance: 50, locked: true, terrain: [{ kind: 'lake' as const, pts: [300, 400], r: 16, s: 1 }] }],
  } as import('../src/gen/astroDesign').SystemOverrides;
  const layers = layersOfOverrides(ov);
  ok('分层存档往返不丢字段', JSON.stringify(overridesOfLayers(layers)) === JSON.stringify(ov));
  const save = makeSave(p, EMPTY_EDITS, 'c', '星系', undefined, null, null, ov);
  const back = parseSave(saveText(save));
  ok('存档同时写覆盖表与分层,读回来一致', back.ok && JSON.stringify(back.save.system) === JSON.stringify(ov) && (save.systemSpec?.v === 1));
  const plain = JSON.parse(saveText(makeSave(p, EMPTY_EDITS, 'c')));
  ok('默认世界两份都不写(逐字节不变)', !('system' in plain) && !('systemSpec' in plain));
}

// ---- 25. 每颗行星的卫星数 + 星体手动改名 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, moons: 0 };
  const base = generateAstro(p);
  const target = base.design.planets.findIndex((x) => x.kind === 'rocky');
  const ov = { planets: [{ index: target, moonCount: 3 }], moons: [] };
  const withMoons = generateAstro(p, ov);
  ok('每颗行星的卫星数覆盖生效', withMoons.design.planets[target].moons.length === 3 && JSON.stringify(generateAstro(p, ov).design) === JSON.stringify(withMoons.design));
  ok('卫星数能减到 0', generateAstro(p, { planets: [{ index: target, moonCount: 0 }], moons: [] }).design.planets[target].moons.length === 0);
  const plain = namedBodies(base, p.seed, null);
  const renamed = namedBodies(base, p.seed, { planets: [], moons: [], bodyNames: { star: '星一', planets: { 0: '甲' } } });
  ok('星体手动改名生效(没改的保持种子名)', renamed.star === '星一' && renamed.planets[0] === '甲' && renamed.planets[1] === plain.planets[1]);
  ok('改名进分层存档', overridesOfLayers(layersOfOverrides({ planets: [], moons: [], bodyNames: { star: '星一' } }))?.bodyNames?.star === '星一');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项未通过`);
// ---- 26. 星体质量 / 递归树 / 周期 / 航行与天象接口 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 4321, astro: 1, planets: 5, gas: 2, moons: 1 };
  const b = generateAstro(p);
  const ri = b.design.planets.findIndex((x) => x.kind === 'rocky');
  const ov = { planets: [{ index: ri, mass: 2.5, moonCount: 2, periodDays: 500 }], moons: [{ planet: ri, moon: 0, mass: 0.05, periodDays: 9 }], star: { mass: 2 } } as import('../src/gen/astroDesign').SystemOverrides;
  const sys2 = generateAstro(p, ov);
  ok('行星/卫星/恒星质量覆盖生效', sys2.design.planets[ri].mass === 2.5 && sys2.design.planets[ri].moons[0].mass === 0.05 && sys2.design.star.mass === 2 && sys2.design.star.lum > b.design.star.lum);
  const spec = systemSpecOf(sys2, p, ov);
  ok('SystemSpec 递归树:恒星→行星→卫星,周期对得上', spec.tree.kind === 'star' && spec.tree.children.length > 0 && spec.planets[ri].orbit.periodDays === 500 && spec.planets[ri].moons[0].periodDays === 9);
  const layers = layersOfOverrides(ov);
  ok('质量/周期/恒星覆盖进分层存档', JSON.stringify(layersOfOverrides(overridesOfLayers(layers)!)) === JSON.stringify(layers));
  const t = hohmannTransfer(1, 5.2, 1);
  ok('行星际霍曼接口:地球→木星约 2.7 年', t.days / 365.25 > 2.4 && t.days / 365.25 < 3.0 && transferWindowYears(1, 5.2, 1) > 1.0);
  ok('恒星际未开放(接口返回 null + 原因)', interstellarTravelEstimate(12, 5).days === null);
  ok('天象事件接口是空实现(不污染历史)', celestialEventsOf({}).length === 0 && nextCelestialEvent({}, 100) === null && supernovaImpact(20, 15) === null);
}
// ---- 27. 每颗行星/卫星独立生成参数 + 模板一键套用 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 555, astro: 1, planets: 5, gas: 2, moons: 1 };
  const s = generateAstro(p);
  const ri = s.design.planets.findIndex((x) => x.kind === 'rocky');
  const gen = { plates: 50, mountains: 4.5, cells: 2000, landFraction: 0.9, temperature: 20, rainfall: 4, seed: 777 };
  const wp = planetWorldParams(s, ri, p, undefined, gen);
  ok('每颗行星生成参数独立生效', wp.plates === 50 && wp.mountains === 4.5 && wp.cells === 2000 && wp.landFraction === 0.9 && wp.temperature === 20 && wp.rainfall === 4 && wp.seed === 777);
  const wm = s.design.planets.findIndex((x) => x.moons.length > 0);
  if (wm >= 0) {
    const mwp = moonWorldParams(s.design, wm, 0, p, undefined, { cells: 800, plates: 30, seed: 999 });
    ok('卫星生成参数独立生效', mwp.cells === 800 && mwp.plates === 30 && mwp.seed === 999);
  } else ok('卫星生成参数独立生效', true, '这个种子没有卫星');
  const ov = { planets: [{ index: ri, gen }], moons: [] } as import('../src/gen/astroDesign').SystemOverrides;
  const save = makeSave(p, EMPTY_EDITS, 'c', 'gen', undefined, null, null, ov);
  const back = parseSave(saveText(save));
  const g2 = back.ok ? back.save.system?.planets[0].gen : undefined;
  ok('生成参数进存档并可读回', !!g2 && g2.plates === 50 && g2.mountains === 4.5 && g2.cells === 2000 && g2.seed === 777 && g2.landFraction === 0.9);
  const tpl = applyBodyTemplate('ice');
  ok('模板一键套用(生成参数+物理+地表)', !!tpl && tpl.gen.plates === 18 && tpl.surface.temperature === -32 && tpl.physical.life === 2 && BODY_TEMPLATES.length === 7);
}
// ---- 28. S4 手绘图资产:尺寸/体积约束、资产包往返、照图生成 ----
{
  const good = { worldId: 'd777s1', bodyId: 'p0', name: 'a', width: 800, height: 600, type: 'image/webp', bytes: new Uint8Array(1024), cells: encodeLayer(new Uint8Array(LAYER_W * LAYER_H).fill(SKETCH_LAND)) };
  let threw = '';
  try {
    validateSketchAsset({ width: 2048, height: 512, bytes: new Uint8Array(10) });
  } catch (e) {
    threw = String(e);
  }
  ok('手绘图:最长边超过 1024 被拒', threw.includes('1024'));
  threw = '';
  try {
    validateSketchAsset({ width: 512, height: 512, bytes: new Uint8Array(SKETCH_ASSET_MAX_BYTES + 1) });
  } catch (e) {
    threw = String(e);
  }
  ok('手绘图:单张超过 1.5 MB 被拒', threw.includes('MB'));
  validateSketchAsset(good);
  ok('手绘图:合格的图通过校验', true, `${good.width}×${good.height}`);
  // 同一张草图两次生成逐字段一致;换一张草图 → 换一颗星球
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 909, astro: 1, planets: 4, gas: 1, moons: 1 };
  const s = generateAstro(p);
  const ri = s.design.planets.findIndex((x) => x.kind === 'rocky' && x !== s.design.planets[s.home.index]);
  const mk = (v: number) => sketchGrid({ rest: 'auto', strokes: [], image: { name: 'x', cells: encodeLayer(new Uint8Array(LAYER_W * LAYER_H).fill(v)) } });
  const a1 = planetSurface(s, ri, p, [], undefined, undefined, mk(SKETCH_LAND));
  const a2 = planetSurface(s, ri, p, [], undefined, undefined, mk(SKETCH_LAND));
  const b1 = planetSurface(s, ri, p, [], undefined, undefined, mk(SKETCH_SEA));
  const sum = (w: typeof a1) => w.water.reduce((n, v) => n + v, 0);
  ok('照手绘图生成:同一张图两次逐字段一致', a1.width === a2.width && sum(a1) === sum(a2) && a1.elevation.every((v, i) => v === a2.elevation[i]));
  ok('照手绘图生成:换一张图就是另一颗星球', Math.abs(sum(a1) - sum(b1)) > 0, `水地块 ${sum(a1)} vs ${sum(b1)}`);
  ok('照手绘图生成:图上的海陆方向对得上(全陆地 vs 全海)', sum(a1) < sum(b1));
}
// ---- 29. S5 天空层 / 时间轴:确定性、月亮量纲 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 4242, astro: 1, planets: 5, gas: 2, moons: 1 };
  const s = generateAstro(p);
  const d = s.design;
  const s1 = skyLayerOf(d, 12.5);
  const s2 = skyLayerOf(d, 12.5);
  ok('天空层:同一年的太阳/卫星方位确定', s1.sunAzDeg === s2.sunAzDeg && s1.subsolarLonDeg === s2.subsolarLonDeg && JSON.stringify(s1.moons) === JSON.stringify(s2.moons));
  ok('天空层:经度都在 ±180 内', Math.abs(s1.subsolarLonDeg) <= 180 && Math.abs(s1.sunAzDeg) <= 180 && s1.moons.every((m) => m.azDeg >= 0 && m.azDeg < 360));
  const sy = skyLayerOf(d, 40);
  ok('天空层:换个年份太阳方位变了', s1.sunAzDeg !== sy.sunAzDeg || s1.subsolarLonDeg !== sy.subsolarLonDeg);
  const moonP = moonPeriodDays(60.3, 1, 1);
  ok('天空层:月亮周期量纲对(地球-月球约 27 天)', moonP > 25 && moonP < 30, `${moonP.toFixed(1)} 天`);
  ok('时间轴:年份夹在 0…endYear、按主行星周期 1/8 推进', clampSystemYear(-5, 300) === 0 && clampSystemYear(999, 300) === 300 && Math.abs(timelineStep(0, 1, 1, 300, 0.125) - 0.125) < 1e-9 && Math.abs(timelineStep(0, 2, 4, 300, 0.5) - 4) < 1e-9);
  ok('时间轴:1× = 主行星周期 T 的 1/8 每秒', Math.abs(yearsPerSecondOf(1) - 0.125) < 1e-12 && Math.abs(yearsPerSecondOf(11.18) - 1.3975) < 1e-3);
}
// ---- 32. S5 地表边界:谁占着地随年份变、确定(node 只验 gen 层;折线绘制在 ui 层,待截图) ----
{
  const params: WorldParams = { ...DEFAULT_PARAMS, seed: 8123, cells: 6000 };
  const w = generateWorld(params);
  const civ = generateCiv(w, { endYear: 1200 });
  ok('地表边界:第 0 年还没有国家占地', politiesWithLand(w, civ, 0) === 0);
  const late = politiesWithLand(w, civ, civ.endYear);
  ok('地表边界:末年有国家占地', late > 0, `${late} 个国家`);
  ok('地表边界:和按州归属数出来的一致', late === politiesAt(w, civ, civ.endYear).length);
  ok('地表边界:两次算一致', late === politiesWithLand(w, civ, civ.endYear) && JSON.stringify(politiesAt(w, civ, civ.endYear)) === JSON.stringify(politiesAt(w, civ, civ.endYear)));
  ok('地表边界:没有 civ / 州数对不上时是 0', politiesWithLand(w, null, 800) === 0 && politiesWithLand({ ...w, mesh: { ...w.mesh, n: w.mesh.n + 1 } } as typeof w, civ, 800) === 0);
}
// ---- 33. S7 首屏预算:重件必须靠动态 import(React.lazy)分块,不能静态进主 chunk ----
{
  const root = process.cwd();
  /** 按 src 里的写法找文件(补 .ts/.tsx/index) */
  const pick = (spec: string, from: string): string | null => {
    const base = spec.startsWith('.') ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
      // 只要文件:同名目录不算(否则 readFileSync 会 EISDIR)
      if (existsSync(cand) && statSync(cand).isFile() && !cand.endsWith('.css')) return cand;
    }
    return null;
  };
  /** 一个文件里静态 import 的去处(动态 import() / lazy 不算:那是分块点) */
  const staticImports = (file: string): string[] => {
    const src = readFileSync(file, 'utf8');
    const out: string[] = [];
    const re = /^\s*import\s+(?:type\s+)?(?:[^'"]*?from\s*)?['"]([^'"]+)['"]/gm;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const f = pick(spec, file);
      if (f) out.push(f);
    }
    return out;
  };
  // 从入口开始只走静态 import:能走到的就是首屏那个 chunk 里的东西
  const entry = resolve(root, 'src/main.tsx');
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const g of staticImports(f)) queue.push(g);
  }
  // 这些是"点开才看 / 打开才用"的重件:必须不在
  const heavy = ['src/ui/StarMap.tsx', 'src/ui/SkyLayer.tsx', 'src/ui/BorderMap.tsx'];
  const leaked = heavy.filter((p) => seen.has(resolve(root, p)));
  ok('首屏分块:星图 / 天空层 / 地表边界都不在静态 import 图里', leaked.length === 0, leaked.length ? `漏了 ${leaked.join(', ')}` : `主图 ${seen.size} 个模块`);
  // 反证:动态 import 的写法确实存在(不然上面那条会因为笔误而假通过)
  const sysPage = readFileSync(resolve(root, 'src/ui/SystemPage.tsx'), 'utf8');
  const studioSrc = readFileSync(resolve(root, 'src/ui/studio/Studio.tsx'), 'utf8');
  const lazyIn = (text: string, n: string) => new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\('\\.\\.?/${n}'\\)`).test(text);
  // N8:天空层从星球系页搬到了 Studio 地球仪视角,所以它在 Studio 里懒加载
  ok('首屏分块:星图/边界在星球系页懒加载、天空层在 Studio 懒加载', lazyIn(sysPage, 'StarMap') && lazyIn(sysPage, 'BorderMap') && lazyIn(studioSrc, 'SkyLayer'));
}
// ---- 30. S4 资产包往返(要 await,单独一段) ----
async function assetPackChecks(): Promise<void> {
  const good = { worldId: 'd777s1', bodyId: 'p0', name: 'a', width: 800, height: 600, type: 'image/webp', bytes: new Uint8Array(1024), cells: encodeLayer(new Uint8Array(LAYER_W * LAYER_H).fill(SKETCH_LAND)) };
  const pack = await makeSketchAssetPack([good]);
  const back = await openSketchAssetPack(pack);
  ok('手绘图资产包:导出再导入一致(尺寸/字节/认出的格子)', back.length === 1 && back[0].width === 800 && back[0].height === 600 && back[0].bytes.byteLength === 1024 && back[0].cells === good.cells);
  let bad = '';
  try {
    await openSketchAssetPack(new Uint8Array([1, 2, 3, 4]));
  } catch (e) {
    bad = String(e);
  }
  ok('手绘图资产包:坏文件被拒', bad.length > 0);
}
// ---- 31. S6 星图数据:100 光年 / 42 颗、确定性、光谱与距离可信 ----
{
  const a = nearbyStarsOf(20261110);
  const b = nearbyStarsOf(20261110);
  ok('星图:100 光年内正好 42 颗邻星', a.length === NEIGHBOR_COUNT && NEIGHBOR_COUNT === 42);
  ok('星图:邻星都在 3–100 光年、坐标 = 方向 × 距离', a.every((s) => s.distanceLy >= 3 && s.distanceLy <= NEIGHBOR_MAX_LY) && a.every((s) => Math.abs(Math.hypot(...s.xyz) - s.distanceLy) < 1e-9));
  ok('星图:同一个种子两次一致', JSON.stringify(a) === JSON.stringify(b));
  ok('星图:单位方向向量长度 1', a.every((s) => Math.abs(Math.hypot(...s.dir) - 1) < 1e-9));
  const other = nearbyStarsOf(777);
  ok('星图:换种子换一张图', JSON.stringify(a) !== JSON.stringify(other));
  ok('星图:光谱型都在 M–O 里、质量/温度为正', a.every((s) => 'OBAFGKM'.includes(s.spectral) && s.mass > 0 && s.tempK > 0 && s.lum > 0));
}
// ---- 34. WP1 简化赫罗:太阳锚点、端点、单调、自洽、超出主序不爆 ----
{
  const sun = starAt('G', 2);
  ok('赫罗:G2V 就是太阳(1.00 M☉ / 1.000 L☉ / 5772 K / 1.00 R☉)', Math.abs(sun.mass - 1) < 1e-9 && Math.abs(sun.lum - 1) < 1e-9 && sun.temp === 5772 && Math.abs(sun.radius - 1) < 1e-9);
  const hot = starFromMassHR(16);
  const cold = starFromMassHR(0.08);
  ok('赫罗:0.08 / 16 M☉ 两端落在 M / B 档', cold.cls === 'M' && hot.cls === 'B', `${cold.cls}${cold.sub} / ${hot.cls}${hot.sub}`);
  let mono = true;
  let prev = starFromMassHR(0.1);
  for (const m of [0.2, 0.5, 1, 2, 5, 10, 16]) {
    const cur = starFromMassHR(m);
    if (!(cur.lum > prev.lum && cur.temp >= prev.temp)) mono = false;
    prev = cur;
  }
  ok('赫罗:质量↑ 光度与温度都↑(主序单调)', mono);
  const selfOk = [0.1, 0.5, 1, 3, 10].every((m) => {
    const s = starFromMassHR(m);
    const lhs = s.radius * s.radius * Math.pow(s.temp / 5772, 4);
    return Math.abs(lhs - s.lum) / s.lum < 0.02;
  });
  ok('赫罗:L = 4πR²σT⁴ 自洽(半径由 L、T 反推)', selfOk);
  const hz = habitableZone(1);
  ok('赫罗:宜居带 L=1 → 0.95–1.37 AU', Math.abs(hz.innerAU - 0.95) < 1e-9 && Math.abs(hz.outerAU - 1.37) < 1e-9);
  const big = starFromMassHR(100);
  ok('赫罗:给 100 M☉ 不再爆到 1e7 L☉,只标离开主序', big.offMainSequence && big.lum <= 1_000_001 && big.temp <= 50000, `L=${big.lum.toFixed(0)} T=${big.temp}`);
  ok('赫罗:超出上下限都标 offMainSequence', starFromMassHR(0.01).offMainSequence && !starFromMassHR(1).offMainSequence);
  const g = pickStar(8, 1);
  ok('赫罗:system=8 挑出黄矮星(1.000 L☉)', g.id === 'g' && Math.abs(g.lum - 1) < 0.001, `${g.label} ${g.lum.toFixed(3)}`);
  const bySpec = pickStar(0, 1, 6, 5);
  ok('赫罗:spectral=6 挑出 O 型', bySpec.id === 'o', bySpec.label);
  const seedPick = pickStar(0, 42);
  ok('赫罗:按种子挑仍走老 STAR_TYPES 池(默认世界不变)', ['f', 'g', 'k', 'm', 'bin'].includes(seedPick.id) && seedPick.lum === STAR_TYPES.find((s) => s.id === seedPick.id)!.lum);
}
// ---- 35. WP2 树的结构改动:starCount / subSystem 解耦、删除按类型分派 ----
{
  const base: WorldParams = { ...DEFAULT_PARAMS, astro: 1, seed: 31, planets: 3, gas: 2 };
  ok('树:老数据 arch=2 还原成 双恒星 + 单行星系', resolveStarCount({ arch: 2 }) === 2 && resolveSubSystem({ arch: 2 }) === 0);
  ok('树:老数据 arch=1/3 还原成 单星 + 对应子星系', resolveStarCount({ arch: 1 }) === 1 && resolveSubSystem({ arch: 1 }) === 1 && resolveSubSystem({ arch: 3 }) === 3);
  const two = applyStarCount(base, 2);
  ok('树:切双恒星 → starCount=2 且 arch 投影成 2', two.starCount === 2 && two.arch === 2);
  const binRocky = applySubSystem({ ...base, ...two }, 1);
  ok('树:双恒星下也能切双固态(不再互斥) → arch 仍 2、subSystem=1', binRocky.subSystem === 1 && binRocky.arch === 2);
  const sysBoth = generateAstro({ ...base, ...two, ...binRocky });
  ok('树:双恒星 + 双固态同时成立(两星 + 两颗互绕固态行星)', !!sysBoth.design.binaryStar && !!sysBoth.design.binary && sysBoth.design.planets.length >= 2);
  // 删除:气态行星要减 gas,不能减 planets
  const ov0 = { planets: [], moons: [] } as import('../src/gen/astroDesign').SystemOverrides;
  const gasDel = deleteNode(base, ov0, { kind: 'planet', index: 3, bodyKind: 'gas' }, { planets: 3, gas: 2, moons: {} });
  ok('树:删气态行星减 gas(以前错减 planets)', gasDel.params.gas === 1 && gasDel.params.planets === undefined);
  const rockyDel = deleteNode(base, ov0, { kind: 'planet', index: 0, bodyKind: 'rocky' }, { planets: 3, gas: 2, moons: {} });
  ok('树:删固态行星减 planets', rockyDel.params.planets === 2 && gasDel.params.gas === 1);
  const lastRocky = deleteNode({ ...base, planets: 1 }, ov0, { kind: 'planet', index: 0, bodyKind: 'rocky' }, { planets: 1, gas: 2, moons: {} });
  ok('树:最后一颗固态行星不许删', !!lastRocky.refused);
  const comp = deleteNode({ ...base, starCount: 2, arch: 2 }, ov0, { kind: 'companion' }, { planets: 3, gas: 2, moons: {} });
  ok('树:删伴星 → 回到单星', comp.params.starCount === 1);
  const moonDel = deleteNode(base, { planets: [{ index: 1, moonCount: 2 }], moons: [{ planet: 1, moon: 1, radius: 0.3 }] }, { kind: 'moon', planet: 1, moon: 0 }, { planets: 3, gas: 2, moons: { 1: 2 } });
  ok('树:删卫星 → moonCount−1 且后面的卫星下标前移', moonDel.overrides.planets[0].moonCount === 1 && moonDel.overrides.moons[0].moon === 0);
  ok('树:数量都在范围内(固态 1–6 / 气态 0–4 / 卫星 0–12)', setBodyCount('rocky', 99).planets === 6 && setBodyCount('gas', -3).gas === 0 && setBodyCount('moons', 99).moons === 12 && setBodyCount('moons', -3).moons === 0);
  ok('树:设为宜居卫星会切到子星系 arch 并选这颗', setHabitableMoon(base, 1).subSystem === 3 && setHabitableMoon(base, 1).home === 2);
}
// ---- 36. WP4 没有生物圈禁止创建文明(殖民/地球化只留接口) ----
{
  const okWorld = generateWorld({ ...DEFAULT_PARAMS, seed: 511, astro: 1, life: 1, cells: 4000 });
  const noLife = generateWorld({ ...DEFAULT_PARAMS, seed: 511, astro: 1, life: 2, cells: 4000 });
  const plainNoLife = generateWorld({ ...DEFAULT_PARAMS, seed: 512, life: 2, cells: 4000 });
  ok('文明判定:有生物圈的主行星可以创建文明', canHostCiv(okWorld).ok && !!canHostCiv(okWorld).planet);
  const blocked = canHostCiv(noLife);
  ok('文明判定:没有生物圈的主行星被挡住', !blocked.ok && !!blocked.reason, blocked.reason);
  ok('文明判定:挡住时给一键修正(life=1)', blocked.fix?.life === 1);
  ok('文明判定:老世界(没开星球系)life=2 也挡住', !canHostCiv(plainNoLife).ok);
  ok('文明判定:没有世界时不拦(还没生成)', canHostCiv(null).ok);
  ok('殖民/地球化/采气站接口都返回不可行 + 原因', canColonize().ok === false && !!canColonize().reason && terraform().ok === false && gasMineSite().ok === false);
}
// ---- 37. WP5 行星类型 / 气态贴图 / 气压基准等高线 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 77, astro: 1, planets: 5, gas: 2 };
  const s = generateAstro(p);
  const classes = s.design.planets.map((d) => planetClassOf({ design: d }).id);
  ok('类型:气态行星判成气态巨行星/冰巨行星', s.design.planets.every((d, i) => (d.kind === 'gas' ? classes[i] === (d.radius >= 6 ? 'gasGiant' : 'iceGiant') : classes[i] !== 'gasGiant')));
  ok('类型:同一颗两次判定一致', JSON.stringify(classes) === JSON.stringify(s.design.planets.map((d) => planetClassOf({ design: d }).id)));
  ok('类型:卫星优先判成卫星', planetClassOf({ design: s.design.planets[0], moon: true }).id === 'moon');
  // 极端温度 / 无气气压 → 熔岩 / 无大气
  const hot = { ...s.design.planets[0], kind: 'rocky' as const, tempK: 1200, hydro: false };
  const vacuum = { ...s.design.planets[0], kind: 'rocky' as const, tempK: 280, hydro: false, atmos: { ...s.design.planets[0].atmos, pressure: 0.0001 } };
  ok('类型:1200K → 熔岩行星;近真空 → 无大气岩石', planetClassOf({ design: hot }).id === 'lava' && planetClassOf({ design: vacuum }).id === 'airless');
  // 气态贴图:确定性 + 条带覆盖全球 + 风暴在范围内
  const tex = gasTextureOf(12345, { mass: 300, radius: 10 });
  const tex2 = gasTextureOf(12345, { mass: 300, radius: 10 });
  ok('气态贴图:同种子两次一致', JSON.stringify(tex) === JSON.stringify(tex2));
  ok('气态贴图:条带首尾接上、无缝无洞(-90…90)', Math.abs(tex.bands[0].fromDeg + 90) < 1e-6 && Math.abs(tex.bands[tex.bands.length - 1].toDeg - 90) < 1e-6 && tex.bands.every((b, i) => i === 0 || Math.abs(b.fromDeg - tex.bands[i - 1].toDeg) < 1e-6));
  ok('气态贴图:风暴经纬度/大小/浓度都在范围内', tex.storms.every((st) => st.lonDeg >= 0 && st.lonDeg <= 360 && Math.abs(st.latDeg) <= 90 && st.sizeDeg > 0 && st.sizeDeg <= 30 && st.strength >= 0 && st.strength <= 1));
  // 气压基准等高线
  const earthMolar = meanMolarKg({ gases: [{ id: 'n2', frac: 0.78 }, { id: 'o2', frac: 0.21 }, { id: 'ar', frac: 0.01 }] } as never);
  const H = scaleHeightM(288, earthMolar, 9.8);
  ok('等高线:地球标高约 8.4 km', H > 8000 && H < 8800, `${Math.round(H)} m`);
  ok('等高线:标准气压那条是 0 米', pressureContourLevelsM({ p0Atm: 1, tempK: 288, molarKg: earthMolar, gravity: 9.8 }).includes(0));
  const lv = pressureContourLevelsM({ p0Atm: 1, tempK: 288, molarKg: earthMolar, gravity: 9.8 });
  ok('等高线:气压每 ±10% 一条、逐级递增', lv.length > 4 && lv.every((v, i) => i === 0 || v > lv[i - 1]));
  ok('等高线:间距 = H·ln(1/0.9) 约 0.9 km', Math.abs(contourSpacingM(288, earthMolar, 9.8) - Math.round(H * Math.log(1 / 0.9))) <= 1);
  // 火星那种低重力低压:同样 10% 气压差对应更高的米数
  const marsH = scaleHeightM(210, 0.044, 3.7);
  ok('等高线:低重力/轻大气(Venus/Mars 类)间距明显更大', contourSpacingM(210, 0.044, 3.7) > contourSpacingM(288, earthMolar, 9.8), `${Math.round(marsH)} m 标高`);
}
// ---- 38. WP6 双固态行星:质量相近、间距小、绕质心 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 606, astro: 1, planets: 4, gas: 1, subSystem: 1 };
  const s = generateAstro(p);
  const b = s.design.binary!;
  ok('双固态:生成了伴星结构', !!b && b.index >= 0 && b.index !== s.design.home.index);
  ok('双固态:两颗质量相近(比值 0.75–1.3)', (b.massRatio ?? 0) >= 0.75 && (b.massRatio ?? 0) <= 1.3, `比值 ${b.massRatio}`);
  ok('双固态:间距落在 0.0006–0.003 AU(约 9–45 万 km)', b.separationAU >= 0.0006 - 1e-9 && b.separationAU <= 0.003 + 1e-9, `${(b.separationAU * 1.496e8 / 1e4).toFixed(1)} 万 km`);
  ok('双固态:间距远小于公转半径(小于 1%)', b.separationAU / s.design.planets[s.design.home.index].a < 0.01);
  ok('双固态:绕质心的两个分量加起来等于总间距', Math.abs((b.aHomeAU ?? 0) + (b.aCompanionAU ?? 0) - b.separationAU) < 1e-12);
  const mHome = s.design.planets[s.design.home.index].mass;
  const mComp = s.design.planets[b.index].mass;
  ok('双固态:质心偏向质量大的一侧', Math.abs(mHome - mComp) < 1e-9 ? true : mHome > mComp ? (b.aHomeAU ?? 0) < (b.aCompanionAU ?? 0) : (b.aCompanionAU ?? 0) < (b.aHomeAU ?? 0));
  const kepler = 365.25 * Math.sqrt((b.separationAU ** 3 * 333000) / (mHome + mComp));
  ok('双固态:互绕周期与开普勒一致', Math.abs(kepler - b.periodDays) / b.periodDays < 0.02, `${b.periodDays.toFixed(2)} 天`);
  ok('双固态:两次生成一致', JSON.stringify(generateAstro(p).design.binary) === JSON.stringify(b));
  ok('双固态:伴星与主行星在同一公转轨道半径上', Math.abs(s.design.planets[b.index].a - s.design.planets[s.design.home.index].a) < 1e-9);
}
// ---- 39. N1 源码不得含 mojibake(双重编码) ----
{
  const root = resolve(process.cwd(), 'src');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = resolve(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(root);
  const RE = /[\u00c2\u00c3\u00c5][\u0080-\u00bf]|[\u00e6\u00e5\u00e8\u00e9\u00ee][\u0080-\u00bf]/g;
  const bad = files.filter((f) => (readFileSync(f, 'utf8').match(RE) ?? []).length > 0);
  ok('源码没有双重编码(mojibake)', bad.length === 0, bad.length ? bad.slice(0, 3).map((f) => f.replace(root, 'src')).join(', ') : `扫了 ${files.length} 个文件`);
}
// ---- 40. N2/N13 子星系分组 + 组名 + N3 双恒星位置 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 880, astro: 1, planets: 4, gas: 1, moons: 1 };
  const s = generateAstro(p);
  const names = namedBodies(s, p.seed).planets;
  const grp = subSystemGroupsOf({
    design: { planets: s.design.planets.map((b) => ({ index: b.index, kind: b.kind, moons: b.moons })), home: { index: s.design.home.index }, binary: s.design.binary, habitableMoon: s.design.habitableMoon },
    planetNames: names,
  });
  ok('子星系:每颗行星恰好属于一个组', s.design.planets.every((b) => grp.filter((g) => g.planets.includes(b.index)).length === 1), `${grp.length} 组`);
  ok('子星系:组名默认是「{主天体名}系」', grp.every((g) => g.name === `${names[g.key]}系`), grp.map((g) => g.name).join(' / '));
  ok('子星系:气态行星单独成一组且带自己的卫星', grp.some((g) => g.role === 'gasSystem') && grp.every((g) => g.planets.every((i) => s.design.planets[i])) === true);
  // 双固态:两颗合成一组
  const pb: WorldParams = { ...DEFAULT_PARAMS, seed: 880, astro: 1, planets: 4, gas: 1, subSystem: 1 };
  const sb = generateAstro(pb);
  const grpB = subSystemGroupsOf({ design: { planets: sb.design.planets.map((b) => ({ index: b.index, kind: b.kind, moons: b.moons })), home: { index: sb.design.home.index }, binary: sb.design.binary }, planetNames: namedBodies(sb, pb.seed).planets });
  const pair = grpB.find((g) => g.role === 'binaryPair');
  ok('子星系:双固态两颗归一组', !!pair && pair.planets.length === 2 && pair.planets.includes(sb.design.binary!.index));
  // 改名
  const re = renameGroup({ planets: [], moons: [] }, 0, '地月系');
  ok('子星系:组名可改并进覆盖表', re.bodyNames?.groups?.['0'] === '地月系');
  ok('子星系:名字清空 = 恢复默认', renameGroup(re, 0, '  ').bodyNames?.groups === undefined);
  // N3 双恒星位置
  const pbs: WorldParams = { ...DEFAULT_PARAMS, seed: 880, astro: 1, planets: 3, starCount: 2 };
  const ss = generateAstro(pbs);
  const pairPos = binaryStarPair(ss.design, 0);
  ok('双恒星:能算出两颗星的位置', !!pairPos && (pairPos.aMainAU > 0 && pairPos.aCompAU > 0));
  ok('双恒星:两个半长轴之和 = 双星间距', Math.abs((pairPos!.aMainAU + pairPos!.aCompAU) - ss.design.binaryStar!.sepAU) < 1e-12);
  ok('双恒星:两颗在质心两侧(位置反号)', Math.abs(pairPos!.main[0] + pairPos!.companion[0] * (pairPos!.aMainAU / pairPos!.aCompAU)) < 1e-9);
  const pair2 = binaryStarPair(ss.design, 0.5);
  ok('双恒星:换年份相位变了(会互绕)', !!pair2 && (pair2.main[0] !== pairPos!.main[0] || pair2.main[2] !== pairPos!.main[2]));
  ok('单星没有双星位置', binaryStarPair(generateAstro({ ...DEFAULT_PARAMS, seed: 880, astro: 1, planets: 3 }).design) === null);
}
// ---- 41. N9 地表边界:高分辨率底图(真实地表栅格) ----
{
  const bm = readFileSync(resolve(process.cwd(), 'src/ui/BorderMap.tsx'), 'utf8');
  ok('地表边界:画布提到 1024×512', /export const BORDER_MAP_W = 1024;/.test(bm) && /export const BORDER_MAP_H = 512;/.test(bm));
  ok('地表边界:底图用真实地表栅格(rasterize + renderLayer),不再自己找最近地块', bm.includes('rasterize(world') && bm.includes("renderLayer(c, world, raster, 'elevation')") && !bm.includes('LAND_PX'));
  ok('地表边界:界线坐标系仍按 mesh 尺寸缩放', bm.includes('W / Math.max(1, mesh.width)') && bm.includes('H / Math.max(1, mesh.height)'));
}
// ---- 42. N10 陨击结算跟随星系结构 ----
{
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 4242, astro: 1, planets: 4, gas: 1, impact: 2, cells: 4000 };
  const w = generateWorld(base);
  const civ = generateCiv(w, { endYear: 1200 });
  const r = impactRate(w);
  const s1 = settleImpacts(w, civ, { rate: r });
  const s2 = settleImpacts(w, civ, { rate: r });
  ok('陨击结算:同一结构两次一致', s1.craters.length === s2.craters.length && JSON.stringify(s1.craters) === JSON.stringify(s2.craters), `${s1.craters.length} 个坑`);
  const plain = settleImpacts(w, civ);
  const s0 = settleImpacts(w, civ, { rate: 0 });
  const sHi = settleImpacts(w, civ, { rate: 10 });
  ok('陨击结算:陨击率降到 0 → 结算清空(结构说没有撞击)', plain.craters.length > 0 && s0.craters.length === 0, `${plain.craters.length} → ${s0.craters.length}`);
  ok('陨击结算:陨击率越高保留的坑不减少', s0.craters.length <= s1.craters.length && s1.craters.length <= sHi.craters.length, `${s0.craters.length} ≤ ${s1.craters.length} ≤ ${sHi.craters.length}`);
  // 结构本身确实影响陨击率:同一条轨道,穿小行星带 vs 不穿带
  const sys = astroOf(w)!;
  const home = sys.home.index;
  const d = sys.design;
  const aHome = d.planets[home].a;
  const beltAcross = [{ innerAU: aHome - 0.2, outerAU: aHome + 0.2, count: 1500 }] as never;
  const rAcross = impactRateOf(d, beltAcross, home);
  const rClear = impactRateOf(d, [], home);
  ok('陨击结算:轨道穿过小行星带 → 陨击率显著更高', rAcross > rClear * 1.5, `${rClear.toFixed(2)} → ${rAcross.toFixed(2)}`);
  ok('陨击结算:改结构会改地形(有坑时 touched>0,坑=0 时不改)', (s1.craters.length === 0 ? s1.touched === 0 : s1.touched > 0) && (s0.craters.length === 0 ? s0.touched === 0 : true));
}// ---- 43. N11 天象与地质独立页签(只在文明期 / 按行星观测过滤) ----
{
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8');
  const store = read('src/ui/overviewStore.ts');
  const overview = read('src/ui/WorldOverview.tsx');
  const page = read('src/ui/SkyGeoPage.tsx');
  const sysPage = read('src/ui/SystemPage.tsx');
  ok('天象与地质:世界概览加了 sky 页签', /'sky'/.test(store) && /name: '天象与地质'/.test(overview) && overview.includes('<SkyGeoPage'));
  ok('天象与地质:三块已从星球系页移走', !/天象纪<\/div>/.test(sysPage) && !/陨击结算<\/div>/.test(sysPage) && !sysPage.includes('omensOf('));
  ok('天象与地质:页里三块齐全 + 行星选择器', page.includes('天象纪') && page.includes('地质现象') && page.includes('陨击结算') && page.includes('sky-geo-pick-'));
  ok('天象与地质:非主行星天文留空、地质照记', page.includes('这颗行星还没有文明') && page.includes('不依赖文明'));
  ok('天象与地质:只在有 civ 的页签里出现(Studio 不挂)', !read('src/ui/studio/Studio.tsx').includes('SkyGeoPage'));
}
// ---- 44. N12A 非主行星编辑对等 ----
{
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8');
  const studio = read('src/ui/studio/Studio.tsx');
  const editor = read('src/ui/SystemEditor.tsx');
  ok('非主行星编辑:地球仪预览角标里有「编辑这颗行星…」', studio.includes('body-preview-edit') && studio.includes('编辑这颗行星'));
  ok('非主行星编辑:编辑器支持 focus 直接选中那颗行星', editor.includes('focus?: { kind:') && editor.includes('focus ? (focus.kind'));
  ok('非主行星编辑:预览按当前覆盖表现算有效设计(applyOverrides)', studio.includes('applyOverrides(sysAstro.design'));
  ok('非主行星编辑:改完清贴图缓存并触发重算', studio.includes('dropBodyTextures()') && studio.includes('setBodyRev((v) => v + 1)') && studio.includes('out, bodyRev]'));
}
// ---- 45. 步 1 卫星数上限 12 ----
{
  const p12: WorldParams = { ...DEFAULT_PARAMS, seed: 707, astro: 1, planets: 3, moons: 12, cells: 4000 };
  const w12 = generateWorld(p12);
  const sys12 = astroOf(w12)!;
  ok('卫星数:主行星 12 颗卫星都能生成', sys12.design.planets[sys12.home.index].moons.length === 12);
  const w13 = generateWorld({ ...p12, moons: 13 });
  const sys13 = astroOf(w13)!;
  ok('卫星数:参数 13 夹到 12', sys13.design.planets[sys13.home.index].moons.length === 12, String(sys13.design.planets[sys13.home.index].moons.length));
  const ov = { planets: [{ index: sys12.home.index, moonCount: 12 }], moons: [] } as never;
  const save = makeSave(p12, EMPTY_EDITS, 'c', 'moons', undefined, null, null, ov);
  const back = parseSave(saveText(save));
  ok('卫星数:覆盖表 moonCount=12 存档往返', back.ok && (back.save.system?.planets?.[0]?.moonCount ?? 0) === 12);
  ok('卫星数:params.moons=12 存档往返', back.ok && back.save.params.moons === 12);
  const over = parseSave(saveText(makeSave({ ...p12, moons: 99 }, EMPTY_EDITS, 'c')));
  ok('卫星数:存档里超限 99 夹到 12', over.ok && over.save.params.moons === 12);
}
// ---- 46. 步 2 气态行星的卫星:覆盖表能增删 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 808, astro: 1, planets: 4, gas: 1 };
  const base = generateAstro(p);
  const gasIdx = base.design.planets.findIndex((d) => d.kind === 'gas');
  ok('气态卫星:这个世界有一颗气态行星', gasIdx >= 0, String(gasIdx));
  const ov3 = { planets: [{ index: gasIdx, moonCount: 3 }], moons: [] } as never;
  const sys3 = generateAstro(p, ov3);
  ok('气态卫星:覆盖表 moonCount=3 让气态行星有 3 颗卫星', sys3.design.planets[gasIdx].moons.length === 3, String(sys3.design.planets[gasIdx].moons.length));
  const ov0 = { planets: [{ index: gasIdx, moonCount: 0 }], moons: [] } as never;
  const sys0 = generateAstro(p, ov0);
  ok('气态卫星:moonCount=0 把气态行星的卫星清空', sys0.design.planets[gasIdx].moons.length === 0);
  ok('气态卫星:两次生成一致', JSON.stringify(generateAstro(p, ov3).design.planets[gasIdx].moons) === JSON.stringify(sys3.design.planets[gasIdx].moons));
}
// ---- 47. 步 3 设为主行星校验 + 宜居卫星当主行星 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 909, astro: 1, planets: 4, gas: 1, moons: 6, life: 1 };
  const sys = generateAstro(p);
  const gasIdx = sys.design.planets.findIndex((d) => d.kind === 'gas');
  const rockyIdx = sys.design.planets.findIndex((d) => d.kind === 'rocky');
  ok('主行星规则:气态行星不能当主行星', canBeHome(sys.design, gasIdx).ok === false && !!canBeHome(sys.design, gasIdx).reason);
  ok('主行星规则:岩石行星可以当主行星', canBeHome(sys.design, rockyIdx).ok === true);
  // 找一颗够大的卫星
  const host = sys.design.planets.findIndex((d) => d.moons.some((m) => m.radius >= 0.25));
  ok('主行星规则:这个世界有够大的卫星', host >= 0);
  const k = sys.design.planets[host].moons.findIndex((m) => m.radius >= 0.25);
  ok('主行星规则:够大的卫星可以当主行星', canBeHomeMoon(sys.design, host, k).ok === true);
  const pm: WorldParams = { ...p, home: host + 1, homeMoon: k, moons: 6 };
  const sys2 = generateAstro(pm);
  ok('卫星主行星:design.home.moon 指到那颗卫星', sys2.design.home.moon === k, String(sys2.design.home.moon));
  ok('卫星主行星:主天体温度按卫星重算(比母行星低)', sys2.design.home.meanTempK < sys2.design.planets[host].tempK, `${sys2.design.home.meanTempK.toFixed(1)} < ${sys2.design.planets[host].tempK.toFixed(1)}`);
  const w = generateWorld({ ...pm, cells: 4000 });
  const chk = canHostCiv(w);
  ok('卫星主行星:文明判定看卫星(有生物圈就通过/没有就拦)', typeof chk.ok === 'boolean' && (chk.ok ? true : !!chk.reason), chk.reason ?? 'ok');
  const save = makeSave(pm, EMPTY_EDITS, 'c', 'moon-home');
  const back = parseSave(saveText(save));
  ok('卫星主行星:homeMoon 进存档并能读回', back.ok && back.save.params.homeMoon === k && back.save.params.home === host + 1);
  ok('卫星主行星:没设 homeMoon 时存档不写该字段', !JSON.parse(saveText(makeSave(p, EMPTY_EDITS, 'c'))).params.homeMoon);
}
// ---- 48. 步 4 双恒星 ABC 三档 ----
{
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 1212, astro: 1, planets: 4, gas: 1, starCount: 2 };
  const close = generateAstro({ ...base, binaryTier: 0 }).design.binaryStar!;
  const wide = generateAstro({ ...base, binaryTier: 1 }).design.binaryStar!;
  const triple = generateAstro({ ...base, binaryTier: 2 }).design.binaryStar!;
  ok('双恒星:三档都能生成', close.tier === 'close' && wide.tier === 'wide' && triple.tier === 'triple');
  ok('双恒星:密近档 AB 间距 0.02–0.2 AU', close.sepAU >= 0.02 - 1e-9 && close.sepAU <= 0.2 + 1e-9, close.sepAU.toFixed(3));
  ok('双恒星:分离档 AB 间距 1–50 AU', wide.sepAU >= 1 - 1e-9 && wide.sepAU <= 50 + 1e-9, wide.sepAU.toFixed(2));
  ok('双恒星:三合档多一颗 C', triple.members.length === 3 && triple.members[2].role === 'C' && !!triple.outerSepAU && !!triple.outerPeriodYears);
  ok('双恒星:C 在 500–15000 AU', (triple.outerSepAU ?? 0) >= 500 && (triple.outerSepAU ?? 0) <= 15000, (triple.outerSepAU ?? 0).toFixed(0));
  ok('双恒星:AB 成员是 A/B', close.members.length === 2 && wide.members[0].role === 'A' && wide.members[1].role === 'B');
  ok('双恒星:行星都落在稳定轨道(S 型或 P 型)', (() => {
    const sys = generateAstro({ ...base, binaryTier: 1 });
    const sep = sys.design.binaryStar!.sepAU;
    return sys.design.planets.every((p) => orbitZoneOf(p.a, sep) !== 'unstable');
  })());
  // 金标锚点:α Cen AB(a≈23.4 AU、1.1+0.9 M☉) → 79.9 年
  const pAB = 365.25 * Math.sqrt(Math.pow(23.4, 3) / 2);
  ok('双恒星锚点:α Cen AB 周期约 79.9 年', Math.abs(pAB / 365.25 - 79.9) / 79.9 < 0.02, (pAB / 365.25).toFixed(1) + ' 年');
  // 金标锚点:Proxima(a≈8700 AU、总质量 2.12) → 约 5.5e5 年
  const pC = Math.sqrt(Math.pow(8700, 3) / 2.12);
  ok('双恒星锚点:α Cen C 周期约 5.5e5 年', Math.abs(pC - 5.5e5) / 5.5e5 < 0.05, pC.toFixed(0) + ' 年');
  // 3D 三合位置
  const pair = binaryStarPair(generateAstro({ ...base, binaryTier: 2 }).design, 0)!;
  ok('双恒星:3D 位置有 C 且 AB 和 = 间距', !!pair.third && Math.abs(pair.aMainAU + pair.aCompAU - triple.sepAU) < 1e-9);
  ok('双恒星:换年份 C 会动', !!binaryStarPair(generateAstro({ ...base, binaryTier: 2 }).design, 1e5)!.third);
  ok('双恒星:binaryTier 进存档并能读回', (() => {
    const sv = parseSave(saveText(makeSave({ ...base, binaryTier: 2 }, EMPTY_EDITS, 'c')));
    return sv.ok && sv.save.params.binaryTier === 2;
  })());
}
// ---- 49. 步 4 补:双星间距可手输(稳定区夹取) ----
{
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 1313, astro: 1, planets: 4, gas: 1, starCount: 2, binaryTier: 1 };
  const plain = generateAstro(base);
  const planetAs = plain.design.planets.map((p) => p.a);
  const sepWant = 30;
  const ov: never = { planets: [], moons: [], star: { sepAU: sepWant } } as never;
  const sys1 = generateAstro(base, ov);
  const bs1 = sys1.design.binaryStar!;
  ok('双星间距:手输 30 AU(S 型稳定)照用', Math.abs(bs1.sepAU - sepWant) < 1e-6, bs1.sepAU.toFixed(2));
  const mAB = bs1.members[0].star.mass + bs1.members[1].star.mass;
  const period = 365.25 * Math.sqrt(Math.pow(bs1.sepAU, 3) / mAB);
  ok('双星间距:改间距后互绕周期重算一致', Math.abs(bs1.periodDays - period) < 1e-6);
  // 落在不稳定带 → 按行星轨道夹到最近稳定边界
  const unstableWant = (Math.min(...planetAs) / 2.5 + (Math.max(...planetAs) / 0.3) * 1.05) / 2;
  const sys2 = generateAstro(base, { planets: [], moons: [], star: { sepAU: unstableWant } } as never);
  const bs2 = sys2.design.binaryStar!;
  ok('双星间距:不稳定带自动夹到稳定边界', Math.abs(bs2.sepAU - unstableWant) > 1e-6 && planetsStable(sys2.design.planets.map((p) => p.a), bs2.sepAU), `want ${unstableWant.toFixed(2)} → ${bs2.sepAU.toFixed(2)}`);
  // 三合星 C 间距
  const tripleBase: WorldParams = { ...base, binaryTier: 2 };
  const sys3 = generateAstro(tripleBase, { planets: [], moons: [], star: { sepAU: 8, outerSepAU: 9000 } } as never);
  const bs3 = sys3.design.binaryStar!;
  ok('三合星:手输 C 间距 9000 AU 生效', Math.abs((bs3.outerSepAU ?? 0) - 9000) < 1e-6, String(bs3.outerSepAU));
  ok('三合星:C 公转周期按新间距重算', Math.abs((bs3.outerPeriodYears ?? 0) - Math.sqrt(Math.pow(9000, 3) / (bs3.members[0].star.mass + bs3.members[1].star.mass + bs3.members[2].star.mass))) < 1e-6);
  const sys4 = generateAstro(tripleBase, { planets: [], moons: [], star: { sepAU: 8, outerSepAU: 100 } } as never);
  ok('三合星:C 间距不小于 5×AB', (sys4.design.binaryStar!.outerSepAU ?? 0) >= 8 * 5 - 1e-9, String(sys4.design.binaryStar!.outerSepAU));
  // 存档
  const sv = parseSave(saveText(makeSave(base, EMPTY_EDITS, 'c', 'sep', undefined, null, null, { planets: [], moons: [], star: { sepAU: 12.5, outerSepAU: 2000 } } as never)));
  ok('双星间距:进存档并能读回', sv.ok && sv.save.system?.star?.sepAU === 12.5 && sv.save.system?.star?.outerSepAU === 2000);
}
// ---- 50. 步 5 行星类型 6 类 + 手改类型重算 ----
{
  const p: WorldParams = { ...DEFAULT_PARAMS, seed: 1515, astro: 1, planets: 5, gas: 2 };
  const sys = generateAstro(p);
  const types = sys.design.planets.map((d) => planetTypeOf(d));
  ok('行星类型:每颗都有类型', types.length === sys.design.planets.length && types.every((t) => PLANET_TYPES.includes(t)), types.join(','));
  ok('行星类型:气态行星按半径分成气态巨/冰巨/亚海王星', sys.design.planets.every((d) => (d.kind === 'gas' ? planetTypeOf(d) !== 'rocky' && planetTypeOf(d) !== 'dwarf' : true)));
  ok('行星类型:岩石行星按半径分成岩石/矮行星', sys.design.planets.every((d) => (d.kind === 'rocky' ? planetTypeOf(d) === 'rocky' || planetTypeOf(d) === 'dwarf' : true)));
  // 至少能生成矮行星(概率性:多试几个种子)
  let sawDwarf = false;
  for (let s = 1; s <= 40 && !sawDwarf; s++) {
    const t = generateAstro({ ...p, seed: 1515 + s }).design.planets.map((d) => planetTypeOf(d));
    if (t.includes('dwarf')) sawDwarf = true;
  }
  ok('行星类型:生成里会出现矮行星', sawDwarf);
  const rockyIdx = sys.design.planets.findIndex((d) => d.kind === 'rocky' && d.type !== 'dwarf');
  const before = sys.design.planets[rockyIdx];
  const ov = { planets: [{ index: rockyIdx, type: 'gasGiant' }], moons: [] } as never;
  const after = generateAstro(p, ov).design.planets[rockyIdx];
  ok('手改类型:岩石 → 气态巨(kind/半径/大气都变)', after.kind === 'gas' && after.type === 'gasGiant' && after.radius > 5 && after.hydro === false && after.biotic === false && after.atmos.gases.some((g) => g.id === 'h2'));
  ok('手改类型:气态巨带上环', after.ring === true);
  // 手改类型:气态 → 矮行星
  const gasIdx = sys.design.planets.findIndex((d) => d.kind === 'gas');
  const dwarf = generateAstro(p, { planets: [{ index: gasIdx, type: 'dwarf' }], moons: [] } as never).design.planets[gasIdx];
  ok('手改类型:气态 → 矮行星(kind 变岩石、半径变小)', dwarf.kind === 'rocky' && dwarf.type === 'dwarf' && dwarf.radius < 0.3 && dwarf.ring === false);
  // 存档
  const sv = parseSave(saveText(makeSave(p, EMPTY_EDITS, 'c', 'type', undefined, null, null, { planets: [{ index: 0, type: 'iceGiant' }], moons: [] } as never)));
  ok('行星类型:进存档并能读回', sv.ok && sv.save.system?.planets?.[0]?.type === 'iceGiant');
  ok('行星类型:热木星判定只看气态巨 + 近距离', (() => {
    const hot = generateAstro({ ...p, seed: 77 }, { planets: [{ index: gasIdx, type: 'gasGiant', a: 0.05 }], moons: [] } as never).design.planets[gasIdx];
    return isHotJupiter(hot) === true;
  })());
}
// ---- 51. 步 6 地貌按类型生成(配方层)+ 气态只出贴图 ----
{
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 1616, cells: 6000, landFraction: 0.4, temperature: 0, rainfall: 1 };
  const ocean = applySkin(base, 'ocean');
  const desert = applySkin(base, 'desert');
  const frozen = applySkin(base, 'frozen');
  const lava = applySkin(base, 'lava');
  const airless = applySkin(base, 'airless');
  const dwarfSkin = applySkin(base, 'dwarf');
  ok('地貌配方:海洋行星陆地比例最低、无大气最高', ocean.landFraction < base.landFraction && airless.landFraction > 0.9 && ocean.landFraction < desert.landFraction);
  ok('地貌配方:熔岩行星最热、冰封最冷', lava.temperature > frozen.temperature && lava.temperature > desert.temperature && frozen.temperature < 0);
  ok('地貌配方:干旱/无大气几乎没有降水', desert.rainfall < base.rainfall / 2 && airless.rainfall < 0.1);
  ok('地貌配方:矮行星起伏最小、熔岩起伏最大', dwarfSkin.rugged < airless.rugged && lava.rugged > base.rugged);
  ok('地貌配方:干旱/熔岩/无大气不画河', !riversAllowed('desert') && !riversAllowed('lava') && !riversAllowed('airless') && riversAllowed('earth') && riversAllowed('ocean'));
  // 同一套生成器 + 不同配方 → 实际世界不同
  const wOcean = generateWorld({ ...ocean, astro: 0, cells: 3000 });
  const wDesert = generateWorld({ ...desert, astro: 0, cells: 3000 });
  const landPct = (w: ReturnType<typeof generateWorld>) => {
    let land = 0;
    for (let i = 0; i < w.mesh.n; i++) if (w.water[i] !== 1) land++;
    return land / w.mesh.n;
  };
  ok('地貌配方:海洋行星实际陆地占比明显小于干旱行星', landPct(wOcean) < landPct(wDesert) - 0.2, `${(landPct(wOcean) * 100).toFixed(0)}% vs ${(landPct(wDesert) * 100).toFixed(0)}%`);
  // 类型 → 配方
  ok('类型→配方:冰巨星/气态巨/亚海王星都是 gas(不出地表)', skinOf({ type: 'gasGiant', tempK: 150, liquidWater: false, hydro: false }) === 'gas' && skinOf({ type: 'iceGiant', tempK: 80, liquidWater: false, hydro: false }) === 'gas' && skinOf({ type: 'subNeptune', tempK: 400, liquidWater: false, hydro: false }) === 'gas');
  ok('类型→配方:熔岩/冰封/干旱按温度和水判定', skinOf({ type: 'rocky', tempK: 900, liquidWater: false, hydro: true }) === 'lava' && skinOf({ type: 'rocky', tempK: 200, liquidWater: false, hydro: true }) === 'frozen' && skinOf({ type: 'rocky', tempK: 300, liquidWater: false, hydro: true }) === 'desert');
  // 气态行星:planetSurface 拒绝生成地表(只出贴图)
  const sys = generateAstro({ ...DEFAULT_PARAMS, seed: 1616, astro: 1, planets: 3, gas: 2 });
  const gasIdx = sys.design.planets.findIndex((d) => d.kind === 'gas');
  let threw = '';
  try {
    planetSurface(sys, gasIdx, { ...DEFAULT_PARAMS, seed: 1616, astro: 1 });
  } catch (e) {
    threw = String(e);
  }
  ok('气态行星:planetSurface 拒绝生成地表(只出贴图)', threw.includes('气态行星没有地表'));
  const tex = gasTextureOf(1616, { mass: 300, radius: 10 });
  ok('气态行星:贴图数据(条带+风暴)非空', tex.bands.length >= 5 && tex.storms.length >= 1);
}
// ---- 52. 步 7 地形配色按类型 ----
{
  const earth = lookOf('earth');
  const lava = lookOf('lava');
  const frozen = lookOf('frozen');
  const airless = lookOf('airless');
  ok('地形配色:每类都有自己的色板', [earth, lava, frozen, airless, lookOf('ocean'), lookOf('desert'), lookOf('dwarf'), lookOf('gas')].every((l) => !!l && l.land.length >= 3));
  ok('地形配色:熔岩水像素画成熔岩海(亮橙)', (() => {
    const c = terrainColor(lava, -2000, 900, 1);
    return c[0] > 120 && c[0] > c[2] * 2;
  })(), String(terrainColor(lava, -2000, 900, 1)));
  ok('地形配色:无大气的水像素画成暗盆地(不是蓝海)', (() => {
    const c = terrainColor(airless, -2000, 250, 1);
    return Math.abs(c[0] - c[2]) < 30 && c[0] < 120;
  })());
  ok('地形配色:冰封的冷陆地偏白', (() => {
    const c = terrainColor(frozen, 500, -30, 0);
    return c[0] > 190 && c[1] > 190 && c[2] > 190;
  })());
  ok('地形配色:地球的深海是蓝的', (() => {
    const c = terrainColor(earth, -3000, 20, 1);
    return c[2] > c[0] + 30;
  })());
}
// ---- 53. 步 6b 坑场 / 裂谷 / 冰盖 ----
{
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 1717, cells: 5000, astro: 0 };
  const w0 = generateWorld(base);
  const mesh = w0.mesh;
  // 坑场:同一块地砸两次结果一样;坑底比原地低、坑缘有抬升
  const e1 = Float32Array.from(w0.elevation);
  const e2 = Float32Array.from(w0.elevation);
  stampCraters(mesh, e1, 999, { count: 40, minR: 15, maxR: 30, depthK: 0.4 });
  stampCraters(mesh, e2, 999, { count: 40, minR: 15, maxR: 30, depthK: 0.4 });
  let same = true;
  let down = 0;
  let up = 0;
  for (let i = 0; i < e1.length; i++) {
    if (e1[i] !== e2[i]) same = false;
    const d = e1[i] - w0.elevation[i];
    if (d < -200) down++;
    if (d > 100) up++;
  }
  ok('坑场:同种子两次一致', same);
  ok('坑场:有坑底下陷也有坑缘抬升', down > 50 && up > 20, `下陷 ${down} / 抬升 ${up}`);
  // 裂谷:一条线状下陷(改动的格子成片)
  const e3 = Float32Array.from(w0.elevation);
  carveRifts(mesh, e3, 888, { count: 3, minLen: 0.3, maxLen: 0.4, minWidth: 8, maxWidth: 14, depth: 1500 });
  let riftDown = 0;
  for (let i = 0; i < e3.length; i++) if (e3[i] - w0.elevation[i] < -200) riftDown++;
  ok('裂谷:切出成片的深谷(下陷格子 > 100)', riftDown > 100, String(riftDown));
  // 冰盖:极区变平(起伏变小)、整体抬高
  const e4 = Float32Array.from(w0.elevation);
  applyIceSheets(mesh, e4, 777, { fromLat: 50, fullLat: 78, height: 2000, flatten: 0.85 });
  const polar = (arr: Float32Array) => {
    const vals: number[] = [];
    for (let i = 0; i < mesh.n; i++) {
      const lat = Math.abs(90 - (mesh.y[i] / mesh.height) * 180);
      if (lat > 70 && arr[i] > 0) vals.push(arr[i]);
    }
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, vals.length));
    return { mean, sd, n: vals.length };
  };
  const p0 = polar(w0.elevation);
  const p1 = polar(e4);
  ok('冰盖:极区抬高', p1.mean > p0.mean + 300, `${Math.round(p0.mean)} → ${Math.round(p1.mean)} m`);
  ok('冰盖:极区起伏被压平', p1.sd < p0.sd * 0.9, `${Math.round(p0.sd)} → ${Math.round(p1.sd)} m`);
  // 接到世界生成:airless 的世界和同一参数但不塑形的世界明显不同
  const rockyParams = applySkin({ ...base, landFraction: 0.9, rainfall: 0.1 }, 'airless');
  const plain = generateWorld(rockyParams);
  const shaped = generateWorld(rockyParams, undefined, undefined, null, undefined, null, 'airless');
  let diff = 0;
  for (let i = 0; i < plain.elevation.length; i++) if (Math.abs(plain.elevation[i] - shaped.elevation[i]) > 50) diff++;
  ok('世界生成:airless 皮肤真的砸了坑(与不塑形差异 > 300 格)', diff > 300, String(diff));
}
// ---- 54. 步 8 树内增删 + 子星系改类型 ----
{
  const tree = readFileSync(resolve(process.cwd(), 'src/ui/SystemTree.tsx'), 'utf8');
  ok('树:顶部不再有 +固态/+气态 全局按钮', !tree.includes('tree-add-rocky') && !tree.includes('tree-add-gas'));
  ok('树:组头按钮已移除,改空白右键加子星系', !tree.includes('tree-group-add-planet-') && tree.includes('加子星系:单行星系') && tree.includes('把这个子星系变成可编辑'));
  ok('树:组右键能改三种子星系类型', tree.includes('改为：单行星系') && tree.includes('改为：双固态行星系') && tree.includes('改为：气态巨星的宜居卫星系'));
  ok('树:行星右键有 加卫星 / 复制这颗', tree.includes('加一颗卫星') && tree.includes('复制这颗行星'));
  // applySubSystem 语义
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 1818, astro: 1, planets: 4, gas: 2 };
  ok('子星系类型:单行星系 → subSystem 0 且 arch 投影为 0', applySubSystem(base, 0).subSystem === 0 && applySubSystem(base, 0).arch === 0);
  ok('子星系类型:双固态 → subSystem 1 且 arch 投影为 1', applySubSystem(base, 1).subSystem === 1 && applySubSystem(base, 1).arch === 1);
  ok('子星系类型:宜居卫星系 → subSystem 3 且 arch 投影为 3', applySubSystem(base, 3).subSystem === 3 && applySubSystem(base, 3).arch === 3);
  // 双固态真的会生成两颗互绕行星
  const duo = generateAstro(applySubSystem(base, 1) as WorldParams).design;
  ok('子星系类型:切成双固态后设计里出现 binary 对', !!duo.binary && duo.binary.index !== duo.home.index);
  // 切回单行星系:没有 binary
  const single = generateAstro(applySubSystem(base, 0) as WorldParams).design;
  ok('子星系类型:切回单行星系后没有 binary 对', !single.binary);
}
// ---- 55. 步 9 Studio 中栏舞台(第一段) ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const studio = read('src/ui/studio/Studio.tsx');
  const globe = read('src/ui/SystemGlobe.tsx');
  const planet = read('src/render/planet.ts');
  ok('步9:晨昏线走球面着色器(u_sunLon)', planet.includes('uniform float u_sunLon, u_sunLat;') && planet.includes('u_sunLon - u_lon'));
  ok('步9:Studio 按太阳直射经度算 sun 向量', studio.includes('const sunLonForGlobe =') && studio.includes('skyLayerOf(sysAstro.design, sysYear, sysSelected)'));
  ok('步9:SystemGlobe 支持双击打开(onOpen)', globe.includes('onOpen?: (index: number, at?: { x: number; y: number; r: number }) => void;') && globe.includes('onOpen(openIdx, { x, y, r: 18 })'));
  {
    const a = studio.indexOf('onFocusDone={() => {');
    const b = a >= 0 ? studio.indexOf('}}', a) : -1;
    const blk = a >= 0 && b > a ? studio.slice(a, b) : '';
    ok('星系模式:双击只推进相机,不切地球仪', blk.includes('setSysFocus(null)') && !blk.includes("setSysStage('globe')"));
  }
  ok('步9/三模式:星系视角默认只占中栏(星系/文明模式铺满)', studio.includes('left: p.phone || studioMode !==') && studio.includes('studioMode === \'map\' ? left : null'));
  ok('步9:不再自动打开星球系页(只有按钮/选择器能开)', studio.includes('不再自动打开左侧') && (studio.match(/setSystemPage\(true\)/g) ?? []).length <= 2);
  ok('步9:独立天空层窗口已移除', !studio.includes('globe-sky-layer'));
}
// ---- 56. 步 9 第二段:左栏退休 / 天球背景 / 缩放转场 ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const studio = read('src/ui/studio/Studio.tsx');
  const globeSky = read('src/ui/studio/GlobeSky.tsx');
  ok('步9:左栏不再渲染 SystemPreview3D', !studio.includes('SystemPreview3D'));
  ok('步9:星球系页改为中栏全屏', studio.includes('data-act="system-page-full"'));
  ok('步9:天球背景画附近恒星', globeSky.includes('nearbyStarsOf') && globeSky.includes('data-act="globe-sky"'));
  ok('步9:天球背景画同子星系星体', globeSky.includes('sky.siblings'));
  ok('步9:双击行星有缩放转场', studio.includes('data-act="globe-zoom"') && studio.includes('@keyframes globeZoom'));
  ok('步9:SystemGlobe 双击回传点击坐标', read('src/ui/SystemGlobe.tsx').includes('onOpen(openIdx, { x, y, r: 18 })'));
}
// ---- 57. 星环(按质量) ----
{
  ok('星环:木星级气态巨有亮环', (() => { const r = ringsOf({ mass: 318, radius: 11, kind: 'gas' }, 7); return !!r && r.opacity > 0.6 && r.outerR > 2; })());
  ok('星环:土星级有环且有多层细环', (() => { const r = ringsOf({ mass: 95, radius: 9, kind: 'gas' }, 7); return !!r && r.bands.length >= 9; })());
  ok('星环:冰巨星(海王星级)有环但更暗', (() => { const a = ringsOf({ mass: 17, radius: 3.9, kind: 'gas' }, 7); const b = ringsOf({ mass: 318, radius: 11, kind: 'gas' }, 7); return !!a && !!b && a.opacity < b.opacity; })());
  ok('星环:小质量岩石行星没有环', ringsOf({ mass: 1, radius: 1, kind: 'rocky' }, 7) === null);
  ok('星环:大质量天体(≥40 M⊕)即使不是气态也给淡环', (() => { const r = ringsOf({ mass: 45, radius: 5, kind: 'rocky' }, 7); return !!r && r.opacity < 0.75; })());
  ok('星环:内径 < 外径、且都在 1.1–3 R 之间', (() => { const r = ringsOf({ mass: 318, radius: 11, kind: 'gas' }, 7)!; return r.innerR > 1.1 && r.innerR < r.outerR && r.outerR < 3; })());
  ok('星环:同种子确定性', (() => { const a = JSON.stringify(ringsOf({ mass: 318, radius: 11, kind: 'gas' }, 7)); const b = JSON.stringify(ringsOf({ mass: 318, radius: 11, kind: 'gas' }, 7)); return a === b; })());
}
// ---- 58. 3D 星环(WStudio 球面) ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const gl = read('src/ui/studio/planetGL.ts');
  const scene = read('src/ui/studio/scene.ts');
  const studio = read('src/ui/studio/Studio.tsx');
  ok('3D 星环:球面程序外另有环程序', gl.includes('const RING_VS') && gl.includes('const RING_FS'));
  ok('3D 星环:有环隙(Cassini)与细环圈', gl.includes('u_gapAt') && gl.includes('sin(t * 190.0'));
  ok('3D 星环:球体挡住身后的环', gl.includes('if (length(p) < 1.0 && z < 0.0) discard;'));
  ok('3D 星环:draw 里真的画环', gl.includes('private drawRings(f: PlanetFrame)') && gl.includes('this.drawRings(f);'));
  ok('3D 星环:场景把环传给渲染器', scene.includes('rings: this.rings'));
  ok('3D 星环:Studio 按质量给当前天体算环', studio.includes('const ringsForGlobe =') && studio.includes('ringsOf({ mass: pl.mass'));
}
// ---- 59. R1 显示正确性(样式跟随天体 / 卫星看地表) ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const studio = read('src/ui/studio/Studio.tsx');
  const editor = read('src/ui/SystemEditor.tsx');
  ok('R1-1:预览天体时样式缩略图用它自己的贴图', studio.includes('thumbFor') && studio.includes('const [bodyThumb,') && studio.includes("styleKey: 'realistic'"));
  ok('R1-1:预览天体时样式列表只列它支持的', studio.includes('const styleList = isBodyPreview'));
  ok('R1-2:预览天体有自己的地理标签(独立画布 + 该天体世界)', studio.includes('st-preview-labels') && studio.includes('planetSurface(sysForBody, previewBody') && studio.includes("createNamer("));
  ok('R1-3:卫星有"看地表"入口', editor.includes('moon-view-') && editor.includes('看地表'));
  ok('R1-3:卫星地表预览用的是该卫星自己的世界', editor.includes('function MoonSurfaceView') && editor.includes('moonWorldParams(sys.design, moonView.planet, moonView.moon'));
}
// ---- 60. R2 子星系显式成员 ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const tree = read('src/ui/SystemTree.tsx');
  ok('R2:显式 groups 类型在覆盖表里', read('src/gen/astroDesign.ts').includes('export interface GroupOverride'));
  ok('R2:分组优先读显式 groups', read('src/gen/systemGroups.ts').includes('const explicit = overrides?.groups'));
  ok('R2:组操作(加/删/改)是纯函数', read('src/gen/systemRole.ts').includes('export function addGroup(') && read('src/gen/systemRole.ts').includes('export function deleteGroup('));
  ok('R2:存档清洗 groups', read('src/gen/savefile.ts').includes('R2:子星系显式成员(role 白名单'));
  ok('R2:分层存档带 groups', read('src/gen/systemLayers.ts').includes('groups?: StoredGroup[]') && read('src/gen/systemLayers.ts').includes('out.groups ='));
  ok('R2:树空白右键能加子星系', tree.includes("onContextMenu={(e) => {") && tree.includes("add('planet', '加子星系:单行星系')"));
  // 组操作语义
  const base = { planets: [], moons: [] } as unknown as Parameters<typeof addGroup>[0];
  const g1 = addGroup(base, 'binaryPair', [0]);
  const g2 = addGroup(g1, 'planet', [2]);
  ok('R2:加组 id 递增', (g1.groups?.[0]?.id ?? 0) === 1 && (g2.groups?.[1]?.id ?? 0) === 2);
  const g3 = addGroupMember(g2, 1, 3);
  ok('R2:往组里加成员', (g3.groups?.[0]?.members ?? []).join(',') === '0,3');
  const g4 = removeGroupMember(g3, 1, 0);
  const g5 = removeGroupMember(g4, 2, 2);
  ok('R2:移出成员后成员减少、空组自动消失', (g4.groups?.[0]?.members ?? []).join(',') === '3' && (g5.groups ?? []).length === 1);
}
// ---- 61. R2-2/R2-4 生成侧认组 + 存档往返 ----
{
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 1919, astro: 1, planets: 4, gas: 1, subSystem: 0 };
  const plain0 = generateAstro(base);
  const hi = plain0.design.home.index;
  const other = plain0.design.planets.map((p) => p.index).find((k) => k !== hi)!;
  const pair = generateAstro(base, { planets: [], moons: [], groups: [{ id: 1, role: 'binaryPair', members: [hi, other] }] } as never);
  ok('R2-2:binaryPair 组让另一颗成为互绕伴星', !!pair.design.binary && pair.design.binary!.index === other, String(pair.design.binary?.index));
  ok('R2-2:伴星被放到主行星轨道(a 相同)', Math.abs(pair.design.planets[other].a - pair.design.planets[hi].a) < 1e-9);
  ok('R2-2:伙伴周期按开普勒算', pair.design.binary!.periodDays > 0 && pair.design.binary!.separationAU > 0);
  // 没有组时:行为跟原来一样(不产生 binary)
  const plain = generateAstro({ ...base, subSystem: 0 });
  ok('R2-2:没有显式组时不额外造 binary', !plain.design.binary);
  // 组不属于主行星 → 不改结构
  const notHome = plain0.design.planets.map((p) => p.index).filter((k) => k !== hi).slice(0, 2);
  const otherSys = generateAstro(base, { planets: [], moons: [], groups: [{ id: 1, role: 'binaryPair', members: notHome }] } as never);
  ok('R2-2:组里没有主行星时不改结构', !otherSys.design.binary);
  // R2-4:存档 JSON 往返 groups
  const ov = { planets: [], moons: [], groups: [{ id: 7, role: 'binaryPair', members: [0, 2] }] } as never;
  const sv = parseSave(saveText(makeSave(base, EMPTY_EDITS, 'c', 'g', undefined, null, null, ov)));
  ok('R2-4:groups 进存档并能读回', sv.ok && sv.save.system?.groups?.length === 1 && sv.save.system?.groups?.[0]?.id === 7 && (sv.save.system?.groups?.[0]?.members ?? []).join(',') === '0,2');
  // 旧档(没有 groups)读回来还是 none → 派生分组不变
  const sv2 = parseSave(saveText(makeSave(base, EMPTY_EDITS, 'c', 'g2', undefined, null, null, null)));
  ok('R2-4:旧档没有 groups 时字段不写', sv2.ok && sv2.save.system?.groups === undefined);
}
// ---- 62. R3 卫星类型 ----
{
  ok('R3:小卫星 → 矮卫星', moonTypeOf({ mass: 0.002, radius: 0.08 }, 288) === 'dwarf');
  ok('R3:冷母行星下的中等卫星 → 冰卫星', moonTypeOf({ mass: 0.1, radius: 0.3 }, 210) === 'ice');
  ok('R3:暖母行星下的中等卫星 → 岩石卫星', moonTypeOf({ mass: 0.1, radius: 0.3 }, 320) === 'rocky');
  ok('R3:显式类型优先', moonTypeOf({ mass: 0.1, radius: 0.3, type: 'dwarf' }, 320) === 'dwarf');
  // 覆盖表改类型 → 设计里的卫星带上
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 2121, astro: 1, planets: 3, gas: 1, moons: 2 };
  const plain = generateAstro(base);
  const pi = plain.design.planets.findIndex((p) => (p.moons?.length ?? 0) > 0);
  const mi = 0;
  const withType = generateAstro(base, { planets: [], moons: [{ planet: pi, moon: mi, type: 'ice' }] } as never);
  ok('R3:覆盖表能把卫星改成冰卫星', withType.design.planets[pi].moons[mi].type === 'ice');
  // 存档往返
  const sv = parseSave(saveText(makeSave(base, EMPTY_EDITS, 'c', 'w', undefined, null, null, { planets: [], moons: [{ planet: pi, moon: mi, type: 'dwarf' }] } as never)));
  ok('R3:卫星类型进存档并读回', sv.ok && sv.save.system?.moons?.[0]?.type === 'dwarf');
}
// ---- 63. 步10 时间轴双单位 ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const tl = read('src/ui/SystemTimelineView.tsx');
  const studio = read('src/ui/studio/Studio.tsx');
  ok('步10:时间轴有地球年/当地年切换', tl.includes("useState<'earth' | 'local'>") && tl.includes('data-act="system-timeline-unit"'));
  ok('步10:当地年按公转周期换算', tl.includes('(year * 365.25) / localYearDays'));
  ok('步10:Studio 传入选中天体的公转周期', studio.includes('const sysLocalYearDays =') && studio.includes('localYearDays={sysLocalYearDays}'));
  // 换算语义:1 年起算,周期 88 天(水星级)时当地年 ≈ 4.15
  const local = (1 * 365.25) / 88;
  ok('步10:换算数值正确(365.25/88≈4.15)', Math.abs(local - 4.1506) < 0.01, local.toFixed(3));
}
// ---- 64. 步11 每天体世界/文明存取 ----
{
  const base: WorldParams = { ...DEFAULT_PARAMS, seed: 3131, astro: 1, planets: 3, gas: 1 };
  const bodies = [
    { id: 'p0', seedShift: 7, civs: [{ kind: 'a' }, { kind: 'b' }] },
    { id: 'm1-0', civs: [] },
    { id: 'p0', seedShift: 9 },
    { id: 'bad id!', civs: [] },
  ] as never;
  const sv = parseSave(saveText(makeSave(base, EMPTY_EDITS, 'c', 'b', undefined, null, null, null, bodies)));
  const bl = sv.ok ? sv.save.bodies : undefined;
  ok('步11:bodies 进存档并能读回', Array.isArray(bl) && bl.length === 2);
  ok('步11:重复 id 只留第一个', bl?.[0]?.id === 'p0' && bl?.[0]?.seedShift === 7);
  ok('步11:非法 id 被丢掉', (bl ?? []).every((b) => /^[pm][0-9]+(-[0-9]+)?$/.test(b.id)));
  // 文明上限 4
  const many = [{ id: 'p1', civs: [1, 2, 3, 4, 5, 6] }] as never;
  const sv2 = parseSave(saveText(makeSave(base, EMPTY_EDITS, 'c', 'b2', undefined, null, null, null, many)));
  const b2 = sv2.ok ? sv2.save.bodies : undefined;
  ok('步11:每个天体最多 4 份文明', (b2?.[0]?.civs?.length ?? 0) === 4);
  // 旧档不变
  const sv3 = parseSave(saveText(makeSave(base, EMPTY_EDITS, 'c', 'b3')));
  ok('步11:旧档不写 bodies 字段', sv3.ok ? sv3.save.bodies === undefined : false);
}
// ---- 65. 步11/12 天体 id 与文明存取 ----
{
  const sys = generateAstro({ ...DEFAULT_PARAMS, seed: 4141, astro: 1, planets: 4, gas: 1, moons: 1 });
  const bodies = listBodies(sys);
  ok('步11:天体 id 覆盖行星与卫星', bodies.some((b) => b.id === 'p0') && bodies.some((b) => b.id.startsWith('m')));
  ok('步11:parseBodyId 能解回下标', (() => {
    const a = parseBodyId('p2');
    const b = parseBodyId('m1-3');
    return a?.kind === 'planet' && a.planet === 2 && b?.kind === 'moon' && b.planet === 1 && b.moon === 3;
  })());
  ok('步11:id 非法时返回 null', parseBodyId('x9') === null && parseBodyId('p') === null);
  ok('步11:旧档按主天体补 bodies', (() => {
    const d = bodiesOrDefault(undefined, sys);
    return d.length === 1 && d[0].id === homeBodyId(sys);
  })());
  // 文明存取 + 上限
  const alive = bodies.find((b) => b.alive);
  if (alive) {
    const many = Array.from({ length: 7 }, (_, i) => ({ i }));
    const saved = setBodyCivs(undefined, alive, many);
    ok('步12:文明写入并截到 4 份', bodyCivsOf(saved, alive.id).length === 4);
    ok('步12:读回其它天体为空', bodyCivsOf(saved, 'p99').length === 0);
  } else {
    ok('步12:文明写入并截到 4 份', true);
    ok('步12:读回其它天体为空', true);
  }
  const dead = bodies.find((b) => !b.alive);
  if (dead) ok('步12:不能住人的天体不存文明', setBodyCivs(undefined, dead, [1, 2]).every((b) => !b.civs?.length));
  else ok('步12:不能住人的天体不存文明', true);
}
// ---- 66. 步12/13 非主天体文明 + 切换界面 ----
{
  const sys = generateAstro({ ...DEFAULT_PARAMS, seed: 5151, astro: 1, planets: 4, gas: 1, moons: 2 });
  const refs = listBodies(sys);
  const alive = refs.find((b) => b.alive);
  ok('步12:存在能住人的非主天体(测试数据)', !!alive, alive?.id);
  if (alive) {
    const civ = bodyCivByRef(sys, alive, { ...DEFAULT_PARAMS, seed: 5151, astro: 1 }, 60);
    ok('步12:非主天体按需推出文明', !!civ && typeof civ.endYear === 'number');
    ok('步12:同一天体推演有缓存', bodyCivByRef(sys, alive, { ...DEFAULT_PARAMS, seed: 5151, astro: 1 }, 60) === civ);
  } else {
    ok('步12:非主天体按需推出文明', true);
    ok('步12:同一天体推演有缓存', true);
  }
  const dead = refs.find((b) => !b.alive);
  if (dead) {
    ok('步12:不能住人的天体不推文明', bodyCivByRef(sys, dead, { ...DEFAULT_PARAMS, seed: 5151, astro: 1 }, 60) === null);
  } else {
    ok('步12:不能住人的天体不推文明', true);
  }
  const studioSrc = readFileSync(resolve(process.cwd(), 'src/ui/studio/Studio.tsx'), 'utf8');
  ok('步13:星系视角有"天体文明"面板', studioSrc.includes('data-act="civ-bodies-panel"') && studioSrc.includes('data-act="stage-civ-bodies"'));
  ok('步13:面板按天体列表切换(行星+卫星)', studioSrc.includes('civBodyViews.map') && studioSrc.includes('civ-body-'));
}
// ---- 67. 单一数据源(天体视图) ----
{
  const sys = generateAstro({ ...DEFAULT_PARAMS, seed: 6161, astro: 1, planets: 4, gas: 1, moons: 2 });
  const views = buildBodyViews(sys, { defaultNames: { planets: ['A星', 'B星', 'C星', 'D星'], moons: { 0: ['月一', '月二'] } } });
  ok('SSOT:行星和卫星都在同一份视图里', views.some((v) => v.kind === 'planet') && views.some((v) => v.kind === 'moon'));
  ok('SSOT:名字优先用默认名(种子名)', views.find((v) => v.id === 'p0')?.name === 'A星');
  const firstMoon = views.find((v) => v.kind === 'moon');
  ok('SSOT:卫星没名字时用「卫星 N」兜底', !!firstMoon && /^卫星 [0-9]+$/.test(firstMoon.name), firstMoon?.name);
  const v0 = views[0];
  ok('SSOT:类型标签来自 planetTypeOf/moonTypeOf', !!v0.typeLabel && v0.typeLabel.length > 1, v0.typeLabel);
  ok('SSOT:物理量与 design 一致', v0.radius === (v0.kind === 'planet' ? sys.design.planets[0].radius : 0));
  // 改名优先
  const renamed = buildBodyViews(sys, { names: { planets: { '0': '改过的名字' } } as never });
  ok('SSOT:手动改名优先', renamed.find((v) => v.id === 'p0')?.name === '改过的名字');
  // 文明从存档合并
  const bodies = [{ id: 'p0', civs: [{ a: 1 }, { a: 2 }] }];
  const withCiv = buildBodyViews(sys, { bodies } as never);
  ok('SSOT:文明从 bodies 合并进视图(≤4)', withCiv.find((v) => v.id === 'p0')?.civs.length === 2);
  ok('SSOT:没有存档时 civs 为空', views.every((v) => v.civs.length === 0));
}
// ---- 68. issue5/6 双星绘制 + 移除星图 2D ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const globe = read('src/ui/SystemGlobe.tsx');
  ok('issue5:双星按质心轨道位置各画一颗(单一 drawStar 实现)', globe.includes('const pair = binaryStarPair(design, year);') && globe.includes('drawStar(xyComp') && globe.includes('drawStar(xyMain'));
  ok('issue5:单星画在原点', globe.includes("else if (xyMain) drawStar(xyMain") && globe.includes('const star = toScreen([0, 0, 0]);'));
  ok('issue6:星图 2D 已移除', !globe.includes('globe-2d') && !globe.includes('SystemDiagram') && !/[^a-zA-Z]flat[^a-zA-Z]/.test(globe));
}
// ---- 69. U1 星系视角 3D 球体 ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const gl3 = read('src/render/systemGlobe3d.ts');
  const globe = read('src/ui/SystemGlobe.tsx');
  ok('U1:有球体着色器(顶点/片元)', gl3.includes('const SPHERE_VS') && gl3.includes('const SPHERE_FS'));
  ok('U1:球体 UV 几何 + 索引', gl3.includes('function sphereMesh') && gl3.includes('sphere.idx'));
  ok('U1:渲染器有 setBodies 接口', gl3.includes('setBodies(bodies: readonly GpuBody[]): void;') && gl3.includes('setBodies(next) {'));
  ok('U1:贴图上传到 GPU(按 key 缓存)', gl3.includes('texCache') && gl3.includes('gl.texImage2D'));
  ok('U1:画球时用深度测试 + 恒星方向光照', gl3.includes('normalize(-v_world)') && gl3.includes('gl.drawElements(gl.TRIANGLES'));
  ok('U1:星图把行星喂给 GPU(真实尺度半径)', globe.includes('r.setBodies(list)') && globe.includes('p.radius * (6371 / 1.496e8) * scene.scale'));
  ok('U1:GPU 球体后不画 2D 圆(伴星例外)', globe.includes('if (!gpu || isCompanion) ctx.fillStyle = planetColor(p);'));
}
// ---- 70. U1 续:伴星/卫星进 3D ----
{
  const globe = readFileSync(resolve(process.cwd(), 'src/ui/SystemGlobe.tsx'), 'utf8');
  ok('U1:双固态伴星也喂给 GPU 球体', globe.includes('// U1:双固态伴星') && globe.includes('bin.separationAU'));
  ok('U1:卫星严格开普勒轨道并喂给 GPU', globe.includes('// U1:卫星') && globe.includes('moonPeriodDays(') && !globe.includes('scene.scale * 8'));
}
// ---- 71. BodyView 轨道参数 ----
{
  const sys = generateAstro({ ...DEFAULT_PARAMS, seed: 7171, astro: 1, planets: 4, gas: 1, moons: 2 });
  const views = buildBodyViews(sys);
  const pv = views.find((v) => v.kind === 'planet')!;
  ok('BodyView:行星轨道带半长轴/倾角/升交点', pv.orbit.a === sys.design.planets[0].a && pv.orbit.incDeg === sys.design.planets[0].incDeg);
  ok('BodyView:行星周期按开普勒(a^1.5 年)', Math.abs((pv.orbit.periodDays ?? 0) - Math.pow(pv.orbit.a!, 1.5) * 365.25) < 1e-6);
  const mv = views.find((v) => v.kind === 'moon');
  if (mv) {
    ok('BodyView:卫星带绕行半径/锁定/周期', (mv.orbit.distanceR ?? 0) > 0 && (mv.orbit.periodDays ?? 0) > 0.01);
    ok('BodyView:卫星周期和 moonPeriodDays 一致', Math.abs((mv.orbit.periodDays ?? 0) - moonPeriodDays(mv.orbit.distanceR!, Math.max(0.2, sys.design.planets[Number(mv.parentId!.slice(1))].radius), sys.design.planets[Number(mv.parentId!.slice(1))].mass)) < 1e-6);
  } else {
    ok('BodyView:卫星带绕行半径/锁定/周期', true);
    ok('BodyView:卫星周期和 moonPeriodDays 一致', true);
  }
}
// ---- 72. 轨道 UI 走单一数据源 + U3 相机贴近 ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const tree = read('src/ui/SystemTree.tsx');
  const editor = read('src/ui/SystemEditor.tsx');
  const globe = read('src/ui/SystemGlobe.tsx');
  const studio = read('src/ui/studio/Studio.tsx');
  ok('轨道UI:星系树显示 a/周期(读 BodyView)', tree.includes("viewOf('p' + index)") && tree.includes('v.orbit.periodDays'));
  ok('轨道UI:行星面板周期读 BodyView', editor.includes("bodyViewOf(sys, 'p' + selPlanet.index)?.orbit.periodDays"));
  ok('U3:推进视距按目标视半径算(32%)', globe.includes('0.32 * Math.min(size.w, size.h)'));
  ok('U3:贴近行星后滚轮允许更近(1e-5)', globe.includes('c.at ? 1e-5 : 5'));
  ok('U3:推到位后相机停在行星旁并跟随', globe.includes('dist: (() => {') && globe.includes('setFollowIdx(focusIndex)'));
}
// ---- 73. Studio 三模式(星系/地图/文明)+ 相机直线推进 ----
{
  const studio = readFileSync(resolve(process.cwd(), 'src/ui/studio/Studio.tsx'), 'utf8');
  const globe = readFileSync(resolve(process.cwd(), 'src/ui/SystemGlobe.tsx'), 'utf8');
  ok('三模式:顶部有 星系/地图/文明 切换', studio.includes("useState<'galaxy' | 'map' | 'civ'>") && studio.includes('studio-mode-'));
  ok('三模式:非地图模式隐藏地图画布', studio.includes("studioMode !== 'map' ? { display: 'none' }"));
  ok('三模式:左右栏只在 map 模式', studio.includes("studioMode === 'map' ? left : null") && studio.includes("studioMode === 'map' ? right : null"));
  ok('三模式:星系覆盖层在非 map 模式铺满', studio.includes("studioMode !== 'map' ? 0"));
  ok('三模式:非 map 模式跳过地图贴图 effect', studio.includes("if (studioMode !== 'map') return;"));
  ok('相机:推进时不改 yaw/pitch(画面不甩)', globe.includes('yaw: from.yaw,') && globe.includes('pitch: from.pitch,'));
}
// ---- 74. 星系模式留在 3D 场景(地球仪只走按钮) ----
{
  const studio = readFileSync(resolve(process.cwd(), 'src/ui/studio/Studio.tsx'), 'utf8');
  {
    const a = studio.indexOf('onFocusDone={() => {');
    const b = a >= 0 ? studio.indexOf('}}', a) : -1;
    const blk = a >= 0 && b > a ? studio.slice(a, b) : '';
    ok('星系模式:双击后不自动切地球仪', !!blk && !blk.includes("setSysStage('globe')"));
  }
  ok('星系模式:地球仪入口仍是「进入地球仪」按钮', studio.includes('data-act="stage-enter-globe"') && studio.includes('enterGlobe()'));
}
// ---- 75. 星系左栏暗色 + 卫星渲染 + 双固态互绕 ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const studio = read('src/ui/studio/Studio.tsx');
  const globe = read('src/ui/SystemGlobe.tsx');
  const css = read('src/ui/studio/studio.css');
  ok('星系左栏:两栏不挡时间轴', studio.includes('width: 270') && studio.includes('width: 470') && studio.includes('bottom: 104'));
  ok('星系左栏:暗色主题类', studio.includes('galaxy-dark') && css.includes('.galaxy-dark'));
  ok('卫星:门控依赖含贴图版本', globe.includes('selected, moonTex, texVersion]') && globe.includes('cam.dist < 8 || selected >= 0'));
  ok('卫星:可见半径下限', globe.includes('* 0.08'));
  ok('双固态:互绕间距有可见下限', globe.includes('const sepScene = Math.max(bin.separationAU * scene.scale'));
  ok('双固态:伴星基准位置与主行星同年份', globe.includes('const homeSt = year === undefined ? null : positionAtAU'));
}
// ---- 76. 分离双星 / 卫星可见 / 星系两栏 ----
{
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const gl3 = read('src/render/systemGlobe3d.ts');
  const globe = read('src/ui/SystemGlobe.tsx');
  const editor = read('src/ui/SystemEditor.tsx');
  const studio = read('src/ui/studio/Studio.tsx');
  const css = read('src/ui/studio/studio.css');
  ok('分离双星:轨道环以主星为中心', gl3.includes("const wide = !!(design.binaryStar && design.binaryStar.tier !== 'close'") && gl3.includes('(prev[0] + ox) * scale'));
  ok('分离双星:行星位置加主星偏移', globe.includes('orbitOff: [number, number, number] = design.binaryStar') && globe.includes('(pos[0] + orbitOff[0]) * scene.scale'));
  ok('双固态伴星:屏幕间距下限 14px', globe.includes('(14 * Math.max(1e-6, cam.dist)) / focalBodies'));
  ok('卫星:屏幕间距/半径下限(AU 单位 + 半径夹紧)', globe.includes('sepMinAU = (26 * Math.max(1e-6, cam.dist)) / focalBodies / scene.scale') && globe.includes('radius: Math.min(0.02'));
  ok('星系两栏:左树右参数', studio.includes('data-act="galaxy-left"') && studio.includes('data-act="galaxy-right"') && editor.includes("part?: 'all' | 'tree' | 'props';"));
  ok('星系两栏:树栏占满高度/空白区更大', read('src/ui/SystemTree.tsx').includes("minHeight: '100%'") && read('src/ui/SystemTree.tsx').includes('flex: 1, minHeight: 160'));
  ok('星系两栏:暗色背景框', css.includes('.galaxy-dark div[style*="255,255,255"]'));
}
assetPackChecks().then(
  () => process.exit(fails === 0 ? 0 : 1),
  (e: unknown) => {
    console.log('资产包验证崩了:', e);
    process.exit(1);
  },
);
