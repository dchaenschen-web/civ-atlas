/**
 * N11:天象纪 / 地质 / 陨击结算已搬到世界概览的「天象与地质」页签(按行星观测过滤、只在文明期出现)。
 * 星球系页:恒星、各行星与卫星、大气成分、星图、地表缩略图。
 *
 * 数据全部来自生成结果(World.astro),这一页只读不改;
 * 没开星球系的世界(params.astro = 0)显示一段说明,不报错。
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { World } from '../gen/world';
import type { Civ } from '../gen/civ/types';
import { astroOf } from '../gen/astro';
import { namedBodies } from '../gen/astroNames';
import { GAS_NAMES, breathReason, type GasId, type PlanetDesign } from '../gen/astroDesign';
import { planetSummary, planSurfaces } from '../gen/astroWorlds';
import { bodyCiv, bodyFacts } from '../gen/bodies';
import { buildChronicle, filterChronicle } from '../gen/civ/story/chronicle';
import { PLANET_LAYERS, type PlanetLayer, type PlanetVizOut } from '../render/planetViz';
import { SystemGlobe } from './SystemGlobe';
import { SystemTimeline } from './SystemTimelineView';
import { clampSystemYear, yearsPerSecondOf, type SystemView } from './systemClock';
import { orbitYears } from '../gen/astroDesign';
// 星图与天空层都是「点开才看」的重件:按需加载,不占首屏(首页预算 280 KB)
const StarMap = lazy(() => import('./StarMap').then((m) => ({ default: m.StarMap })));
const BorderMap = lazy(() => import('./BorderMap').then((m) => ({ default: m.BorderMap })));
import { beltsOf } from '../gen/system';
import { planetClassOf, type PlanetClassInfo } from '../gen/planetClass';
import { moonSurface, systemOf } from '../gen/system';
import { moonPhases, planetPhases } from '../gen/astroWorlds';
import type { SurfaceOverride, BodyGen } from '../gen/astroDesign';
import { sketchGrid } from '../gen/sketch';
import { draftWorldIdOf, hydrateSketchAssets, sketchOf } from './sketchAssetStore';
import type { TerrainOp } from '../gen/edits';


export interface SystemPageProps {
  world: World | null;
  civ: Civ | null;
  /** N11:陨击结算已搬到「天象与地质」页;这个 prop 留在接口上做兼容(传了也不用) */
  onApplyCraters?: (craters: import('../gen/impacts').ImpactCrater[]) => void;
  phone?: boolean;
  backLabel?: string;
  onBack?: () => void;
}

/** 各种气体的颜色(画成分条用) */
const GAS_COLORS: Record<GasId, string> = {
  n2: '#6b8cbb',
  o2: '#5aa9e6',
  co2: '#c9a15a',
  h2o: '#7fc8d8',
  ch4: '#9e8f6a',
  nh3: '#c9b9a8',
  h2: '#d8b27a',
  he: '#b9c7d8',
  so2: '#c98a5a',
  ar: '#8f97a8',
};

const KIND_LABEL: Record<string, string> = { rocky: '岩石行星', gas: '气态行星' };

