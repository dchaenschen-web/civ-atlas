/**
 * 世界概览的"世界设定"页:这个世界创建时定下的根,都只能看,不能再改(一改几千年的历史就要整个重来)。分两页:
 * 「文明」—— 文明种子、地名风格、推演年数、天灾、规则、拓荒(民族扩散、国家扩张、地形难走程度)、文明起源;想换个样子:"以它为底稿新建…"
 * (回到新建这一步,设定照原样带过去,存成另一个世界);右栏是随时能改的「纪年」(EraSettings.tsx)和「月份」(MonthSettings.tsx;窄屏放在最上面)。
 * 「地图」—— 种子、世界参数、改过的地形;右栏是这张地图上的几个文明(点了打开)、"在这张地图上打造新文明…"、"回放世界形成"。
 *
 * 世界参数的滑条(ParamSlider;滑条的定义在 genesisSliders.ts)、推演年数的开关和滑条(YearsRows)在这里,新建世界(studio/Studio.tsx)用。
 */
import { useEffect, useMemo, useState } from 'react';
import type { World, WorldParams } from '../gen/world';
import { speedText, terrainBrief as terrainCostBrief } from '../gen/civ/frontier';
import { CALAMITY_NAMES, cleanCalamity } from '../gen/civ/calamity';
import { originCiv, originSpots } from './studio/origins';
import type { Civ } from '../gen/civ/types';
import { END_YEAR_DEFAULT, civSeedOf, cleanEndYear, endYearOf, type TerrainKind } from '../gen/edits';
import { setEndYear, useEdits } from './editsStore';
import { currentWorld, keptFrom, listWorlds, useSavesVersion } from './saveStore';
import { civName, mapMates } from './mapGroups';
import { openWorldById, startNewCiv } from './newCivAction';
import { OFFICIAL_RULES_NAME, ruleSetLabel } from '../gen/civ/ruleSetEdit';
import type { RuleSet } from '../gen/civ/ruleSet';
import { myRulesFor, useMyRules } from './rulesStore';
import { rulesUiOn } from './rules/flag';
import { openRulesSheet } from './rules/sheetStore';
import { Icon } from './icons';
import { mixSummary } from './nameMix';
import { EraSection } from './EraSettings';
import { MonthSection } from './MonthSettings';
import { useNarrow } from './device';
import { ParamField, rangeFill } from './ParamField';
import { CONT_SLIDERS, SLIDERS, SYSTEM_LEVEL_KEYS, YEARS_NOTE, YEARS_ON, YEARS_SLIDER, YEARS_SWITCH, contDefault, yearsSpan, type SliderLike } from './genesisSliders';
import { OptionRow } from './ParamField';
import './ai.css';

// 滑条、推演年数的说法、参数简写在 genesisSliders.ts(新建弹窗也用),这里照旧一起导出
export { CONT_SLIDERS, SLIDERS, YEARS_NOTE, YEARS_ON, YEARS_SLIDER, YEARS_SWITCH, contBrief, contDefault, northText, paramsSide, yearsSpan, type SliderLike } from './genesisSliders';

const KIND_NAME: Record<TerrainKind, string> = { volcano: '火山', range: '山脉', lake: '湖', raise: '抬起陆地', sink: '沉成海', river: '河', wet: '更湿', dry: '更干', warm: '更暖', cold: '更冷', lift: '抬高', lower: '压低', smooth: '平滑', flatten: '抹平', setHeight: '定高', delWater: '删河湖' };

/**
 * 改过的地形:"2 处：火山 1、山脉 1";画过草图的和编辑地形里一个说法:"画了 12 笔：草图 11 笔、河 1"
 * (一笔没涂、没涂的地方都是海:"都是海");没改 = "没有"
 */
export function terrainBrief(ops: readonly { kind: TerrainKind }[], sketch?: { rest: string; strokes: readonly unknown[] }): string {
  const n = new Map<TerrainKind, number>();
  for (const o of ops) n.set(o.kind, (n.get(o.kind) ?? 0) + 1);
  const parts = [...n].map(([k, c]) => `${KIND_NAME[k]} ${c}`);
  if (!sketch) return ops.length ? `${ops.length} 处：${parts.join('、')}` : '没有';
  const k = sketch.strokes.length;
  if (!k && !ops.length) return '都是海';
  return `画了 ${k + ops.length} 笔：${[...(k ? [`草图 ${k} 笔`] : []), ...parts].join('、')}`;
}

/**
 * 一项世界参数的滑条:名字、右边能直接打字的数值框(ParamField.tsx)、下面滑条。拖动时只改数字,松手(或键盘改完)才算数;
 * changed = 和所选预设不一样(数字用主色写)
 */
