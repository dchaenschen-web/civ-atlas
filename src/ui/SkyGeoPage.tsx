/**
 * N11「天象与地质」页:从星球系的属性页里独立出来的第三块。
 *
 * 三条口径(用户定):
 *   1. 只在文明模拟期出现 —— 这一页挂在世界概览的页签上,新建界面(Studio)里没有;
 *   2. 只显示「从这颗行星能观察到」的 —— 顶部选行星,天象/地质/陨击都取所选行星自己的数据;
 *   3. 非主行星还没有文明时:天文现象留空并说明,地质现象照常记录(地质是自然现象,不需要人记)。
 */
import { useMemo, useState } from 'react';
import type { World } from '../gen/world';
import type { Civ } from '../gen/civ/types';
import { astroOf } from '../gen/astro';
import { namedBodies } from '../gen/astroNames';
import { bodyWorld } from '../gen/bodies';
import { geologyOf } from '../gen/geology';
import { settleImpacts } from '../gen/impacts';
import { impactEventsOn, impactRate } from '../gen/civ/impactEvents';
import { omensOf, OMEN_NAMES } from '../gen/civ/story/omen';
import { regionLabel } from '../gen/civ/story/display';
import type { TerrainOp } from '../gen/edits';
import type { ImpactCrater } from '../gen/impacts';

export interface SkyGeoPageProps {
  world: World | null;
  civ: Civ | null;
  /** 把陨击结算写进地形修改(世界页给的编辑管线;不给 = 只预览) */
  onApplyCraters?: (craters: ImpactCrater[]) => void;
  /** 初始选中的行星(默认主行星) */
  initial?: number;
}

const box: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, background: 'rgba(20,26,40,0.55)', border: '1px solid rgba(120,150,200,0.18)', marginBottom: 10 };
const title: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#e8eefc' };
const muted: React.CSSProperties = { fontSize: 12, opacity: 0.72, color: '#c9d6ea' };