export function SystemPage(p: SystemPageProps) {
  const sys = p.world ? astroOf(p.world) : null;
  const endYear = p.civ?.endYear ?? 0;
  const [systemView, setSystemView] = useState<SystemView>('system');
  const [systemYear, setSystemYear] = useState(0);
  useEffect(() => setSystemYear(clampSystemYear(endYear, endYear)), [endYear]);
  // 星体名:按种子生成的那套 + 存档里手动改的名(system.bodyNames)
  const names = useMemo(() => (sys && p.world ? namedBodies(sys, p.world.params.seed, p.world.system) : null), [sys, p.world]);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const belts = useMemo(() => (sys && p.world ? beltsOf(sys.design, p.world.params.seed, p.world.params.impact) : []), [sys, p.world]);
  // 卫星详情(点一下才生成那颗卫星的地表统计;卫星不做文明)
  const [moonOpen, setMoonOpen] = useState<{ planet: number; moon: number; landPct: number; meanTempC: number; rivers: number; volcanoes: number; biomes: string } | null>(null);
  const openMoon = (planet: number, moon: number) => {
    if (!p.world) return;
    const solar = systemOf(p.world);
    if (!solar) return;
    const ms = moonSurface(solar, planet, moon, moonOpsOf(planet, moon), moonSurfOf(planet, moon));
    if (!ms) return;
    const st = ms.stats;
    setMoonOpen({
      planet,
      moon,
      landPct: st.landPct,
      meanTempC: st.meanTempC,
      rivers: st.rivers,
      volcanoes: st.volcanoes,
      biomes: st.biomes.slice(0, 4).map((b) => `${b.name} ${(b.pct * 100).toFixed(0)}%`).join(' · '),
    });
  };
  // 示意图选中的行星(默认主行星)
  const [picked, setPicked] = useState(-1);
  useEffect(() => setPicked(sys ? sys.home.index : -1), [sys]);
  // 其他固态行星的地表:worker 里按预算精度生成缩略图,支持地形 / 生物群系 / 温度 / 降水四种图层
  const [viz, setViz] = useState<Record<number, VizState>>({});
  /** 覆盖表 / 生成参数一变,缩略图全部作废(以前只按下标缓存,套了模板还显示旧图) */
  const vizKey = useMemo(() => JSON.stringify(p.world?.system ?? null), [p.world]);
  useEffect(() => { setViz({}); }, [vizKey]);
  const planned = useMemo(() => new Set<number>(sys ? planSurfaces(sys).map((x) => x.index) : []), [sys]);
  const vizWorker = useRef<Worker | null>(null);
  const vizSeq = useRef(0);
  const vizWant = useRef(new Map<number, number>());
  useEffect(() => {
    const w = new Worker(new URL('../render/planetViz.worker.ts', import.meta.url), { type: 'module' });
    vizWorker.current = w;
    w.onmessage = (ev: MessageEvent<VizMsg>) => {
      const m = ev.data;
      let index = -1;
      for (const [i, id] of vizWant.current) if (id === m.id) index = i;
      if (index < 0) return;
      if (!m.ok || !m.out) {
        setViz((s) => ({ ...s, [index]: { error: m.error ?? '生成失败' } }));
        return;
      }
      setViz((s) => ({ ...s, [index]: { out: m.out! } }));
    };
    return () => {
      w.terminate();
      vizWorker.current = null;
    };
  }, []);
  /** 这颗行星在存档里带着的地形修改(星系结构编辑器里改的) */
  const opsOf = (i: number): TerrainOp[] => ((p.world?.system?.planets.find((o) => o.index === i)?.terrain as TerrainOp[] | undefined) ?? []);
  const moonOpsOf = (planet: number, moon: number): TerrainOp[] => ((p.world?.system?.moons.find((o) => o.planet === planet && o.moon === moon)?.terrain as TerrainOp[] | undefined) ?? []);
  /** 这颗行星/卫星自己在覆盖表里的地表参数(陆地比例/气温/降水/精细度) */
  const surfOf = (i: number): SurfaceOverride | undefined => p.world?.system?.planets.find((o) => o.index === i)?.surface;
  const moonSurfOf = (planet: number, moon: number): SurfaceOverride | undefined => p.world?.system?.moons.find((o) => o.planet === planet && o.moon === moon)?.surface;
  /** 这颗行星/卫星自己的生成参数(板块/造山/气候/精度/种子/照手绘图) */
  const genOf = (i: number): BodyGen | undefined => p.world?.system?.planets.find((o) => o.index === i)?.gen;
  const moonGenOf = (planet: number, moon: number): BodyGen | undefined => p.world?.system?.moons.find((o) => o.planet === planet && o.moon === moon)?.gen;
  /** 照手绘图的那颗:认好的格子图(worker 里要用,不能传函数,只能传数据) */
  const sketchGridOf = (gen: BodyGen | undefined) => sketchGrid(sketchOf(gen?.sketchId));
  const askViz = (i: number, layer: PlanetLayer = 'terrain') => {
    if (!p.world) return;
    const id = ++vizSeq.current;
    vizWant.current.set(i, id);
    setViz((s) => ({ ...s, [i]: { busy: true } }));
    const gen = genOf(i);
    vizWorker.current?.postMessage({ id, input: { params: p.world.params, index: i, layer, ops: opsOf(i), surf: surfOf(i), gen, sketch: sketchGridOf(gen) } });
  };
  // 照手绘图的那几颗:进页面先把认好的格子图从 IndexedDB 读回内存(存的是引用,原图在本机)
  const [sketchReady, setSketchReady] = useState(0);
  useEffect(() => {
    if (!p.world) return;
    let live = true;
    void hydrateSketchAssets(draftWorldIdOf(p.world.params)).then((n) => {
      if (live && n > 0) setSketchReady(n);
    });
    return () => {
      live = false;
    };
  }, [p.world]);
  // 手绘图读回来了:已经按"没图"画过的缩略图作废,下次点开重新生成(照图的那几颗才会照着图长)
  useEffect(() => {
    if (sketchReady > 0) setViz({});
  }, [sketchReady]);

  // 详情面板与"按需推演这颗行星的文明"
  const [detail, setDetail] = useState(-1);
  const [civBusy, setCivBusy] = useState(false);
  const [civPreview, setCivPreview] = useState<{ index: number; states: number; year: number; lines: string[] } | null>(null);
  const openDetail = (i: number) => {
    setDetail(i);
    setCivPreview(null);
    if (sys && planned.has(i) && !viz[i]) askViz(i, 'terrain');
  };
  const runBodyCiv = (i: number) => {
    if (!sys || !p.world || civBusy) return;
    setCivBusy(true);
    window.setTimeout(() => {
      try {
        const civ = bodyCiv(sys, i, p.world!.params, 800, opsOf(i), surfOf(i));
        const lines = filterChronicle(buildChronicle(civ), { major: true })
          .slice(-5)
          .map((e) => `第 ${e.year} 年 ${e.text}`);
        setCivPreview({ index: i, states: civ.polities.length, year: civ.endYear, lines });
      } catch (err) {
        setCivPreview({ index: i, states: -1, year: 0, lines: [String(err)] });
      } finally {
        setCivBusy(false);
      }
    }, 30);
  };
  const detailPl = sys && detail >= 0 ? sys.design.planets[detail] : null;
  const detailViz = detail >= 0 ? viz[detail] : undefined;
  const detailOut = detailViz && 'out' in detailViz ? detailViz.out : null;
  const detailFacts = sys && detail >= 0 ? bodyFacts(sys)[detail] : null;

  // 星图:天球上的星按等距圆柱摊开(经度 → 横,纬度 → 纵),星等越大点越亮越小
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !sys) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);
    // 银道似的两道参考线(纯装饰)
    ctx.strokeStyle = 'rgba(120,140,200,0.18)';
    ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(0, H * f);
      ctx.lineTo(W, H * f);
      ctx.stroke();
    }
    for (const s of sys.design.stars) {
      const [x, y, z] = s.dir;
      const lon = Math.atan2(z, x);
      const lat = Math.asin(Math.max(-1, Math.min(1, y)));
      const u = (lon / (Math.PI * 2) + 0.5) % 1;
      const v = 0.5 - lat / Math.PI;
      const r = Math.max(0.7, 2.6 - s.mag * 0.33);
      const [cr, cg, cb] = s.color;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${Math.max(0.35, 1 - s.mag * 0.12)})`;
      ctx.beginPath();
      ctx.arc(u * W, v * H, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (sys.star) {
      const [cr, cg, cb] = sys.star.color;
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [sys]);

  const box: React.CSSProperties = { padding: '10px 12px', border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8, marginBottom: 10 };
  const title: React.CSSProperties = { fontWeight: 600, marginBottom: 6 };
  const muted: React.CSSProperties = { opacity: 0.65, fontSize: 12 };

  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      {p.onBack && (
        <button data-act="system-back" onClick={p.onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.8 }}>
          ‹ {p.backLabel ?? '返回'}
        </button>
      )}
      <b style={{ fontSize: 15 }}>星球系</b>
    </div>
  );

  if (!sys || !p.world) {
    return (
      <div style={{ padding: 12 }}>
        {head}
        <div style={box}>
          <div style={title}>这个世界还没有星球系</div>
          <div style={muted}>新建世界时打开「星球系」(参数 astro = 1)才会生成恒星、行星、卫星、大气成分与星图。老世界保持原样。</div>
        </div>
      </div>
    );
  }

  const home = sys.design.planets[sys.home.index];
  const air = home.atmos;

  return (
    <div style={{ padding: 12 }}>
      {head}

      {/* 恒星 */}
      <div style={box}>
        <div style={title}>
          {names?.star ?? '恒星'}
          <span style={{ ...muted, marginLeft: 6 }}>{sys.star.label}</span>
        </div>
        <div style={muted}>
          光度 {sys.star.lum.toFixed(2)} 太阳 · 有效温度 {Math.round(sys.star.temp)} K · 质量 {sys.star.mass.toFixed(2)} 太阳 · 星风 {sys.star.wind.toFixed(2)}×
          {sys.design.binaryStar && ` · 伴星间距 ${sys.design.binaryStar.sepAU.toFixed(3)} AU、互绕 ${sys.design.binaryStar.periodDays.toFixed(1)} 天(伴星光度占 ${(sys.design.binaryStar.lumRatio * 100).toFixed(0)}%)`}
          {sys.design.binary && ` · 伴星:第 ${sys.design.binary.index + 1} 颗、间距 ${(sys.design.binary.separationAU * 23481).toFixed(0)} R⊕、互绕 ${sys.design.binary.periodDays.toFixed(1)} 天`}
        </div>
      </div>

      {/* 主行星概况 */}
      <div style={box}>
        <div style={title}>主行星 · {names?.planets[sys.home.index] ?? ''}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', ...muted }}>
          <span style={{ display: 'inline-block', width: 22, height: 22, borderRadius: '50%', background: `rgb(${air.sky.join(',')})`, border: '1px solid rgba(255,255,255,0.25)' }} title="天空颜色" />
          <span>一年 {Math.round(sys.yearDays)} 天</span>
          <span>一天 {sys.dayHours.toFixed(1)} 小时</span>
          <span>倾角 {sys.home.tilt.toFixed(1)}°</span>
          <span>均温 {(home.tempK - 273.15).toFixed(1)}°C</span>
          <span>气压 {air.pressure.toFixed(2)} atm</span>
          <span>温室 {Math.round(air.greenhouseK)} K</span>
          <span>潮差 {sys.home.tide.toFixed(2)}(地球=1)</span>
          <span>昼夜温差 ±{(18 * Math.min(0.97, Math.max(0, 1 - 24 / Math.max(2, sys.home.dayHours)))).toFixed(0)} K</span>
          {sys.home.radDose > 0 && <span title="母行星辐射带剂量(相对地球轨道)">辐射带 ×{sys.home.radDose.toFixed(1)}</span>}
          <span>磁暴 {sys.home.storms.toFixed(1)}(地球=1)</span>
          <span>磁场 {home.magnetic.toFixed(2)}(地球=1)</span>
          <span>磁极 {sys.home.magneticPole.toFixed(0)}°</span>
          <span style={{ color: air.breathable ? '#5fa85f' : '#c07070' }}>{air.breathable ? '可呼吸' : `不可呼吸(${breathReason(air) ?? '成分不合适'})`}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          {air.gases.slice(0, 6).map((g) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span style={{ width: 64, ...muted }}>{GAS_NAMES[g.id]}</span>
              <span style={{ flex: 1, height: 8, background: 'rgba(128,128,128,0.18)', borderRadius: 4, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.max(1, g.frac * 100)}%`, background: GAS_COLORS[g.id] }} />
              </span>
              <span style={{ width: 56, textAlign: 'right', ...muted }}>{(g.frac * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* S5:三档视图与独立天象时间轴；年份只传给系统渲染，不写文明状态 */}
      <div style={box} data-act="system-view-switcher">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {([['system', '系统'], ['chart', '星图'], ['surface', '地表']] as const).map(([id, label]) => (
            <button key={id} className="ov-btn" data-act={`system-view-${id}`} onClick={() => setSystemView(id)} style={systemView === id ? { borderColor: '#c9a15a', color: '#c9a15a' } : undefined}>{label}</button>
          ))}
        </div>
        <SystemTimeline endYear={endYear} year={systemYear} onYear={setSystemYear} yearsPerSec={yearsPerSecondOf(sys ? orbitYears(sys.design.planets[sys.home.index].a) : 1)} />
      </div>
      {sys && systemView === 'system' && (
        <div style={box} data-act="system-orbits">
          <SystemGlobe design={sys.design} names={names?.planets ?? []} belts={belts} selected={picked >= 0 ? picked : sys.home.index} onSelect={setPicked} year={systemYear} />
        </div>
      )}

      {/* 行星详情 + 按需推演这颗行星的文明 */}
      {sys && detailPl && detailFacts && (
        <div style={box} data-act="body-detail-panel">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={title}>行星详情 · {names?.planets[detail] ?? `行星 ${detail + 1}`}</div>
            <button className="ov-btn" data-act="detail-close" onClick={() => setDetail(-1)} style={{ marginLeft: 'auto' }}>
              关闭
            </button>
          </div>
          <div style={muted}>
            轨道 {detailPl.a.toFixed(3)} AU · 偏心率 {detailPl.ecc.toFixed(3)} · 黄道角 {detailPl.incDeg.toFixed(1)}° · 升交点 {detailPl.nodeDeg.toFixed(0)}° · 半径 {detailPl.radius.toFixed(2)} R⊕ · 均温 {(detailPl.tempK - 273.15).toFixed(0)}°C
          </div>
          <div style={muted}>
            {detailPl.kind === 'gas'
              ? '气态行星:只参与轨道、天象与磁场相互作用,不做地表'
              : `气压 ${detailPl.atmos.pressure.toFixed(2)} atm · ${detailPl.atmos.breathable ? '可呼吸' : `不可呼吸(${breathReason(detailPl.atmos) ?? '成分不合适'})`}`}
          </div>
          {planetPhases(sys, detail) && (
            <div style={{ ...muted, marginTop: 2 }}>
              物质状态(按这颗行星的温度/气压):{planetPhases(sys, detail)!.text}
            </div>
          )}
          {detail === sys.home.index && <div style={{ ...muted, marginTop: 6 }}>这是主行星:文明在主地图与编年史里。</div>}
          {detail !== sys.home.index && detailFacts.alive && (
            <div style={{ marginTop: 8 }}>
              {civBusy ? (
                <span style={muted}>正在推演这颗行星的文明…</span>
              ) : civPreview && civPreview.index === detail ? (
                <div>
                  <div style={{ color: '#5fa85f' }}>推演 800 年:共 {civPreview.states} 个国家(到第 {civPreview.year} 年)</div>
                  {civPreview.lines.map((t, k) => (
                    <div key={k} style={muted}>
                      {t}
                    </div>
                  ))}
                </div>
              ) : (
                <button className="ov-btn" data-act="body-civ" onClick={() => runBodyCiv(detail)}>
                  推演这颗行星的文明(800 年预览)
                </button>
              )}
            </div>
          )}
          {detail !== sys.home.index && !detailFacts.alive && <div style={{ ...muted, marginTop: 6 }}>没有生命迹象(无生物圈 / 不可呼吸),不推文明。</div>}
          {detailOut && (
            <div style={{ marginTop: 8 }}>
              <PlanetCanvas out={detailOut} />
            </div>
          )}
          {detailOut && (
            <div style={{ ...muted, marginTop: 4 }}>
              陆地 {(detailOut.stats.landPct * 100).toFixed(0)}% · 均温 {detailOut.stats.meanTempC.toFixed(0)}°C · 河 {detailOut.stats.rivers} 条 · 火山 {detailOut.stats.volcanoes} 座 · {detailOut.stats.biomes.map((b) => `${b.name} ${(b.pct * 100).toFixed(0)}%`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* 卫星详情:点卫星名字才生成那颗卫星的地表(卫星不做文明) */}
      {sys && moonOpen && (
        <div style={box} data-act="moon-detail-panel">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={title}>卫星详情 · {names?.moons[moonOpen.planet]?.[moonOpen.moon] ?? `卫星 ${moonOpen.moon + 1}`}</div>
            <button className="ov-btn" data-act="moon-close" onClick={() => setMoonOpen(null)} style={{ marginLeft: 'auto' }}>
              关闭
            </button>
          </div>
          <div style={muted}>
            母行星 {names?.planets[moonOpen.planet] ?? `行星 ${moonOpen.planet + 1}`} · 半径 {sys.design.planets[moonOpen.planet]?.moons[moonOpen.moon]?.radius.toFixed(2)} R⊕ · 离母星 {sys.design.planets[moonOpen.planet]?.moons[moonOpen.moon]?.distance.toFixed(0)} R母 · {sys.design.planets[moonOpen.planet]?.moons[moonOpen.moon]?.locked ? '潮汐锁定' : '未锁定'}
          </div>
          <div style={{ ...muted, marginTop: 4 }}>
            陆地 {(moonOpen.landPct * 100).toFixed(0)}% · 均温 {moonOpen.meanTempC.toFixed(0)}°C · 河 {moonOpen.rivers} 条 · 火山 {moonOpen.volcanoes} 座
          </div>
          <div style={{ ...muted, marginTop: 2 }}>{moonOpen.biomes}</div>
          {moonPhases(sys.design, moonOpen.planet, moonOpen.moon) && (
            <div style={{ ...muted, marginTop: 2 }}>
              物质状态(按母行星温度/气压估):{moonPhases(sys.design, moonOpen.planet, moonOpen.moon)!.text}
            </div>
          )}
          <div style={{ ...muted, marginTop: 6 }}>卫星以岩石/冰为主,没有独立文明(文明只在生命行星上推演)。</div>
        </div>
      )}

      {systemView === 'surface' && (
        <div style={box} data-act="surface-borders">
          <Suspense fallback={<div style={muted}>地表边界加载中…</div>}>
            <BorderMap world={p.world} civ={p.civ} year={systemYear} />
          </Suspense>
        </div>
      )}
      {systemView === 'surface' && <div style={box}><div style={title}>地表视图</div><div style={muted}>选择行星后查看其地形与地表统计；本星系边界见上面那张图，只作参考、不参与推演。</div></div>}
      {systemView === 'surface' && <div style={box}>
        <div style={title}>本星系的行星</div>
        {sys.design.planets.map((pl, i) => (
          <PlanetRow
            key={i}
            pl={pl}
            name={names?.planets[i] ?? ''}
            home={i === sys.home.index}
            moons={names?.moons[i] ?? []}
            canGen={planned.has(i)}
            viz={viz[i]}
            onViz={(layer) => askViz(i, layer)}
            onDetail={() => openDetail(i)}
            cls={planetClassOf({ design: pl, gen: genOf(i), surface: surfOf(i) })}
            planetIndex={i}
            onMoon={(mi) => openMoon(i, mi)}
          />
        ))}
        <div style={{ ...muted, marginTop: 6 }}>气态行星只参与轨道、天象与磁场相互作用,不生成地表;岩石行星按地质活跃度分配地表精度。</div>
      </div>}

      {/* 星图 */}
      {systemView === 'chart' && <div style={box}>
        <div style={title}>星图</div>
        <Suspense fallback={<div style={muted}>星图加载中…</div>}>
          <StarMap system={sys} seed={p.world.params.seed} onSystemSelect={() => setSystemView('system')} />
        </Suspense>
        <div style={{ ...muted, marginTop: 4 }}>100 光年内 42 颗邻星；点击邻星提示“恒星际未开放”，点击本星系返回系统视图。</div>
      </div>}

          </div>
  );
}

type VizState = { busy: true } | { out: PlanetVizOut } | { error: string };
type VizMsg = { id: number; ok: boolean; out?: PlanetVizOut; error?: string };

/** 把 worker 给的 RGBA 贴到 canvas 上(缩略图按容器宽度缩放) */
function PlanetCanvas({ out }: { out: PlanetVizOut }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = out.w;
    cv.height = out.h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(out.w, out.h);
    img.data.set(out.px);
    ctx.putImageData(img, 0, 0);
  }, [out]);
  return (
    <canvas
      ref={ref}
      style={{ width: '100%', maxWidth: 420, borderRadius: 6, border: '1px solid rgba(128,128,128,0.25)', display: 'block', imageRendering: 'auto' }}
    />
  );
}

function PlanetRow(p: { pl: PlanetDesign; name: string; home: boolean; moons: string[]; cls?: PlanetClassInfo; canGen?: boolean; viz?: VizState; onViz?: (layer: PlanetLayer) => void; onDetail?: () => void; planetIndex?: number; onMoon?: (moon: number) => void }) {
  const { pl, viz } = p;
  const out = viz && 'out' in viz ? viz.out : null;
  const err = viz && 'error' in viz ? viz.error : null;
  const busy = !!viz && 'busy' in viz;
  const muted: React.CSSProperties = { opacity: 0.65, fontSize: 12 };
  return (
    <div style={{ padding: '6px 0', borderTop: '1px solid rgba(128,128,128,0.15)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b>{p.name}</b>
        {p.home && <span style={{ fontSize: 11, color: '#c9a15a' }}>主行星</span>}
        <span style={muted}>{KIND_LABEL[pl.kind]}</span>
                {p.cls && (
          <span
            data-act={`planet-class-${p.planetIndex ?? 0}`}
            title={p.cls.hint}
            style={{ fontSize: 10.5, padding: '1px 5px', borderRadius: 4, color: '#f7fbff', background: `rgb(${p.cls.tint.join(',')})`, opacity: 0.92 }}
          >
            {p.cls.name}
          </span>
        )}        <span style={muted}>轨道 {pl.a.toFixed(2)} AU</span>
        <span style={muted}>半径 {pl.radius.toFixed(2)} R⊕</span>
        {pl.kind === 'rocky' && <span style={muted}>{(pl.tempK - 273.15).toFixed(0)}°C</span>}
        {pl.ring && <span style={muted}>有环</span>}
        {pl.kind === 'rocky' && (
          <button className="ov-btn" data-act="body-detail" onClick={p.onDetail} style={{ marginLeft: 'auto' }}>
            详情
          </button>
        )}
      </div>
      <div style={{ ...muted, marginTop: 2 }}>{planetSummary(pl)}</div>
      {p.moons.length > 0 && (
        <div style={{ ...muted, marginTop: 2 }}>
          卫星:
          {p.moons.map((nm, mi) => (
            <button key={mi} className="ov-btn" data-act="moon-detail" onClick={() => p.onMoon?.(mi)} style={{ marginLeft: 4, padding: '0 6px' }}>
              {nm}
            </button>
          ))}
        </div>
      )}
      {p.canGen && (
        <div style={{ marginTop: 6, ...muted }}>
          {!viz ? (
            <button className="ov-btn" data-act="gen-surface" onClick={() => p.onViz?.('terrain')} title="按地质活跃度分配到的精度(同一套生成管线)生成这颗行星的地表">
              生成地表
            </button>
          ) : busy ? (
            '正在按预算精度生成地表…'
          ) : err ? (
            <span style={{ color: '#c07070' }}>生成失败:{err}</span>
          ) : (
            <>
              {out && <PlanetCanvas out={out} />}
              <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                {PLANET_LAYERS.map((l) => (
                  <button
                    key={l.id}
                    className="ov-btn"
                    data-act={`planet-layer-${l.id}`}
                    onClick={() => p.onViz?.(l.id)}
                    style={out?.layer === l.id ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
              <div style={{ color: '#5fa85f', marginTop: 5 }}>
                地表:陆地 {((out?.stats.landPct ?? 0) * 100).toFixed(0)}% · 均温 {(out?.stats.meanTempC ?? 0).toFixed(0)}°C · 河 {out?.stats.rivers ?? 0} 条 · 最高 {out?.stats.maxElev ?? 0} 米 · 火山 {out?.stats.volcanoes ?? 0} 座
              </div>
              <div style={{ marginTop: 2 }}>{(out?.stats.biomes ?? []).map((b) => `${b.name} ${(b.pct * 100).toFixed(0)}%`).join(' · ')}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