export function ParamSlider({
  s,
  value,
  onCommit,
  disabled,
  changed,
}: {
  s: SliderLike;
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  changed?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const [err, setErr] = useState<string | null>(null);
  // 有具体名字的几档:不摆滑条,摆成分段选项
  if (s.options) {
    return (
      <div className="param-slider param-slider-opt" title={s.hint} data-param={s.key}>
        <span className="param-slider-row">
          <span>{s.name}</span>
        </span>
        <OptionRow s={s} value={value} onCommit={onCommit} disabled={disabled} />
      </div>
    );
  }

  return (
    <div className="param-slider" title={s.hint} data-param={s.key}>
      <span className="param-slider-row">
        <span>{s.name}</span>
        <ParamField s={s} value={v} onCommit={onCommit} onBad={setErr} disabled={disabled} changed={changed} />
      </span>
      {err && <span className="param-slider-err">{err}</span>}
      <input
        type="range"
        aria-label={s.name}
        className={s.key === 'north' ? 'mid' : undefined}
        min={s.min}
        max={s.max}
        step={s.step}
        value={v}
        disabled={disabled}
        style={rangeFill(s, v)}
        onChange={(e) => setV(s.snap ? s.snap(Number(e.target.value)) : Number(e.target.value))}
        onPointerUp={() => v !== value && onCommit(v)}
        onKeyUp={() => v !== value && onCommit(v)}
      />
    </div>
  );
}

/**
 * 新建界面「世界参数」里最后三样:开关「推演超过 3000 年」(默认关),下面一直写着那段说明;
 * 开了才有「推演到」滑条(刚打开在 YEARS_ON 年,松手才算数)。改的是当前世界的修改(editsStore 的 setEndYear)
 */
export function YearsRows({ disabled }: { disabled?: boolean }) {
  const raw = useEdits().endYear;
  const on = raw !== undefined;
  const end = cleanEndYear(raw) ?? END_YEAR_DEFAULT;
  return (
    <>
      <button className="sb-row nw-years" role="switch" aria-checked={on} data-act="years-switch" disabled={disabled} onClick={() => setEndYear(on ? undefined : YEARS_ON)}>
        <span className="sb-row-main">
          <b>{YEARS_SWITCH}</b>
        </span>
        <span className={`ai-switch${on ? ' on' : ''}`} aria-hidden="true" />
      </button>
      <p className="nw-years-note">{YEARS_NOTE}</p>
      {on && <ParamSlider s={YEARS_SLIDER} value={end} disabled={disabled} onCommit={setEndYear} />}
    </>
  );
}

export interface SettingsProps {
  params: WorldParams;
  /** 第 0 年的星球(文明起源落在哪一州要看它;有地形大事时是大事以前的那颗) */
  world: World | null;
  civ: Civ | null;
  /** 回放世界形成:能不能点、正在放 */
  replay: { on: boolean; ready: boolean };
  /** 世界还在生成 */
  generating: boolean;
  onReplay: () => void;
  /** 以它为底稿新建 */
  onDraftFrom: () => void;
}

/** 文明起源:"自己选的 3 处：甲、乙、丙"(住不了人、推演时跳过的不列);没选 = "自动" */
/** 「天灾」那一行:平常 / 多 / 很多 */
const calamityText = (c: unknown) => {
  const k = cleanCalamity(c);
  return k ? CALAMITY_NAMES[k] : '平常';
};

/**
 * 「规则」那一行:官方的写「官方规则」;用了一套的写「战乱年代（第 2 版）」,本机「我的规则」里同一套已是更新的一版时
 * 写「战乱年代（第 2 版，我的规则里已是第 3 版）」
 */
function rulesText(r: RuleSet | undefined): string {
  if (!r) return OFFICIAL_RULES_NAME;
  const m = myRulesFor(r);
  return m?.newer ? `${r.name}（第 ${r.version} 版，我的规则里已是第 ${m.mine.rules.version} 版）` : ruleSetLabel(r);
}

/** 「规则」一行(入口开着时才有):点了用调规则的大卡看这个世界用的那一版(只能看;官方的看官方规则) */
function RulesRow({ rules, worldId }: { rules: RuleSet | undefined; worldId: string | undefined }) {
  // 「我的规则」里改了、加了新版,那一句跟着变
  useMyRules();
  return (
    <button
      className="ov-kv-row ov-rules-row"
      data-param="rules"
      onClick={() => openRulesSheet(rules ? { kind: 'world', rules, ...(worldId ? { worldId } : {}) } : { kind: 'official' })}
    >
      <span>规则</span>
      <b>{rulesText(rules)}</b>
      <Icon name="chevron" size={13} />
    </button>
  );
}

function originsBrief(pts: readonly number[] | undefined, world: World | null, civ: Civ | null): string {
  if (!pts?.length) return '自动';
  const n = pts.length >> 1;
  if (!world || !civ) return `自己选的 ${n} 处`;
  const names = originSpots(world, originCiv(civ), pts)
    .filter((s) => s.ok)
    .map((s) => s.name);
  return names.length ? `自己选的 ${names.length} 处：${names.join('、')}` : `自己选的 ${n} 处都住不了人，照自动推演`;
}

/** 世界设定的两页:文明(推演怎么定的)、地图(星球怎么定的,这张地图上还有哪些文明) */
type SettingsTab = 'civ' | 'map';

export function SettingsPage(p: SettingsProps) {
  useSavesVersion();
  const edits = useEdits();
  const cur = currentWorld();
  const title = cur?.title;
  const { params } = p;
  const keptOf = keptFrom(edits);
  const end = endYearOf(edits);
  const narrow = useNarrow();
  const [tab, setTab] = useState<SettingsTab>('civ');
  const seg = (
    <div className="ov-seg" role="tablist">
      {(['civ', 'map'] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : undefined} data-tab={t} onClick={() => setTab(t)}>
          {t === 'civ' ? '文明' : '地图'}
        </button>
      ))}
    </div>
  );
  const locked = (
    <h3>
      创建时定下的
      <small>
        <Icon name="lock" size={14} />
        不能再改
      </small>
    </h3>
  );
  if (tab === 'map') {
    return (
      <div className="ov-settings">
        {seg}
        <section className="ov-sec">
          {locked}
          <div className="ov-kv">
            {keptOf && (
              <div className="ov-kv-row" data-param="map-from">
                <span>地图</span>
                <b>{keptOf.title !== undefined ? `留自「${keptOf.title}」` : '留自旧世界'}</b>
              </div>
            )}
            <div className="ov-kv-row" data-param="seed">
              <span>种子</span>
              <b>{params.seed}</b>
            </div>
            {SLIDERS.map((s) => (
              <div key={s.key} className="ov-kv-row" data-param={s.key}>
                <span>{s.name}</span>
                <b>{s.fmt(params[s.key])}</b>
              </div>
            ))}
            {/* 大陆五样:改过才列(按种子来的世界和以前一样) */}
            {!contDefault(params) && (
              <>
                <div className="ov-kv-row" data-param="continents">
                  <span>大陆数量</span>
                  <b>{params.continents ? `${params.continents} 块` : '自动'}</b>
                </div>
                {CONT_SLIDERS.filter((s) => !SYSTEM_LEVEL_KEYS.includes(s.key as (typeof SYSTEM_LEVEL_KEYS)[number])).map((s) => (
                  <div key={s.key} className="ov-kv-row" data-param={s.key}>
                    <span>{s.name}</span>
                    <b>{s.fmt(params[s.key])}</b>
                  </div>
                ))}
              </>
            )}
            <div className="ov-kv-row" data-param="terrain">
              <span>改过的地形</span>
              <b>{terrainBrief(edits.terrain, edits.sketch)}</b>
            </div>
          </div>
          {keptOf && <p className="ov-txt dim ov-kept-note">这张地图是旧世界留下的，不会再按种子重新长。</p>}
        </section>
        <section className="ov-sec">
          {cur?.kind === 'created' && <MapCivs id={cur.id} disabled={p.generating} />}
          <h3 className="ov-gap">这颗星球是怎么来的</h3>
          <p className="ov-txt dim">从板块漂移到流水侵蚀，几秒钟看完这颗星球长成现在的样子，接着放{yearsSpan(end, true)}的历史。</p>
          <button className="ov-btn ov-ico-btn replay" data-act="replay" disabled={p.generating || p.replay.on} onClick={p.onReplay}>
            <Icon name="replay" size={16} />
            {p.replay.on ? (p.replay.ready ? '正在回放' : '正在准备回放') : '回放世界形成'}
          </button>
        </section>
      </div>
    );
  }
  const era = (
    <>
      <EraSection civ={p.civ} end={end} />
      <MonthSection civ={p.civ} />
    </>
  );
  return (
    <div className="ov-settings">
      {seg}
      {narrow && <section className="ov-sec">{era}</section>}
      <section className="ov-sec">
        {locked}
        <div className="ov-kv">
          <div className="ov-kv-row" data-param="civ-seed">
            <span>文明种子</span>
            <b>{civSeedOf(edits, params.seed)}</b>
          </div>
          <div className="ov-kv-row" data-param="name-mix">
            <span>地名风格</span>
            <b>{mixSummary(edits.nameMix)}</b>
          </div>
          <div className="ov-kv-row" data-param="end-year">
            <span>推演年数</span>
            <b>{end} 年</b>
          </div>
          <div className="ov-kv-row" data-param="calamity">
            <span>天灾</span>
            <b>{calamityText(edits.calamity)}</b>
          </div>
          {/* 只有建好、存着的世界能另存一份重推(别人分享来看看的、存不进浏览器的不行) */}
          {rulesUiOn() && <RulesRow rules={edits.rules} worldId={cur?.kind === 'created' ? cur.id : undefined} />}
          <div className="ov-kv-row" data-param="spread">
            <span>民族扩散</span>
            <b>{speedText(edits.frontier?.spread ?? 1)}</b>
          </div>
          <div className="ov-kv-row" data-param="expand">
            <span>国家扩张</span>
            <b>{speedText(edits.frontier?.expand ?? 1)}</b>
          </div>
          <div className="ov-kv-row" data-param="terrain-cost">
            <span>地形难走程度</span>
            <b>{terrainCostBrief(edits.frontier)}</b>
          </div>
          <div className="ov-kv-row" data-param="origins">
            <span>文明起源</span>
            <b>{originsBrief(edits.origins?.pts, p.world, p.civ)}</b>
          </div>
        </div>
        <h3 className="ov-gap">想换个样子</h3>
        {keptOf ? (
          <p className="ov-txt">这些一变，文明就要整个重来。想试试别的样子，可以以「{title || '它'}」为底稿另建一个世界：设定带过去，地图按新版重新长，和这里的不一样。</p>
        ) : (
          <p className="ov-txt">
            这些一变，文明就要整个重来。想试试别的样子，可以以{title || '它'}为底稿另建一个世界：设定全部带过去，改过的名字和干预也跟过去，
            {title || '原来的世界'}本身不变。
          </p>
        )}
        <button className="ov-btn ov-primary ov-ico-btn" data-act="draft-from" disabled={p.generating} onClick={p.onDraftFrom}>
          <Icon name="copy" size={16} />
          以它为底稿新建…
        </button>
      </section>
      {!narrow && <section className="ov-sec">{era}</section>}
    </div>
  );
}