export function SkyGeoPage({ world, civ, onApplyCraters, initial }: SkyGeoPageProps) {
  const sys = useMemo(() => (world ? astroOf(world) : null), [world]);
  const names = useMemo(() => (sys && world ? namedBodies(sys, world.params.seed, world.system) : null), [sys, world]);
  const home = sys?.home.index ?? 0;
  const [picked, setPicked] = useState<number>(initial ?? home);
  const planetIndex = sys && picked >= 0 && picked < sys.design.planets.length ? picked : home;
  const isHome = planetIndex === home;
  const planet = sys?.design.planets[planetIndex];

  /** 所选行星自己的世界(主行星直接用当前世界,别的行星按同一套参数现生成一份轻量的) */
  const target = useMemo(() => {
    if (!world || !sys) return null;
    if (isHome) return world;
    try {
      return bodyWorld(sys, planetIndex, world.params);
    } catch {
      return null;
    }
  }, [world, sys, isHome, planetIndex]);

  const geology = useMemo(() => (target ? geologyOf(target) : null), [target]);
  const active = geology ? [...geology.quake].filter((q) => q > 0.25).length : 0;

  /** 天象纪:只有主行星有文明记录;别的行星留空(用户定) */
  const omens = useMemo(() => (isHome && civ && world ? omensOf(civ, world) : []), [isHome, civ, world]);

  /** 陨击结算:只有主行星有历史记录;别的行星只报"当前陨击率" */
  const impactOn = !!(world && impactEventsOn(world));
  const rate = useMemo(() => (world ? impactRate(world) : 0), [world]);
  const settle = useMemo(() => (impactOn && world && isHome ? settleImpacts(world, civ, { rate }) : null), [impactOn, world, isHome, civ, rate]);
  const craters = settle?.craters ?? [];

  if (!world || !sys) return <div style={box}><div style={muted}>这个世界没开星球系,没有天象与地质可看。</div></div>;

  return (
    <div data-act="sky-geo-page" style={{ padding: '4px 2px' }}>
      {/* 顶部:行星选择器 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ ...muted, opacity: 0.6 }}>看哪颗行星</span>
        {sys.design.planets.map((pl, i) => (
          <button
            key={i}
            className="ov-btn"
            data-act={`sky-geo-pick-${i}`}
            onClick={() => setPicked(i)}
            style={{ padding: '1px 8px', fontSize: 11.5, ...(planetIndex === i ? { borderColor: '#f0dc8c', color: '#f0dc8c' } : {}) }}
          >
            {i === home ? '★ ' : ''}
            {names?.planets[i] ?? `行星 ${i + 1}`}
            <span style={{ opacity: 0.5 }}> {pl.kind === 'gas' ? '气态' : '岩石'}</span>
          </button>
        ))}
        <span style={{ ...muted, opacity: 0.55 }}>
          只显示从{names?.planets[planetIndex] ?? '这颗行星'}能观察到的
        </span>
      </div>

      {/* 天象纪:天文现象(要文明才记) */}
      <div style={box}>
        <div style={title}>天象纪</div>
        {!isHome ? (
          <div style={muted}>
            这颗行星还没有文明:{names?.planets[planetIndex] ?? '它'}的天文现象要从文明开始推演以后才记(天象是"有人记下来"才成纪的)。
          </div>
        ) : omens.length === 0 ? (
          <div style={muted}>这个世界的天象还没有挂上大事(或者还没推演)。</div>
        ) : (
          omens.slice(0, 40).map((o, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={muted}>
                第 {o.year} 年 · {OMEN_NAMES[o.kind]}
                <span style={{ marginLeft: 6, color: o.classical ? '#c9a15a' : '#6b9bbf' }}>{o.classical ? '古典' : '历法既明'}</span>
                {o.tie && <span style={{ marginLeft: 6 }}>· 关联大事</span>}
              </div>
              <div style={{ fontSize: 12.5, color: '#e8eefc' }}>{o.text}</div>
            </div>
          ))
        )}
      </div>

      {/* 地质现象:自然现象,不需要文明也照记 */}
      {geology && (
        <div style={box}>
          <div style={title}>地质现象</div>
          <div style={muted}>
            活跃度 {geology.activity.toFixed(2)}× · 强震带地块 {active} · 火山 {geology.volcanoes.length} 座
            {planet && <span> · {planet.kind === 'gas' ? '气态行星没有地表,这一组数来自它的整体结构估算' : `半径 ${planet.radius.toFixed(2)} R⊕`}</span>}
          </div>
          <div style={{ ...muted, marginTop: 4 }}>
            地震与火山从板块汇聚带、离散带与热点派生;这颗行星的地质现象不依赖文明,所以没有文明也照记。
          </div>
        </div>
      )}

      {/* 陨击结算 */}
      {impactOn && (
        <div style={box}>
          <div style={title}>陨击结算</div>
          <div style={{ ...muted, marginBottom: 4 }}>
            当前陨击率 {rate.toFixed(2)}×(相对地球;小行星带、巨行星清扫、大气都已算进去)
            {!isHome && ' · 只有主行星的推演里记着撞击史事,这颗行星暂无记录'}
          </div>
          {!isHome ? (
            <div style={muted}>等这颗行星有了自己的文明推演,这里会出现它的陨击结算。</div>
          ) : craters.length === 0 ? (
            <div style={muted}>这颗星球的陨击频率开了,但这段历史里没有大撞击(小行星带没穿轨道,或运气好)。</div>
          ) : (
            <>
              <div style={muted}>这段历史记下 {craters.length} 次撞击;推演里只算效应(城毁、死人),地形留在这里结算</div>
              {craters.slice(-8).map((c, i) => (
                <div key={i} style={muted}>
                  第 {c.year} 年 · {civ ? regionLabel(civ, c.region) : `第 ${c.region + 1} 州`} · 坑半径 {Math.round(c.radiusKm)} 公里、深 {Math.round(c.depthM)} 米
                </div>
              ))}
              <div style={{ ...muted, marginTop: 6 }}>
                结算预览:会压低 {settle?.touched ?? 0} 个地块(共 {world.mesh.n} 个)。{craters.length > 8 ? '只列了最近 8 次。' : ''}
              </div>
              {onApplyCraters ? (
                <button className="ov-btn" data-act="sky-geo-impact-apply" style={{ marginTop: 6 }} onClick={() => onApplyCraters(craters)} title="把这些坑写成地形修改(和地形编辑同一种改动),重新生成世界;推演会跟着重来">
                  把这些坑写进地形(重新生成世界)
                </button>
              ) : (
                <div style={{ ...muted, marginTop: 2 }}>这个页面没有编辑管线,只做纯计算预览。</div>
              )}
            </>
          )}
        </div>
      )}
      {/* 兜底说明:陨击没开 */}
      {!impactOn && <div style={{ ...muted, padding: '0 4px' }}>这个世界没开陨击(撞击频率 &lt; 1 或不是星球系世界)。</div>}
      {/* 让 TerrainOp 参与类型收口(防止未使用导入) */}
      <span style={{ display: 'none' }}>{([] as TerrainOp[]).length}</span>
    </div>
  );
}
