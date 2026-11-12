/**
 * 本地用:把选定的世界整理成设定资料 + 编年史,并打印一份可读的摘要。
 * 运行:node_modules/.bin/tsx scripts/local-export.ts <seed> [key=value ...]
 *   key=value 覆盖 WorldParams(如 continents=5);另认 years=3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateWorld, DEFAULT_PARAMS, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { BIOMES } from '../src/gen/biomes';
import { geometryOf } from '../src/gen/geometry';
import { buildChronicle, filterChronicle, chronicleDocument, entryYearLabel } from '../src/gen/civ/story/chronicle';
import { capitalAt, polityAlive, polityName } from '../src/gen/civ/growth';
import { warStats } from '../src/gen/civ/wars';
import { dynastyStats } from '../src/gen/civ/dynasty';
import { astroOf } from '../src/gen/astro';
import { nameAstro } from '../src/gen/astroNames';
import { planetSummary, planSurfaces, planetSurface, planetSurfaceStats } from '../src/gen/astroWorlds';
import { omensOf, omenDocument, OMEN_NAMES } from '../src/gen/civ/story/omen';
import { geologyOf } from '../src/gen/geology';

const MIX = { central: 4, imperial: 3, kingdom: 3, frontier: 2, nordic: 2, slavic: 1, hellenic: 1, desert: 1, steppe: 1 };

const args = process.argv.slice(2);
const seed = Number(args.find((a) => !a.includes('=')) ?? 1);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);

const params = { ...DEFAULT_PARAMS, seed } as WorldParams;
for (const a of args) {
  const [k, v] = a.split('=');
  if (!v || k === 'years' || k === 'mix' || k === 'seed') continue;
  if (k in DEFAULT_PARAMS) (params as any)[k] = Number(v);
}
const years = Number(opt('years') ?? 3000);
const tag = opt('tag') ?? `seed-${seed}`;

const w = generateWorld(params);
const civ = generateCiv(w, { endYear: years, names: MIX });
const n = w.mesh.n;
const geo = geometryOf(w.mesh);
const area = geo.cellAreas();
const lat = (i: number) => geo.latitude(i);

// ---- 星球概况 ----
let landA = 0;
let total = 0;
for (let i = 0; i < n; i++) {
  total += area[i];
  if (w.water[i] !== 1) landA += area[i];
}
const bA = new Map<number, number>();
for (let i = 0; i < n; i++) bA.set(w.biome[i], (bA.get(w.biome[i]) ?? 0) + area[i]);
const biomes = [...bA].sort((a, b) => b[1] - a[1]).map(([b, a]) => `${BIOMES[b].name} ${((a / total) * 100).toFixed(1)}%`);
const tLand: number[] = [];
const pLand: number[] = [];
for (let i = 0; i < n; i++)
  if (w.water[i] !== 1) {
    tLand.push(w.temperature[i]);
    pLand.push(w.precipitation[i]);
  }
tLand.sort((a, b) => a - b);
pLand.sort((a, b) => a - b);
const med = (u: number[]) => u[Math.floor(u.length / 2)];
const bands = [[-90, -60], [-60, -30], [-30, 0], [0, 30], [30, 60], [60, 90]];
const latRow = bands.map(([a, b]) => {
  let l = 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (lat(i) < a || lat(i) >= b) continue;
    s += area[i];
    if (w.water[i] !== 1) l += area[i];
  }
  return `${a}~${b}° ${((l / s) * 100).toFixed(0)}%`;
});

// ---- 地名 ----
const places = civ.places ?? [];
const pick = (k: string, c = 12) =>
  places
    .filter((p) => p.kind === k)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, c)
    .map((p) => p.name);

// ---- 国家(结束时在世的) ----
const alive = civ.polities
  .map((p, i) => ({ p, i }))
  .filter(({ p }) => polityAlive(p, civ.endYear))
  .map(({ p, i }) => {
    const regions = [...Array(civ.regions.count).keys()].filter((r) => civ.polity[r] === i).length;
    const cap = civ.settlements[capitalAt(p, civ.endYear)]?.name ?? '?';
    return { i, name: polityName(p, civ.endYear), cap, founded: Math.floor(p.founded), regions };
  })
  .sort((a, b) => b.regions - a.regions || a.founded - b.founded);

const chronicle = buildChronicle(civ);
const major = filterChronicle(chronicle, { major: true });
const ws = warStats(civ);
const ds = dynastyStats(civ);

console.log(`世界 seed=${seed} years=${years}`);
console.log(
  `参数 ${JSON.stringify(
    Object.fromEntries(Object.entries(params).filter(([k, v]) => k !== 'seed' && (v as number) !== (DEFAULT_PARAMS as any)[k] && k !== 'cells')),
  )}`,
);
console.log(`陆 ${((landA / total) * 100).toFixed(1)}% · 气温中位 ${med(tLand).toFixed(1)}°C · 降水中位 ${Math.round(med(pLand))} mm · 最高海拔 ${Math.round(w.maxElevation)} m · 河 ${w.rivers.length} 条`);
console.log(`生态:${biomes.join(' · ')}`);
console.log(`陆地按纬度:${latRow.join(' · ')}`);
console.log(`海洋:${pick('sea', 10).join('、')}`);
console.log(`山脉:${pick('mountains', 10).join('、')}`);
console.log(`大湖:${pick('lake', 8).join('、')} 岛:${pick('island', 8).join('、')} 荒漠:${pick('desert', 8).join('、')}`);
console.log(`民族 ${civ.cultures.length} 个:${civ.cultures.map((c) => `${c.name}(${c.kind})`).join('、')}`);
console.log(`结束时在世 ${alive.length} 国、先后立国 ${civ.polities.length} 个、战争 ${ws.wars} 场、改朝换代 ${ds.eastern + ds.western} 次`);
for (const p of alive.slice(0, 12)) console.log(`  ${p.name}(立国 ${p.founded} 年,国都 ${p.cap},${p.regions} 州)`);
console.log(`编年史 ${chronicle.length} 条(大事 ${major.length}),前 15 条大事:`);
for (const e of major.slice(0, 15)) console.log(`  ${entryYearLabel(e)} ${e.text}`);

// ---- 星球系 / 天象 / 地质(没开星球系的世界这些是空) ----
const sys = astroOf(w);
if (sys) {
  const names = nameAstro(sys, seed);
  console.log(`\n星球系:${sys.star.label}「${names.star}」· 一年 ${sys.yearDays.toFixed(0)} 天 · 一天 ${sys.dayHours.toFixed(1)} 小时 · 倾角 ${sys.home.tilt.toFixed(1)}°`);
  sys.design.planets.forEach((p, i) => {
    const mark = i === sys.home.index ? ' ←主行星' : p.kind === 'gas' ? ' (气态,不做地表)' : '';
    console.log(`  ${names.planets[i]} · ${planetSummary(p)}${mark}`);
  });
  const air = sys.home.air;
  console.log(`  主行星大气:${air.gases.slice(0, 4).map((g) => `${g.id} ${(g.frac * 100).toFixed(1)}%`).join('、')} · 气压 ${air.pressure.toFixed(2)} atm · 温室 ${air.greenhouseK.toFixed(0)} K · ${air.breathable ? '可呼吸' : '不可呼吸'}`);
  console.log(`  潮差 ${sys.home.tide.toFixed(2)}(地球 = 1)· 磁暴 ${sys.home.storms.toFixed(1)}(地球 = 1)`);
  // 其他固态行星的地表(按预算档懒生成;这里顺手把概况写进设定集)
  const surfaces: string[] = [];
  for (const pl of planSurfaces(sys)) {
    const st = planetSurfaceStats(planetSurface(sys, pl.index, w.params));
    surfaces.push(`  ${names.planets[pl.index]}(${pl.cells} 地块):陆地 ${(st.landPct * 100).toFixed(0)}% · 均温 ${st.meanTempC.toFixed(0)}°C · 河 ${st.rivers} 条 · 最高 ${st.maxElev} 米 · 火山 ${st.volcanoes} 座 · ${st.biomes.map((b) => `${b.name} ${(b.pct * 100).toFixed(0)}%`).join(' ')}`);
  }
  if (surfaces.length) console.log(`\n其他固态行星的地表(按地质活跃度分配的精度):\n${surfaces.join('\n')}`);
  const om = omensOf(civ, w);
  console.log(`\n天象 ${om.length} 条(古典 ${om.filter((o) => o.classical).length} 条、挂到大事 ${om.filter((o) => o.tie).length} 条),前 10 条:`);
  for (const o of om.slice(0, 10)) console.log(`  ${o.year} 年 ${OMEN_NAMES[o.kind]}:${o.text}`);
}
const g = geologyOf(w);
const active = [...g.quake].filter((q) => q > 0.25).length;
console.log(`\n地质:活跃度 ×${g.activity.toFixed(2)} · 强震带地块 ${active} · 火山 ${g.volcanoes.length} 座`);

// ---- 文件 ----
mkdirSync('out', { recursive: true });
writeFileSync(`out/${tag}-编年史.md`, chronicleDocument(civ, { format: 'md', seed, params: `years=${years}`, eraYears: 500 }));
const md: string[] = [];
md.push(`# 种子 ${seed} 的星球`, '');
md.push(`> 由「文明与地图」（civ-atlas 1.5.0）本地生成，种子 ${seed}，推演 ${years} 年。同一版本下同一种子在任何设备上得到同一个世界。`, '');
md.push('## 星球概况', '');
md.push(`- 陆地占表面积 **${((landA / total) * 100).toFixed(1)}%**，最高海拔 **${Math.round(w.maxElevation)} 米**，河流 ${w.rivers.length} 条`);
md.push(`- 陆地气温中位数 **${med(tLand).toFixed(1)}°C**，年降水中位数 **${Math.round(med(pLand))} 毫米**`);
md.push(`- 生态占比：${biomes.join('、')}`);
md.push('');
md.push('## 海洋、山脉与陆块', '');
md.push(`- 海洋：${pick('sea', 10).join('、')}`);
md.push(`- 山脉：${pick('mountains', 12).join('、')}`);
md.push(`- 大湖：${pick('lake', 8).join('、')}`);
md.push(`- 岛屿：${pick('island', 8).join('、')}`);
md.push(`- 荒漠：${pick('desert', 8).join('、')}`);
md.push('');
md.push('## 民族', '');
for (const c of civ.cultures) md.push(`- **${c.name}**（${c.kind}，第 ${Math.floor(c.born)} 年兴起${c.ended !== undefined ? `，第 ${Math.floor(c.ended)} 年消亡` : ''}）`);
md.push('');
md.push('## 国家（推演结束时在世）', '');
md.push('| 国号 | 立国 | 国都 | 州数 |');
md.push('| --- | --- | --- | --- |');
for (const p of alive) md.push(`| ${p.name} | ${p.founded} | ${p.cap} | ${p.regions} |`);
md.push('');
md.push('## 大事记（重要度 3）', '');
for (const e of major) md.push(`- **${entryYearLabel(e)}** ${e.text}`);
md.push('');
if (sys) {
  const names = nameAstro(sys, seed);
  md.push('## 星球系', '');
  md.push(`- 恒星:**${names.star}**(${sys.star.label}，光度 ${sys.star.lum} 太阳)`);
  md.push(`- 一年 **${sys.yearDays.toFixed(0)} 天**、一天 **${sys.dayHours.toFixed(1)} 小时**、倾角 **${sys.home.tilt.toFixed(1)}°**`);
  for (let i = 0; i < sys.design.planets.length; i++) {
    const p = sys.design.planets[i];
    md.push(`- **${names.planets[i]}**${i === sys.home.index ? '（主行星）' : ''}：${planetSummary(p)}，轨道 ${p.a.toFixed(2)} AU`);
  }
  md.push(`- 主行星大气：${sys.home.air.gases.slice(0, 5).map((x) => `${x.id} ${(x.frac * 100).toFixed(1)}%`).join('、')}，气压 ${sys.home.air.pressure.toFixed(2)} atm，天空色 ${sys.home.air.sky.join('/')}`);
  md.push('');
  const surfaceLines: string[] = [];
  for (const pl of planSurfaces(sys)) {
    const st = planetSurfaceStats(planetSurface(sys, pl.index, w.params));
    surfaceLines.push(`- **${names.planets[pl.index]}**(${pl.cells} 地块，按地质活跃度分配精度):陆地 ${(st.landPct * 100).toFixed(0)}%、均温 ${st.meanTempC.toFixed(0)}°C、河 ${st.rivers} 条、最高 ${st.maxElev} 米、火山 ${st.volcanoes} 座;${st.biomes.map((b) => `${b.name} ${(b.pct * 100).toFixed(0)}%`).join('、')}`);
  }
  if (surfaceLines.length) {
    md.push('### 其他固态行星的地表', '');
    md.push(...surfaceLines);
    md.push('');
  }
  md.push(omenDocument(civ, w));
}
writeFileSync(`out/${tag}-设定集.md`, md.join('\n'));
console.log(`\n已写 out/${tag}-设定集.md 与 out/${tag}-编年史.md`);