/** 「地图」页右栏:这张地图上的文明(正在看的标出来,别的点了打开)、「在这张地图上打造新文明…」 */
function MapCivs({ id, disabled }: { id: string; disabled: boolean }) {
  const edits = useEdits();
  const saves = useSavesVersion();
  const mates = useMemo(() => mapMates(listWorlds(), id, { map: edits.map }), [saves, id, edits.map]);
  // 存不进浏览器的(满了)不在列表里:没法从它打造,这一块不显示
  if (!mates.some((w) => w.id === id)) return null;
  return (
    <>
      <h3>
        这张地图上的文明<small>{mates.length} 个</small>
      </h3>
      {mates.length > 0 && (
        <div className="ov-kv ov-civs">
          {mates.map((w) => {
            const here = w.id === id;
            const seed = civSeedOf(w.save.edits, w.save.params.seed);
            const line = `${w.draft ? '还在新建' : w.alive === undefined ? '' : w.alive ? `现存 ${w.alive} 国，` : '没长出国家，'}${w.draft ? '' : `文明种子 ${seed}`}`;
            const body = (
              <>
                {w.thumb ? <img src={w.thumb} alt="" /> : <span className="ov-civ-th" />}
                <span className="ov-civ-t">
                  {civName(w)}
                  <small>{line}</small>
                </span>
                {here ? <em>正在看</em> : <Icon name="chevron" size={16} />}
              </>
            );
            return here ? (
              <div key={w.id} className="ov-kv-row ov-civ on" data-civ={w.id}>
                {body}
              </div>
            ) : (
              <button key={w.id} className="ov-kv-row ov-civ" data-civ={w.id} onClick={() => openWorldById(w.id)}>
                {body}
              </button>
            );
          })}
        </div>
      )}
      <p className="ov-txt dim ov-civs-note">同一张地图，换一个文明种子从第 0 年推，就是另一个文明：民族、国家、名字都从头长。原来的几个都不动。</p>
      <button className="ov-btn ov-primary ov-ico-btn" data-act="settings-new-civ" disabled={disabled} onClick={() => startNewCiv(id)}>
        <Icon name="map" size={16} />
        在这张地图上打造新文明…
      </button>
    </>
  );
}
