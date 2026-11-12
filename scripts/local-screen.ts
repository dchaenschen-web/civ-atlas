/**
 * 本地用:批量生成候选世界,打印"真实感"指标,给挑选种子用。
 * 运行:node_modules/.bin/tsx scripts/local-screen.ts
 * 结果另存 out/screen.jsonl
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld, DEFAULT_PARAMS, type World, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { buildChronicle, filterChronicle } from '../src/gen/civ/story/chronicle';
import { BIOMES } from '../src/gen/biomes';
import { geometryOf } from '../src/gen/geometry';
import { warStats } from '../src/gen/civ/wars';
import { politicsStats } from '../src/gen/civ/politics';
import { dynastyStats } from '../src/gen/civ/dynasty';

/** 地名语感配比:偏真实(拉丁/英法/中原/边塞/北欧为主,不用精灵、神话风) */
const MIX = { imperial: 3, kingdom: 3, central: 4, frontier: 2, nordic: 2, slavic: 1, hellenic: 1, desert: 1, steppe: 1 };

const VARIANTS: { id: string; p: Partial<WorldParams> }[] = [
  // A: 地球型 —— 5 块大陆、30% 陆地、微聚拢、海岸不太碎
  { id: 'A', p: { cells: 36000, landFraction: 0.3, plates: 28, continents: 5, gather: 0.35, rugged: 0.9, hardness: 1.05, north: 0.05 } },
  // B: 略破碎 —— 6 块大陆、聚拢更少
  { id: 'B', p: { cells: 36000, landFraction: 0.3, plates: 30, continents: 6, gather: 0.2, rugged: 1.0, hardness: 1.0, north: 0.0 } },
  // C: 大陆偏窄、海洋占主导(更像一颗冷一点、干一点的行星)
  { id: 'C', p: { cells: 36000, landFraction: 0.27, plates: 26, continents: 4, gather: 0.45, rugged: 0.85, hardness: 1.15, north: 0.1, temperature: -1.5, rainfall: 0.95 } },
];

interface Row {
  variant: string;
  seed: number;
  landPct: number;
  masses: number;
  bigMasses: string;
  polarLand: number;
  polarCont: number;
  tempMed: number;
  precMed: number;
  biome: string;
  states: number;
  polities: number;
  wars: number;
  dynasties: number;
  chron: number;
  major: number;
}

function areaStats(w: World) {
  const geo = geometryOf(w.mesh);
  const area = geo.cellAreas();
  const n = w.mesh.n;
  const lat = (i: number) => geo.latitude(i);
  let landA = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += area[i];
    if (w.water[i] !== 1) landA += area[i];
  }
  // 陆块
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) {
    if (w.water[i] === 1 || comp[i] >= 0) continue;
    const id = sizes.length;
    const q = [i];
    comp[i] = id;
    let a = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      a += area[c];
      for (let k = w.mesh.adjStart[c]; k < w.mesh.adjStart[c + 1]; k++) {
        const j = w.mesh.adj[k];
        if (w.water[j] !== 1 && comp[j] < 0) {
          comp[j] = id;
          q.push(j);
        }
      }
    }
    sizes.push(a);
  }
  const order = sizes.map((_, k) => k).sort((a, b) => sizes[b] - sizes[a]);
  const big = order.filter((k) => sizes[k] >= 0.02 * landA).length;
  const bigShare = order.slice(0, 4).map((k) => Math.round((sizes[k] / landA) * 100));
  // 两极
  const polar = [1, -1].map((sgn) => {
    let cap = 0;
    let land = 0;
    let cont = 0;
    for (let i = 0; i < n; i++) {
      if (lat(i) * sgn <= 66) continue;
      cap += area[i];
      if (w.water[i] === 1) continue;
      land += area[i];
      if (sizes[comp[i]] >= 0.01 * geo.area) cont += area[i];
    }
    return { land: land / cap, cont: cont / cap };
  });
  // 生态(按面积)
  const bA = new Map<number, number>();
  for (let i = 0; i < n; i++) bA.set(w.biome[i], (bA.get(w.biome[i]) ?? 0) + area[i]);
  const biome = [...bA]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([b, a]) => `${BIOMES[b].name}${Math.round((a / total) * 100)}`)
    .join(' ');
  // 中位数(陆地)
  const t: number[] = [];
  const pr: number[] = [];
  for (let i = 0; i < n; i++) if (w.water[i] !== 1) { t.push(w.temperature[i]); pr.push(w.precipitation[i]); }
  t.sort((a, b) => a - b);
  pr.sort((a, b) => a - b);
  return {
    landPct: landA / total,
    masses: sizes.length,
    big,
    bigShare,
    polarLand: polar[0].land + polar[1].land,
    polarLandMax: Math.max(polar[0].land, polar[1].land),
    polarContMax: Math.max(polar[0].cont, polar[1].cont),
    tempMed: t[Math.floor(t.length / 2)],
    precMed: pr[Math.floor(pr.length / 2)],
    biome,
  };
}

const rows: Row[] = [];
const t0 = performance.now();
for (const v of VARIANTS) {
  for (let seed = 1; seed <= 10; seed++) {
    const params = { ...DEFAULT_PARAMS, ...v.p, seed } as WorldParams;
    const w = generateWorld(params);
    const a = areaStats(w);
    const civ = generateCiv(w, { endYear: 3000, names: MIX });
    const ws = warStats(civ);
    const ps = politicsStats(civ);
    const ds = dynastyStats(civ);
    const chron = buildChronicle(civ);
    const row: Row = {
      variant: v.id,
      seed,
      landPct: +(a.landPct * 100).toFixed(1),
      masses: a.masses,
      bigMasses: a.bigShare.join('/'),
      polarLand: +((a.polarLandMax) * 100).toFixed(0),
      polarCont: +(a.polarContMax * 100).toFixed(0),
      tempMed: +a.tempMed.toFixed(1),
      precMed: Math.round(a.precMed),
      biome: a.biome,
      states: ws.alive,
      polities: civ.polities.length,
      wars: ws.wars,
      dynasties: ds.eastern + ds.western,
      chron: chron.length,
      major: filterChronicle(chron, { major: true }).length,
    };
    rows.push(row);
    console.log(
      `${row.variant}${String(row.seed).padStart(2)} 陆${row.landPct}% 块${row.masses} 大${row.bigMasses} 极陆${row.polarLand}% 极陆块${row.polarCont}% ` +
        `T${row.tempMed}°C P${row.precMed}mm | 国${row.states}/${row.polities} 战${row.wars} 朝${row.dynasties} 史${row.chron}/${row.major} | ${row.biome}`,
    );
  }
}
mkdirSync('out', { recursive: true });
writeFileSync('out/screen.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`\n${rows.length} 个世界,用时 ${Math.round((performance.now() - t0) / 1000)} 秒 → out/screen.jsonl`);
