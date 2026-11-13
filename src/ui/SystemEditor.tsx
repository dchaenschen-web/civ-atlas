/**
 * 星系结构编辑器(新建世界第 2 步里的弹层;按需加载,不占首页体积)。
 *
 * 左边是"种子派生的样子",改过的项写成覆盖表(只记改了什么的那些);点「恢复默认」清空覆盖表。
 * 小行星带用 impact 参数(关/自然/频繁),重掷整系用 salt 参数。卫星的轨道/大小/锁定也能改。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldParams } from '../gen/params';
import { generateAstro, type AstroSystem } from '../gen/astro';
import type { BodyGen, PlanetDesign, PlanetOverride, SurfaceOverride, SystemOverrides } from '../gen/astroDesign';
import { bodyViewOf } from '../gen/bodyView';
import { PLANET_TYPES, PLANET_TYPE_NAME, planetTypeOf, isHotJupiter } from '../gen/astroDesign';
import { MOON_TYPES, MOON_TYPE_NAME, moonTypeOf, type MoonType } from '../gen/astroDesign';
import { cleanBodyName, namedBodies } from '../gen/astroNames';
import { SURFACE_TEMPLATES, applyBodyTemplate, applySurfaceTemplate, bodyTemplateOf, templateFits, type SurfaceTemplateId } from '../gen/surfaceTemplates';
import { moonPhases, planetPhases, planetSurface } from '../gen/astroWorlds';
import { lookOf, terrainColor, type TerrainLook } from '../render/terrainLook';
import { phasesOf } from '../gen/materials';
import { skinOf, type SurfaceSkin } from '../gen/surfaceKinds';
import type { TerrainOp } from '../gen/edits';
import { beltsOf, impactRateOf, moonWorldParams } from '../gen/system';
import { systemSpecOf } from '../gen/systemSpec';
import { applyStarCount, resolveStarCount, resolveSubSystem } from '../gen/systemRole';
import { MS_MASS_SAFE, SPECTRAL_CLASSES, habitableZone, spectralOf, starAt, starLabelOf } from '../gen/stellar';
import { SystemLevelPanel } from './SystemLevelPanel';
import { SystemTree, type TreeSel } from './SystemTree';
import { canBeHome, canBeHomeMoon } from '../gen/bodyRules';
import { SystemGlobe } from './SystemGlobe';
import { geometryOf } from '../gen/geometry';
import { generateWorld, type World } from '../gen/world';
import { sketchGrid } from '../gen/sketch';
import { makeSketchAssetPack, openSketchAssetPack, putSketchAsset, bodyIdOfMoon, bodyIdOfPlanet } from '../gen/sketchAssets';
import { dropSketchImage, draftWorldIdOf, exportSketchPack, hydrateSketchAssets, importSketchPack, importSketchImage, sketchOf, sketchUrlOf, SKETCH_ASSET_MAX_BYTES } from './sketchAssetStore';

export interface SystemEditorProps {
  /** N12A:打开时先选中哪颗行星/卫星(地球仪上点「编辑这颗行星」进来用) */
  focus?: { kind: 'planet' | 'moon'; planet?: number; moon?: number };
  params: WorldParams;
  overrides: SystemOverrides;
  onChange: (o: SystemOverrides) => void;
  onParams: (patch: Partial<WorldParams>) => void;
  onClose: () => void;
  /** 右栏小星系图:星系模式中间已有 3D 星图,传 false 隐藏 */
  miniGlobe?: boolean;
  /** 只渲染一部分:'tree' = 只渲染星系树栏;'props' = 只渲染天体参数栏(树栏隐藏) */
  part?: 'all' | 'tree' | 'props';
  /** 受控选中(树与参数栏分开渲染时用来同步) */
  sel?: TreeSel;
  onSel?: (s: TreeSel) => void;
}

const RING: Record<string, string> = { f: '白黄矮星', g: '黄矮星', k: '橙矮星', m: '红矮星', bin: '双星' };
const ARCH: Record<number, string> = { 0: '单星', 1: '双固态行星', 2: '双恒星', 3: '气态巨星的宜居卫星' };

const box: React.CSSProperties = { border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8, padding: '10px 12px', marginTop: 10, background: 'rgba(255,255,255,0.55)' };
const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '150px repeat(4, 92px) 84px 78px 54px 96px', gap: 6, alignItems: 'center', padding: '3px 0', fontSize: 12.5 };
const th: React.CSSProperties = { fontSize: 11.5, opacity: 0.6, paddingBottom: 2 };
const numIn: React.CSSProperties = { width: 82, fontSize: 12, padding: '2px 4px', border: '1px solid rgba(128,128,128,0.3)', borderRadius: 4, background: 'rgba(255,255,255,0.8)' };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 数字输入:清空 = 去掉覆盖(回到种子派生的值);输入合法数字 = 写覆盖 */
function NumIn({ value, min, max, step, onSet }: { value: number; min: number; max: number; step: number; onSet: (v: number | null) => void }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  // 输入时原样保留(输入 0 不要立刻变成 0.01);失焦/回车再夹到范围内并回写
  const commit = () => {
    if (txt === '') return onSet(null);
    const n = Number(txt);
    if (!Number.isFinite(n)) {
      setTxt(String(value));
      return;
    }
    const c = clamp(n, min, max);
    setTxt(String(c));
    if (c !== value) onSet(c);
  };
  return (
    <input
      type="number"
      style={numIn}
      value={txt}
      step={step}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function setPlanet(o: SystemOverrides, index: number, patch: Partial<PlanetOverride>): SystemOverrides {
  const list = o.planets.filter((x) => x.index !== index);
  const cur = o.planets.find((x) => x.index === index) ?? { index };
  const next: PlanetOverride = { ...cur, ...patch };
  for (const k of Object.keys(patch) as (keyof PlanetOverride)[]) if (patch[k] === undefined) delete next[k];
  if (Object.keys(next).length > 1) list.push(next);
  else if (patch.home === false) list.push({ index, home: false });
  list.sort((a, b) => a.index - b.index);
  return { ...o, planets: list };
}

function setHome(o: SystemOverrides, index: number): SystemOverrides {
  const list = o.planets.map((x) => {
    if (x.index === index) return { ...x, home: true };
    if (!x.home) return x;
    const { home: _h, ...rest } = x;
    return rest as PlanetOverride;
  });
  if (!list.some((x) => x.index === index)) list.push({ index, home: true });
  return { ...o, planets: list };
}

function setMoon(o: SystemOverrides, planet: number, moon: number, patch: { type?: MoonType; distance?: number; radius?: number; mass?: number; periodDays?: number; locked?: boolean; terrain?: TerrainOp[]; surface?: SurfaceOverride; gen?: BodyGen }): SystemOverrides {
  const list = o.moons.filter((x) => !(x.planet === planet && x.moon === moon));
  const cur = o.moons.find((x) => x.planet === planet && x.moon === moon) ?? { planet, moon };
  const next = { ...cur };
  for (const k of ['distance', 'radius', 'mass', 'periodDays'] as const) {
    if (patch[k] === undefined) delete next[k];
    else next[k] = patch[k] as number;
  }
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.locked !== undefined) next.locked = patch.locked;
  if (patch.terrain !== undefined) next.terrain = patch.terrain;
  if (patch.surface !== undefined) next.surface = patch.surface;
  if (patch.gen !== undefined) next.gen = patch.gen;
  if (next.type !== undefined || next.distance !== undefined || next.radius !== undefined || next.mass !== undefined || next.periodDays !== undefined || next.locked !== undefined || next.terrain !== undefined || next.surface !== undefined || next.gen !== undefined) list.push(next);
  list.sort((a, b) => a.planet - b.planet || a.moon - b.moon);
  return { ...o, moons: list };
}

/** 当前双星构型:参数优先,没写就看设计里生成出来的那一档 */
export function resolveBinaryTier(p: { binaryTier?: number }, d: { binaryStar?: { tier: string } }): number {
  if (p.binaryTier !== undefined) return p.binaryTier;
  const t = d.binaryStar?.tier ?? 'close';
  return t === 'triple' ? 2 : t === 'wide' ? 1 : 0;
}

export function SystemEditor({ params, overrides, onChange, onParams, onClose, focus, miniGlobe, part, sel: selProp, onSel: onSelProp }: SystemEditorProps) {
  const sys = useMemo(() => generateAstro(params, overrides), [params, overrides]);
  // 星体名:种子生成 + 手动改名(存在覆盖表的 bodyNames 里)
  const names = useMemo(() => namedBodies(sys, params.seed, overrides), [sys, params.seed, overrides]);
  /** 星系 → 行星 → 卫星 的分层视图(界面只读这一份,不再各处拼 design + overrides) */
  const spec = useMemo(() => systemSpecOf(sys, params, overrides), [sys, params, overrides]);
  const belts = useMemo(() => beltsOf(sys.design, params.seed, params.impact), [sys.design, params.seed, params.impact]);
  const [tab, setTab] = useState<'planets' | 'moons'>('planets');
  /** 卡片里点中的行星(只影响高亮;改参数还是看表格) */
  const [card, setCard] = useState(-1);
  /** 正在改地形的那颗行星(-1 = 没开) */
  const [terrainFor, setTerrainFor] = useState(-1);
  /** 正在改地形的卫星(planet, moon;-1 = 没开) */
  const [terrainMoon, setTerrainMoon] = useState<{ planet: number; moon: number } | null>(null);
  /** R1-3:正在"看地表"的卫星(只读预览;null = 没开) */
  const [moonView, setMoonView] = useState<{ planet: number; moon: number } | null>(null);
  /** 正在改地表参数的行星/卫星 */
  const [surfaceFor, setSurfaceFor] = useState(-1);
  const [surfaceMoon, setSurfaceMoon] = useState<{ planet: number; moon: number } | null>(null);
  const surfaceOf = (i: number) => overrides.planets.find((x) => x.index === i)?.surface;
  const moonSurfaceOf = (planet: number, moon: number) => overrides.moons.find((x) => x.planet === planet && x.moon === moon)?.surface;
  const changed = overrides.planets.length + overrides.moons.length;
  /** 左树选中:star / planet i / moon p:m */
  const [selLocal, setSelLocal] = useState<TreeSel>(focus ? (focus.kind === 'moon' ? { kind: 'moon', p: focus.planet ?? 0, m: focus.moon ?? 0 } : { kind: 'planet', i: focus.planet ?? 0 }) : { kind: 'star' });
  const sel = selProp ?? selLocal;
  const setSel = (s: TreeSel) => { setSelLocal(s); onSelProp?.(s); };
  useEffect(() => { if (selProp) setSelLocal(selProp); }, [selProp]);
  /** 改星体名:写进覆盖表的 bodyNames(空名字 = 恢复按种子生成的名字) */
  const setBodyName = (patch: { star?: string; planet?: [number, string]; moon?: [number, number, string] }) => {
    const cur = overrides.bodyNames ?? {};
    const next: NonNullable<SystemOverrides['bodyNames']> = { ...cur };
    if (patch.star !== undefined) next.star = cleanBodyName(patch.star);
    if (patch.planet) {
      const [i, raw] = patch.planet;
      const m = { ...(cur.planets ?? {}) };
      const nm = cleanBodyName(raw);
      if (nm) m[String(i)] = nm;
      else delete m[String(i)];
      next.planets = m;
    }
    if (patch.moon) {
      const [p, k, raw] = patch.moon;
      const m = { ...(cur.moons ?? {}) };
      const nm = cleanBodyName(raw);
      if (nm) m[p + ':' + k] = nm;
      else delete m[p + ':' + k];
      next.moons = m;
    }
    const empty = !next.star && !Object.keys(next.planets ?? {}).length && !Object.keys(next.moons ?? {}).length;
    onChange({ ...overrides, bodyNames: empty ? undefined : next });
  };

  const moonRows = useMemo(() => {
    const out: { planet: number; moon: number; p: PlanetDesign; mi: number }[] = [];
    spec.planets.forEach((b) => b.moons.forEach((m) => out.push({ planet: m.planet, moon: m.moon, p: b.design, mi: m.moon })));
    return out;
  }, [spec]);
  /** 左树选中的行星/卫星(没选中就是 null) */
  const selPlanet = sel.kind === 'planet' && sel.i !== undefined ? spec.planets[sel.i] ?? null : null;
  const selMoon = sel.kind === 'moon' && sel.p !== undefined && sel.m !== undefined ? spec.planets[sel.p]?.moons.find((x) => x.moon === sel.m) ?? null : null;
  /** 地表模板选择器 */
  const tplPicker = (onPick: (id: SurfaceTemplateId) => void) => (
    <select
      data-act="surface-template"
      value=""
      onChange={(e) => {
        const id = e.target.value as SurfaceTemplateId;
        if (id) onPick(id);
      }}
      style={{ fontSize: 12, padding: '1px 4px', borderRadius: 4, border: '1px solid rgba(60,60,67,0.25)', background: '#fff', color: '#1d1d1f' }}
    >
      <option value="">套用模板…</option>
      {SURFACE_TEMPLATES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
  /** 最新一次模板套用的反馈(点了要有可见结果) */
  const [tplNote, setTplNote] = useState('');
  /** 现在的光谱型/子型:参数里有就用参数,否则按实际恒星温度反查 */
  const selSp = params.spectral !== undefined ? clamp(Math.round(params.spectral), 0, 6) : SPECTRAL_CLASSES.indexOf(spectralOf(sys.design.star.temp).cls);
  const selClassIndex = selSp;
  const selClass = SPECTRAL_CLASSES[selSp];
  const selSub = params.sub !== undefined ? clamp(Math.round(params.sub), 0, 9) : spectralOf(sys.design.star.temp).sub;
  const hz = habitableZone(sys.design.star.lum);
  const offMain = sys.design.star.mass > 16 || sys.design.star.mass < 0.08;
  /** 选光谱型:清掉质量覆盖,让类型真正生效 */
  const pickSpectral = (i: number) => {
    onParams({ spectral: i });
    if (overrides.star?.mass !== undefined) onChange({ ...overrides, star: { ...overrides.star, mass: undefined } });
  };
  /** B2 的分组标题(纯视觉分组:把散着的参数按用途拢在一起) */
  const sec = (key: string, title: string) => (
    <div data-act={`b2-sec-${key}`} style={{ marginTop: 10, marginBottom: 2, fontSize: 11.5, fontWeight: 600, opacity: 0.62, borderTop: '1px solid rgba(60,60,67,0.12)', paddingTop: 6 }}>
      {title}
    </div>
  );  /** 取某颗天体自己的生成参数 */
  const genOf = (i: number) => overrides.planets.find((x) => x.index === i)?.gen;
  const moonGenOf = (p: number, m: number) => overrides.moons.find((x) => x.planet === p && x.moon === m)?.gen;
  /** 手绘图资产挂在这个草稿世界 id 下(同一个种子/salt 前后一致,重开草稿也接得上) */
  const worldId = draftWorldIdOf(params);
  /**
   * 重开存档 / 重开草稿时,先把这个世界的手绘图从 IndexedDB 读回内存再画:
   * 照图的那几颗要靠它长地形,读回来之前先按随机画会闪一下。
   */
  const [sketchHyd, setSketchHyd] = useState(0);
  useEffect(() => {
    let live = true;
    setSketchHyd(0);
    void hydrateSketchAssets(worldId).then((n) => {
      if (live && n > 0) setSketchHyd(n);
    });
    return () => {
      live = false;
    };
  }, [worldId]);
  /** 手绘图导入的反馈 / 在忙 */
  const [sketchNote, setSketchNote] = useState('');
  const [sketchBusy, setSketchBusy] = useState(false);
  const pickRef = useRef<HTMLInputElement | null>(null);
  /** 导入手绘图资产包用的文件框 */
  const packRef = useRef<HTMLInputElement | null>(null);
  /** 正在给谁选图(行星 i 或卫星 p-m) */
  const pickFor = useRef<{ kind: 'planet'; i: number } | { kind: 'moon'; p: number; m: number } | null>(null);
  /** 选一张图 → 压缩/认图/存 IndexedDB → 把 sketchId 写进这颗天体的生成参数 */
  const onPickSketch = async (file: File | null | undefined) => {
    const at = pickFor.current;
    pickFor.current = null;
    if (!file || !at) return;
    setSketchBusy(true);
    try {
      const bodyId = at.kind === 'planet' ? bodyIdOfPlanet(at.i) : bodyIdOfMoon(at.p, at.m);
      const r = await importSketchImage(file, worldId, bodyId);
      if (at.kind === 'planet') setGen(at.i, { mode: 'image', sketchId: r.ref.key });
      else setMoonGen(at.p, at.m, { mode: 'image', sketchId: r.ref.key });
      const warn = r.warning === 'colorful' ? ' · 彩色图按深浅认的,可能不准' : r.warning === 'specks' ? ' · 认出来比较碎' : r.warning === 'sea' ? ' · 几乎全是海' : r.warning === 'land' ? ' · 几乎全是陆地' : '';
      setSketchNote(`已导入 ${r.ref.width}×${r.ref.height} · ${(r.ref.size / 1024).toFixed(0)} KB · 陆地 ${(r.land * 100).toFixed(0)}% · ${r.pieces} 块${warn}`);
    } catch (err) {
      setSketchNote(String(err instanceof Error ? err.message : err));
    } finally {
      setSketchBusy(false);
    }
  };
  const setGen = (i: number, patch: NonNullable<ReturnType<typeof genOf>>) =>
    onChange(setPlanet(overrides, i, { gen: { ...(genOf(i) ?? {}), ...patch } }));
  const setMoonGen = (p: number, m: number, patch: NonNullable<ReturnType<typeof moonGenOf>>) =>
    onChange(setMoon(overrides, p, m, { gen: { ...(moonGenOf(p, m) ?? {}), ...patch } }));
  /**
   * 右键删除:行星靠「行星数」这个参数少一颗(覆盖表按下标重排),卫星靠 moonCount 少一颗。
   * 只动这一颗自己的参数,别的天体序号往前挪一位。
   */
  const removePlanet = (i: number) => {
    const count = Math.max(1, Math.min(6, Math.round(params.planets || sys.design.planets.length) - 1));
    const planets = overrides.planets
      .filter((o) => o.index !== i)
      .map((o) => (o.index > i ? { ...o, index: o.index - 1 } : o));
    const moons = overrides.moons
      .filter((o) => o.planet !== i)
      .map((o) => (o.planet > i ? { ...o, planet: o.planet - 1 } : o));
    const bodyNames = overrides.bodyNames;
    let nextNames = bodyNames;
    if (bodyNames) {
      const planetsNamed: Record<string, string> = {};
      for (const [k, v] of Object.entries(bodyNames.planets ?? {})) {
        const idx = Number(k);
        if (idx === i) continue;
        planetsNamed[String(idx > i ? idx - 1 : idx)] = v;
      }
      nextNames = { ...bodyNames, planets: Object.keys(planetsNamed).length ? planetsNamed : undefined };
    }
    onChange({ ...overrides, planets, moons, bodyNames: nextNames });
    onParams({ planets: count });
    setSel({ kind: 'star' });
  };
  const removeMoon = (planet: number, moon: number) => {
    const moons = overrides.moons
      .filter((o) => !(o.planet === planet && o.moon === moon))
      .map((o) => (o.planet === planet && o.moon > moon ? { ...o, moon: o.moon - 1 } : o));
    const cur = overrides.planets.find((o) => o.index === planet)?.moonCount ?? sys.design.planets[planet]?.moons.length ?? 1;
    onChange(setPlanet({ ...overrides, moons }, planet, { moonCount: Math.max(0, cur - 1) }));
    setSel({ kind: 'planet', i: planet });
  };
  /** 设为主行星(把别的 home 清掉);气态行星 / 太小的不给设 */
  const setHomePlanet = (i: number) => {
    const rule = canBeHome(sys.design, i);
    if (!rule.ok) {
      window.alert(rule.reason ?? '这颗行星不能当主行星');
      return;
    }
    const planets = overrides.planets.map((o) => (o.index === i ? { ...o, home: true } : o.home ? { ...o, home: undefined as unknown as boolean } : o));
    onChange({ ...overrides, planets });
    onParams({ home: i + 1, homeMoon: undefined });
  };
  /** 宜居卫星系:把一颗卫星设为主行星(主天体 = 卫星) */
  const setHomeMoon = (planet: number, moon: number) => {
    const rule = canBeHomeMoon(sys.design, planet, moon);
    if (!rule.ok) {
      window.alert(rule.reason ?? '这颗卫星不能当主行星');
      return;
    }
    onParams({ home: planet + 1, homeMoon: moon });
  };
  /** 地表模板:一键套用全部数据(地表 + 生成参数 + 质量/半径/生命) */
  const applyTpl = (i: number, id: SurfaceTemplateId) => {
    const t = bodyTemplateOf(id);
    const r = applyBodyTemplate(id, surfaceOf(i), genOf(i));
    if (!t || !r) return;
    let next = setPlanet(overrides, i, { surface: r.surface, gen: r.gen });
    next = setPlanet(next, i, { mass: r.physical.mass, radius: r.physical.radius, life: r.physical.life });
    onChange(next);
    const ph = planetPhases(sys, i, surfaceOf(i), genOf(i));
    const fit = ph ? templateFits(id, ph.tempK, ph.pressure) : null;
    setTplNote(
      `已套用「${t.surface.label}」· 陆地 ${Math.round((r.surface.landFraction ?? 0.5) * 100)}% · 气温 ${(r.surface.temperature ?? 0) > 0 ? '+' : ''}${r.surface.temperature ?? 0}°C · 降水 ${(r.surface.rainfall ?? 0).toFixed(1)}× · ${r.surface.cells ?? 0} 地块 · 板块 ${r.gen.plates ?? 0}` +
        (fit && !fit.fits ? ` · ⚠ ${fit.reason}` : ''),
    );
  };
  const applyMoonTpl = (p: number, m: number, id: SurfaceTemplateId) => {
    const t = bodyTemplateOf(id);
    const r = applyBodyTemplate(id, moonSurfaceOf(p, m), moonGenOf(p, m));
    if (!t || !r) return;
    let next = setMoon(overrides, p, m, { surface: r.surface, gen: r.gen });
    next = setMoon(next, p, m, { mass: r.physical.mass, radius: r.physical.radius });
    onChange(next);
    setTplNote(`已套用「${t.surface.label}」· 卫星 · 陆地 ${Math.round((r.surface.landFraction ?? 0.5) * 100)}% · 气温 ${r.surface.temperature ?? 0}°C · ${r.surface.cells ?? 0} 地块`);
  };

  if (part === 'tree') {
    return (
      <div data-act="system-tree-only" style={{ height: '100%', overflow: 'auto' }}>
        <SystemTree
          spec={spec}
          names={{ star: names.star, planets: names.planets, moons: names.moons }}
          params={params}
          overrides={overrides}
          sel={sel}
          onSel={setSel}
          onChange={onChange}
          onParams={onParams}
          onRename={(node) => setSel(node)}
          onTerrain={(i) => setTerrainFor(i)}
          onSurface={(i) => setSurfaceFor(i)}
          onReroll={(i) => onChange(setPlanet(overrides, i, { reroll: ((overrides.planets.find((x) => x.index === i)?.reroll ?? 0) % 999) + 1 }))}
          sys={sys}
        />
      </div>
    );
  }
  return (
    <div data-part={part} style={part === 'props' ? { position: 'relative', zIndex: 0 } : { position: 'fixed', inset: 0, background: 'rgba(20,24,32,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
          data-act="system-editor"
          data-theme={part === 'props' ? undefined : 'light'}
          style={part === 'props' ? { width: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', padding: 8, color: '#dbe6f7' } : { width: 'min(1500px, 96vw)', height: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 16, borderRadius: 14, background: '#f6f6f8', color: '#1c1c22' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 选手绘图用的文件框(点「照图」时触发) */}
        <input
          ref={pickRef}
          type="file"
          accept="image/*"
          data-act="sketch-file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.currentTarget.value = '';
            void onPickSketch(f);
          }}
        />
        <div style={{ ...(part === 'props' ? { display: 'none' } : {}), display: part === 'props' ? 'none' : 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 15 }}>星系与天体</b>
          <span style={{ fontSize: 12, opacity: 0.65, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              aria-label="恒星名"
              data-act="rename-star"
              value={names.star}
              onChange={(e) => setBodyName({ star: e.target.value })}
              title="点这里改恒星名(清空 = 恢复按种子生成的名字)"
              style={{ width: 96, fontSize: 12, padding: '1px 4px', border: '1px solid rgba(60,60,67,0.25)', borderRadius: 4, background: '#fff', color: '#1d1d1f' }}
            />
            · {RING[sys.design.star.id] ?? sys.star.label} · {ARCH[sys.design.arch] ?? '单星'} · 改过的项 {changed} 条
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {sketchBusy && <span style={{ fontSize: 11.5, opacity: 0.65 }}>正在导入手绘图…</span>}
            <button className="ov-btn" data-act="system-reset" onClick={() => onChange({ planets: [], moons: [], bodyNames: undefined })}>
              恢复默认
            </button>
            <button className="ov-btn" data-act="system-reroll" onClick={() => onParams({ salt: ((Math.round(params.salt) + 1) % 1000) || 1 })} title="换一整套行星/卫星(只改种子派生出来的样子,已改的覆盖表保留)">
              重掷整系
            </button>
            <button className="ov-btn" data-act="system-close" onClick={onClose}>
              完成
            </button>
          </span>
        </div>

        {/* 手绘图的反馈 + 资产包(导出 .world 时并排给出,不和存档格式抢) */}
        {(sketchNote || true) && (
          <div data-act="sketch-note" style={{ display: part === 'props' ? 'none' : 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 11.5 }}>
            <span style={{ color: sketchNote.includes('不能') || sketchNote.includes('失败') ? '#c07070' : '#2f7a4a' }}>{sketchNote}</span>
            {sketchHyd > 0 && <span style={{ opacity: 0.6 }}>已从本机读回 {sketchHyd} 张手绘图</span>}
            <span style={{ opacity: 0.55 }}>手绘图最长边 ≤1024 · 单张 ≤{(SKETCH_ASSET_MAX_BYTES / 1_000_000).toFixed(1)} MB · 每世界 ≤8 MB,存在本机 IndexedDB</span>
            <button
              className="ov-btn"
              data-act="sketch-pack-export"
              style={{ padding: '0 6px' }}
              onClick={async () => {
                const blob = await exportSketchPack(worldId);
                if (!blob) return setSketchNote('这个世界还没有手绘图');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${worldId}-sketch.civsketch`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 4000);
                setSketchNote(`已导出手绘图资产包 · ${(blob.size / 1024).toFixed(0)} KB`);
              }}
            >
              导出图包
            </button>
            <button
              className="ov-btn"
              data-act="sketch-pack-import"
              style={{ padding: '0 6px' }}
              onClick={() => packRef.current?.click()}
            >
              导入图包
            </button>
            <input
              ref={packRef}
              type="file"
              accept=".civsketch,application/x-civ-sketch-assets"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.currentTarget.value = '';
                if (!f) return;
                try {
                  const n = await importSketchPack(worldId, f);
                  setSketchNote(`已导入 ${n} 张手绘图`);
                } catch (err) {
                  setSketchNote(String(err instanceof Error ? err.message : err));
                }
              }}
            />
          </div>
        )}
        {/* 树页:左树(星系→行星→卫星)+ 右属性 */}
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, marginTop: 8 }}>
          <div data-act="system-tree" style={{ ...(part === 'props' ? { display: 'none' } : {}), flex: '0 0 250px', overflow: 'auto', borderRight: '1px solid rgba(60,60,67,0.12)', paddingRight: 8 }}>
            <SystemTree
              spec={spec}
              names={{ star: names.star, planets: names.planets, moons: names.moons }}
              params={params}
              overrides={overrides}
              sel={sel}
              onSel={setSel}
              onChange={onChange}
              onParams={onParams}
              onRename={(node) => {
                setSel(node);
                setTimeout(() => {
                  const el = document.querySelector<HTMLInputElement>('[aria-label="行星名"],[aria-label="卫星名"],[aria-label="恒星名"]');
                  el?.focus();
                  el?.select();
                }, 60);
              }}
              onTerrain={(i) => setTerrainFor(i)}
              onSurface={(i) => setSurfaceFor(i)}
              onReroll={(i) => onChange(setPlanet(overrides, i, { reroll: ((overrides.planets.find((x) => x.index === i)?.reroll ?? 0) % 999) + 1 }))}
          sys={sys}
            />
          </div>
          <div data-act="system-props" style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingRight: 4 }}>
            <div style={{ ...box }} data-act="system-props-box">
              {sel.kind === 'star' && (
                <>
                  <b style={{ fontSize: 13 }}>恒星：{names.star}</b>
                  <span style={{ marginLeft: 8, fontSize: 11.5, opacity: 0.6 }}>
                    {selClass}·{selSub}V · {resolveStarCount(params) === 2 ? '双恒星' : '单星'}
                  </span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 6, flexWrap: 'wrap' }} data-act="star-count-row">
                    <span style={{ opacity: 0.65, minWidth: 60 }}>恒星数量</span>
                    <button className="ov-btn" data-act="star-count-1" onClick={() => onParams(applyStarCount(params, 1))} style={resolveStarCount(params) === 1 ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>单星</button>
                    <button className="ov-btn" data-act="star-count-2" onClick={() => onParams(applyStarCount(params, 2))} style={resolveStarCount(params) === 2 ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>双恒星</button>
                  </div>
                  {resolveStarCount(params) === 2 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 6, flexWrap: 'wrap' }} data-act="star-tier-row">
                      <span style={{ opacity: 0.65, minWidth: 60 }}>双星构型</span>
                      {[['密近双星', 0], ['分离双星', 1], ['三合星', 2]].map(([label, v]) => (
                        <button
                          key={String(v)}
                          className="ov-btn"
                          data-act={`star-tier-${v}`}
                          onClick={() => onParams({ binaryTier: v as number })}
                          style={resolveBinaryTier(params, sys.design) === v ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}
                        >
                          {label}
                        </button>
                      ))}
                      <span style={{ opacity: 0.55 }}>
                        {sys.design.binaryStar ? `AB ${sys.design.binaryStar.sepAU.toFixed(2)} AU · 互绕 ${(sys.design.binaryStar.periodDays / 365.25).toFixed(1)} 年` : '—'}
                        {sys.design.binaryStar?.outerSepAU ? ` · C 在 ${Math.round(sys.design.binaryStar.outerSepAU)} AU(${(sys.design.binaryStar.outerPeriodYears ?? 0).toFixed(0)} 年)` : ''}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, marginTop: 6, flexWrap: 'wrap' }} data-act="star-spectral-row">
                    <span style={{ opacity: 0.65, minWidth: 60 }}>光谱型</span>
                    {SPECTRAL_CLASSES.map((c, i) => (
                      <button key={c} className="ov-btn" data-act={`star-spectral-${i}`} title={`${starLabelOf(c)}（温度端点 ${starAt(c, 0).temp}–${starAt(c, 9).temp} K）`} onClick={() => pickSpectral(i)} style={{ padding: '0 6px', ...(selClassIndex === i ? { borderColor: '#5fa85f', color: '#5fa85f' } : {}) }}>
                        {c}
                      </button>
                    ))}
                    <span style={{ opacity: 0.6, marginLeft: 6 }}>子型</span>
                    <NumIn value={selSub} min={0} max={9} step={1} onSet={(v) => onParams({ sub: v === null ? 2 : Math.round(v) })} />
                    <span style={{ opacity: 0.55 }}>0 最热 · 9 最冷</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '90px 100px 1fr', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 6 }}>
                    <span style={{ opacity: 0.65 }}>质量</span>
                    <NumIn value={overrides.star?.mass ?? sys.design.star.mass} min={0.08} max={20} step={0.05} onSet={(v) => onChange({ ...overrides, star: { ...(overrides.star ?? {}), mass: v ?? undefined } })} />
                    <span style={{ opacity: 0.65 }}>
                      M☉ · 光度 {sys.design.star.lum.toFixed(3)} L☉ · 温度 {Math.round(sys.design.star.temp)} K
                      {sys.design.star.radius ? ` · 半径 ${sys.design.star.radius.toFixed(2)} R☉` : ''}
                    </span>
                    <span style={{ opacity: 0.65 }}>宜居带</span>
                    <span style={{ opacity: 0.85 }}>{hz.innerAU.toFixed(2)}–{hz.outerAU.toFixed(2)} AU</span>
                    <span style={{ opacity: 0.6 }}>
                      {offMain ? '⚠ 已离开主序（超出 0.08–16 M☉）' : '主序 V · 光度/温度/半径由赫罗模型派生'}
                    </span>
                  </div>
                  {resolveStarCount(params) === 2 && sys.design.binaryStar && (
                    <div style={{ display: 'grid', gridTemplateColumns: '90px 100px 1fr', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 6 }} data-act="star-sep-row">
                      <span style={{ opacity: 0.65 }}>AB 间距</span>
                      <NumIn
                        value={overrides.star?.sepAU ?? sys.design.binaryStar.sepAU}
                        min={0.005}
                        max={100}
                        step={0.01}
                        onSet={(v) => onChange({ ...overrides, star: { ...(overrides.star ?? {}), sepAU: v ?? undefined } })}
                      />
                      <span style={{ opacity: 0.6 }}>
                        AU · 互绕 {(sys.design.binaryStar.periodDays / 365.25).toFixed(1)} 年
                        {overrides.star?.sepAU !== undefined && Math.abs(overrides.star.sepAU - sys.design.binaryStar.sepAU) > 1e-6
                          ? ` · 输入 ${overrides.star.sepAU} AU 落在不稳定带，已按行星轨道夹到 ${sys.design.binaryStar.sepAU.toFixed(3)} AU`
                          : ' · 行星轨道按 S 型 / P 型判定'}
                      </span>
                      {sys.design.binaryStar.tier === 'triple' && (
                        <>
                          <span style={{ opacity: 0.65 }}>C 间距</span>
                          <NumIn
                            value={overrides.star?.outerSepAU ?? sys.design.binaryStar.outerSepAU ?? 0}
                            min={50}
                            max={50000}
                            step={100}
                            onSet={(v) => onChange({ ...overrides, star: { ...(overrides.star ?? {}), outerSepAU: v ?? undefined } })}
                          />
                          <span style={{ opacity: 0.6 }}>
                            AU · C 公转 {(sys.design.binaryStar.outerPeriodYears ?? 0).toFixed(0)} 年（不小于 5×AB）
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}              {sel.kind === 'companion' && sys.design.binaryStar && (
                <>
                  <b style={{ fontSize: 13 }}>伴星：{sys.design.binaryStar.companion.label}</b>
                  <div style={{ display: 'grid', gridTemplateColumns: '90px 100px 1fr', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 6 }}>
                    <span style={{ opacity: 0.65 }}>伴星质量</span>
                    <NumIn value={overrides.star?.companionMass ?? sys.design.binaryStar.companion.mass} min={0.05} max={20} step={0.05} onSet={(v) => onChange({ ...overrides, star: { ...(overrides.star ?? {}), companionMass: v ?? undefined } })} />
                    <span style={{ opacity: 0.65 }}>
                      M☉ · 光度 {sys.design.binaryStar.companion.lum.toFixed(2)} L☉ · 温度 {Math.round(sys.design.binaryStar.companion.temp)} K
                      {sys.design.binaryStar.companion.radius ? ` · 半径 ${sys.design.binaryStar.companion.radius.toFixed(2)} R☉` : ''}
                    </span>
                    <span style={{ opacity: 0.65 }}>双星</span>
                    <span style={{ opacity: 0.85 }}>{sys.design.binaryStar.sepAU.toFixed(3)} AU</span>
                    <span style={{ opacity: 0.6 }}>互绕 {sys.design.binaryStar.periodDays.toFixed(1)} 天 · 伴星光度占 {(sys.design.binaryStar.lumRatio * 100).toFixed(0)}%</span>
                  </div>
                  <button className="ov-btn" data-act="companion-drop" onClick={() => onParams(applyStarCount(params, 1))} style={{ marginTop: 8 }}>
                    去掉伴星（回到单星）
                  </button>
                </>
              )}
              {selPlanet && (
                <>
                  <b style={{ fontSize: 13 }}>行星：{bodyViewOf(sys, 'p' + selPlanet.index)?.name ?? names.planets[selPlanet.index] ?? `行星 ${selPlanet.index + 1}`}</b>
                  <span style={{ marginLeft: 8, fontSize: 11.5, opacity: 0.6 }}>
                    {selPlanet.role === 'home' ? '主行星' : selPlanet.role === 'companion' ? '伴星' : selPlanet.role === 'habitableMoon' ? '宜居卫星' : '行星'}
                  </span>
                  {sec('physics', '① 物理')}
                  <div style={{ display: 'grid', gridTemplateColumns: '90px 100px 1fr', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 6 }}>
                    <span style={{ opacity: 0.65 }}>质量</span>
                    <NumIn value={overrides.planets.find((x) => x.index === selPlanet.index)?.mass ?? selPlanet.design.mass} min={0.001} max={5000} step={0.05} onSet={(v) => onChange(setPlanet(overrides, selPlanet.index, { mass: v ?? undefined }))} />
                    <span style={{ opacity: 0.65 }}>
                      M⊕ · 半径 {selPlanet.design.radius.toFixed(2)} R⊕ · 均温 {(selPlanet.design.tempK - 273.15).toFixed(0)}°C
                    </span>
                    <span style={{ opacity: 0.65 }}>公转周期</span>
                    <span style={{ opacity: 0.85 }}>{((bodyViewOf(sys, 'p' + selPlanet.index)?.orbit.periodDays ?? selPlanet.orbit.periodDays) / 365.25).toFixed(2)} 年</span>
                    <span style={{ opacity: 0.6 }}>
                      {Math.round(bodyViewOf(sys, 'p' + selPlanet.index)?.orbit.periodDays ?? selPlanet.orbit.periodDays)} 天 · a = {(bodyViewOf(sys, 'p' + selPlanet.index)?.orbit.a ?? selPlanet.orbit.a).toFixed(2)} AU · 卫星 {selPlanet.moons.length}
                    </span>
                  </div>
                  {sec('surface', '② 地表与气候')}
                  {selPlanet.design.kind === 'rocky' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 6 }}>
                      <span style={{ opacity: 0.65 }}>地表模板</span>
                      {tplPicker((id) => applyTpl(selPlanet.index, id))}
                      <span style={{ opacity: 0.7 }}>{planetPhases(sys, selPlanet.index, surfaceOf(selPlanet.index), genOf(selPlanet.index))?.text ?? ''}</span>
                    </div>
                  )}
                  {sec('source', '③ 来源与生成参数')}
                  <div style={{ display: 'grid', gridTemplateColumns: '86px 180px 1fr', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 6 }} data-act={`gen-grid-${selPlanet.index}`}>
                    <span style={{ opacity: 0.6 }}>生成方式</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button className="ov-btn" data-act={`gen-random-${selPlanet.index}`} onClick={() => setGen(selPlanet.index, { mode: 'random', sketchId: undefined })} style={(genOf(selPlanet.index)?.mode ?? 'random') === 'random' ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>
                        随机
                      </button>
                      <button
                        className="ov-btn"
                        data-act={`gen-image-${selPlanet.index}`}
                        disabled={sketchBusy}
                        title="选一张手绘图:照它的海陆长这颗行星(最长边 ≤1024、单张 ≤1.5 MB)"
                        onClick={() => {
                          pickFor.current = { kind: 'planet', i: selPlanet.index };
                          pickRef.current?.click();
                        }}
                        style={(genOf(selPlanet.index)?.mode ?? 'random') === 'image' ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}
                      >
                        照图
                      </button>
                      {genOf(selPlanet.index)?.sketchId && (
                        <button
                          className="ov-btn"
                          data-act={`gen-image-drop-${selPlanet.index}`}
                          title="不用这张手绘图了(图还留在本机,可再选)"
                          onClick={() => {
                            const id = genOf(selPlanet.index)?.sketchId;
                            setGen(selPlanet.index, { mode: 'random', sketchId: undefined });
                            if (id) void dropSketchImage(worldId, bodyIdOfPlanet(selPlanet.index));
                            setSketchNote('');
                          }}
                          style={{ padding: '0 5px' }}
                        >
                          去掉图
                        </button>
                      )}
                    </span>
                    <span style={{ opacity: 0.55 }}>{genOf(selPlanet.index)?.sketchId ? '照这张手绘图长海陆' : '空着 = 继承世界级默认'}</span>
                    <span style={{ opacity: 0.6 }}>种子</span>
                    <NumIn value={genOf(selPlanet.index)?.seed ?? 0} min={0} max={4294967295} step={1} onSet={(v) => setGen(selPlanet.index, { seed: v && v > 0 ? Math.round(v) : undefined })} />
                    <span style={{ opacity: 0.55 }}>0 = 按这颗行星派生</span>
                    <span style={{ opacity: 0.6 }}>板块 / 造山</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <NumIn value={genOf(selPlanet.index)?.plates ?? Math.round(4 + 40 * selPlanet.design.geoActivity)} min={2} max={64} step={1} onSet={(v) => setGen(selPlanet.index, { plates: v ?? undefined })} />
                      <NumIn value={genOf(selPlanet.index)?.mountains ?? Math.round((0.2 + 1.6 * selPlanet.design.geoActivity) * 100) / 100} min={0} max={5} step={0.05} onSet={(v) => setGen(selPlanet.index, { mountains: v ?? undefined })} />
                    </span>
                    <span style={{ opacity: 0.55 }}>板块 2–64 · 造山 0–5</span>
                    <span style={{ opacity: 0.6 }}>陆地 / 气温</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <NumIn value={genOf(selPlanet.index)?.landFraction ?? 0} min={0} max={1} step={0.01} onSet={(v) => setGen(selPlanet.index, { landFraction: v && v >= 0.02 ? v : undefined })} />
                      <NumIn value={genOf(selPlanet.index)?.temperature ?? 0} min={-40} max={40} step={1} onSet={(v) => setGen(selPlanet.index, { temperature: v ?? undefined })} />
                    </span>
                    <span style={{ opacity: 0.55 }}>陆地 0 = 按相态自动</span>
                    <span style={{ opacity: 0.6 }}>降水 / 精度</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <NumIn value={genOf(selPlanet.index)?.rainfall ?? 1} min={0} max={5} step={0.1} onSet={(v) => setGen(selPlanet.index, { rainfall: v ?? undefined })} />
                      <NumIn value={genOf(selPlanet.index)?.cells ?? 0} min={0} max={200000} step={1000} onSet={(v) => setGen(selPlanet.index, { cells: v && v >= 200 ? Math.round(v) : undefined })} />
                    </span>
                    <span style={{ opacity: 0.55 }}>精度 0 = 按预算(默认 ≤6000)</span>
                  </div>
                  {sec('act', '⑤ 操作')}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, fontSize: 12, flexWrap: 'wrap' }}>
                    <span style={{ opacity: 0.6 }}>卫星数</span>
                    {(() => {
                      const own = overrides.planets.find((x) => x.index === selPlanet.index)?.moonCount;
                      const cur = own !== undefined ? own : selPlanet.moons.length;
                      const setN = (v: number) => onChange(setPlanet(overrides, selPlanet.index, { moonCount: Math.max(0, Math.min(12, Math.round(v))) }));
                      return (
                        <>
                          <button className="ov-btn" data-act={`prop-mooncount-${selPlanet.index}-dec`} disabled={cur <= 0} onClick={() => setN(cur - 1)} style={{ padding: '0 5px' }}>−</button>
                          <NumIn value={cur} min={0} max={12} step={1} onSet={(v) => setN(v ?? 0)} />
                          <button className="ov-btn" data-act={`prop-mooncount-${selPlanet.index}-inc`} disabled={cur >= 12} onClick={() => setN(cur + 1)} style={{ padding: '0 5px' }}>+</button>
                        </>
                      );
                    })()}
                    <button className="ov-btn" data-act={`prop-home-${selPlanet.index}`} onClick={() => setHomePlanet(selPlanet.index)} style={selPlanet.role === 'home' ? { color: '#c9a15a', borderColor: '#c9a15a' } : undefined}>
                      {selPlanet.role === 'home' ? '主行星' : '设为主行星'}
                    </button>
                    <input
                      aria-label="行星名"
                      data-act={`prop-name-${selPlanet.index}`}
                      value={names.planets[selPlanet.index] ?? ''}
                      onChange={(e) => setBodyName({ planet: [selPlanet.index, e.target.value] })}
                      placeholder="改名"
                      style={{ width: 90, fontSize: 12, padding: '1px 4px', border: '1px solid rgba(60,60,67,0.18)', borderRadius: 4 }}
                    />
                  </div>
                </>
              )}
              {selMoon && sel.p !== undefined && sel.m !== undefined && (
                <>
                  <b style={{ fontSize: 13 }}>卫星：{names.moons[sel.p]?.[sel.m] ?? `卫星 ${sel.m + 1}`}</b>
                  <span style={{ marginLeft: 8, fontSize: 11.5, opacity: 0.6 }}>母星 {names.planets[sel.p] ?? `行星 ${sel.p + 1}`}</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11.5, flexWrap: 'wrap', marginBottom: 4 }} data-act="moon-type-row">
                  <span style={{ opacity: 0.6 }}>类型</span>
                  {MOON_TYPES.map((t) => (
                    <button
                      key={t}
                      className="ov-btn"
                      data-act={`moon-type-${t}`}
                      onClick={() => onChange(setMoon(overrides, sel.p!, sel.m!, { type: t }))}
                      style={moonTypeOf(selMoon.design, spec.planets[sel.p!]?.design.tempK ?? 288) === t ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}
                    >
                      {MOON_TYPE_NAME[t]}
                    </button>
                  ))}
                  <span style={{ opacity: 0.55 }}>改类型会按类型重算地表配色</span>
                </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, fontSize: 12 }} data-act="moon-as-home">
                    <button
                      className="ov-btn"
                      data-act="prop-moon-home"
                      onClick={() => setHomeMoon(sel.p!, sel.m!)}
                      style={params.homeMoon === sel.m && params.home === sel.p! + 1 ? { color: '#c9a15a', borderColor: '#c9a15a' } : undefined}
                    >
                      {params.homeMoon === sel.m && params.home === sel.p! + 1 ? '主行星（这颗卫星）' : '把这颗卫星设为主行星'}
                    </button>
                    <span style={{ opacity: 0.55 }}>宜居卫星系:地表与文明都跑在这颗卫星上</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '90px 100px 1fr', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 6 }}>
                    <span style={{ opacity: 0.65 }}>质量</span>
                    <NumIn value={overrides.moons.find((x) => x.planet === sel.p && x.moon === sel.m)?.mass ?? selMoon.design.mass} min={0.0001} max={100} step={0.001} onSet={(v) => onChange(setMoon(overrides, sel.p!, sel.m!, { mass: v ?? undefined }))} />
                    <span style={{ opacity: 0.65 }}>
                      M⊕ · 半径 {selMoon.radius.toFixed(2)} R⊕ · 离母星 {selMoon.distance.toFixed(1)} R母
                    </span>
                    <span style={{ opacity: 0.65 }}>公转周期</span>
                    <span style={{ opacity: 0.85 }}>{(selMoon.periodDays / 365.25).toFixed(3)} 年</span>
                    <span style={{ opacity: 0.6 }}>{Math.round(bodyViewOf(sys, 'm' + sel.p + '-' + sel.m)?.orbit.periodDays ?? selMoon.periodDays)} 天 · {selMoon.locked ? '潮汐锁定' : '未锁定'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 6 }}>
                    <span style={{ opacity: 0.65 }}>地表模板</span>
                    {tplPicker((id) => applyMoonTpl(sel.p!, sel.m!, id))}
                    <span style={{ opacity: 0.7 }}>{moonPhases(sys.design, sel.p, sel.m, moonSurfaceOf(sel.p, sel.m), moonGenOf(sel.p, sel.m))?.text ?? ''}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '86px 180px 1fr', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 6 }}>
                    <span style={{ opacity: 0.6 }}>种子</span>
                    <NumIn value={moonGenOf(sel.p, sel.m)?.seed ?? 0} min={0} max={4294967295} step={1} onSet={(v) => setMoonGen(sel.p!, sel.m!, { seed: v && v > 0 ? Math.round(v) : undefined })} />
                    <span style={{ opacity: 0.55 }}>0 = 按这颗卫星派生</span>
                    <span style={{ opacity: 0.6 }}>板块 / 造山</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <NumIn value={moonGenOf(sel.p, sel.m)?.plates ?? 6} min={2} max={64} step={1} onSet={(v) => setMoonGen(sel.p!, sel.m!, { plates: v ?? undefined })} />
                      <NumIn value={moonGenOf(sel.p, sel.m)?.mountains ?? 0.6} min={0} max={5} step={0.05} onSet={(v) => setMoonGen(sel.p!, sel.m!, { mountains: v ?? undefined })} />
                    </span>
                    <span style={{ opacity: 0.55 }}>板块 2–64 · 造山 0–5</span>
                    <span style={{ opacity: 0.6 }}>陆地 / 气温</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <NumIn value={moonGenOf(sel.p, sel.m)?.landFraction ?? 0} min={0} max={1} step={0.01} onSet={(v) => setMoonGen(sel.p!, sel.m!, { landFraction: v && v >= 0.02 ? v : undefined })} />
                      <NumIn value={moonGenOf(sel.p, sel.m)?.temperature ?? 0} min={-40} max={40} step={1} onSet={(v) => setMoonGen(sel.p!, sel.m!, { temperature: v ?? undefined })} />
                    </span>
                    <span style={{ opacity: 0.55 }}>陆地 0 = 自动</span>
                    <span style={{ opacity: 0.6 }}>降水 / 精度</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <NumIn value={moonGenOf(sel.p, sel.m)?.rainfall ?? 0.3} min={0} max={5} step={0.1} onSet={(v) => setMoonGen(sel.p!, sel.m!, { rainfall: v ?? undefined })} />
                      <NumIn value={moonGenOf(sel.p, sel.m)?.cells ?? 0} min={0} max={200000} step={1000} onSet={(v) => setMoonGen(sel.p!, sel.m!, { cells: v && v >= 200 ? Math.round(v) : undefined })} />
                    </span>
                    <span style={{ opacity: 0.55 }}>精度 0 = 按预算</span>
                  </div>
                </>
              )}
              {tplNote && (
                <div data-act="tpl-note" style={{ marginTop: 6, fontSize: 11.5, color: '#2f7a4a', background: 'rgba(95,168,95,0.10)', border: '1px solid rgba(95,168,95,0.35)', borderRadius: 6, padding: '4px 6px' }}>
                  {tplNote}
                </div>
              )}
              {sel.kind !== 'star' && !selPlanet && !selMoon && <div style={{ fontSize: 12.5, opacity: 0.6 }}>在左边树里点一个天体。</div>}
            </div>

            {/* 先给一张星系示意图:恒星、轨道、宜居带、各行星(点一颗=选中,下面卡片/表格跟着变) */}
        <div style={{ ...box }} data-act="system-tree-diagram">
          {miniGlobe !== false && (
          <SystemGlobe design={sys.design} names={names.planets} belts={belts} selected={card >= 0 ? card : spec.home} onSelect={(i) => setCard(i)} />
          )}
        </div>

        {/* 星系这一层:参数面板和 Studio 第 1 步共用同一个组件 */}
        <div style={{ ...box }}>
          <SystemLevelPanel params={params} onParams={onParams} />
        </div>

        <div style={{ ...box, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, opacity: 0.75 }}>小行星带</span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {belts.length ? belts.map((b) => `${b.innerAU.toFixed(2)}–${b.outerAU.toFixed(2)} AU（${b.count} 颗）`).join('、') : '没有带（陨击只按普通频率）'}
            {belts.length ? ` · 主行星陨击率 ×${impactRateOf(sys.design, belts, sys.home.index).toFixed(2)}` : ''}
          </span>
          <span style={{ fontSize: 11.5, opacity: 0.5 }}>频率在上面「撞击频率」里改</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, fontSize: 12.5 }}>
          <button className="ov-btn" data-act="system-tab-planets" onClick={() => setTab('planets')} style={tab === 'planets' ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>
            行星（{spec.planets.length}）
          </button>
          <button className="ov-btn" data-act="system-tab-moons" onClick={() => setTab('moons')} style={tab === 'moons' ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>
            卫星（{moonRows.length}）
          </button>
        </div>

        {terrainFor >= 0 && sys.design.planets[terrainFor] && (
          <PlanetTerrainEditor
            title={`改 ${names.planets[terrainFor] ?? `行星 ${terrainFor + 1}`} 的地形`}
            worldOf={(ops) => planetSurface(sys, terrainFor, params, ops, surfaceOf(terrainFor), genOf(terrainFor), sketchGrid(sketchOf(genOf(terrainFor)?.sketchId)))}
            ops={(overrides.planets.find((x) => x.index === terrainFor)?.terrain as TerrainOp[] | undefined) ?? []}
            onOps={(ops) => onChange(setPlanet(overrides, terrainFor, { terrain: ops }))}
            onClose={() => setTerrainFor(-1)}
            sketchUrl={sketchUrlOf(genOf(terrainFor)?.sketchId)}
              look={lookOf(skinOfPlanet(sys, terrainFor))}
          />
        )}
        {terrainMoon && (
          <PlanetTerrainEditor
            title={`改 ${names.moons[terrainMoon.planet]?.[terrainMoon.moon] ?? '卫星'} 的地形`}
            worldOf={(ops) => generateWorld(moonWorldParams(sys.design, terrainMoon.planet, terrainMoon.moon, params, moonSurfaceOf(terrainMoon.planet, terrainMoon.moon), moonGenOf(terrainMoon.planet, terrainMoon.moon)), undefined, ops, sketchGrid(sketchOf(moonGenOf(terrainMoon.planet, terrainMoon.moon)?.sketchId)))}
            ops={(overrides.moons.find((x) => x.planet === terrainMoon.planet && x.moon === terrainMoon.moon)?.terrain as TerrainOp[] | undefined) ?? []}
            onOps={(ops) => onChange(setMoon(overrides, terrainMoon.planet, terrainMoon.moon, { terrain: ops }))}
            onClose={() => setTerrainMoon(null)}
            sketchUrl={sketchUrlOf(moonGenOf(terrainMoon.planet, terrainMoon.moon)?.sketchId)}
              look={lookOf(moonSkinOf(sys.design, terrainMoon.planet, terrainMoon.moon))}
          />
        )}
        {surfaceFor >= 0 && sys.design.planets[surfaceFor] && (
          <PlanetSurfaceEditor
            title={'改 ' + (names.planets[surfaceFor] ?? '行星 ' + (surfaceFor + 1)) + ' 的地表'}
            phases={planetPhases(sys, surfaceFor)?.text ?? ''}
            surface={surfaceOf(surfaceFor)}
            onChange={(s) => onChange(setPlanet(overrides, surfaceFor, { surface: s }))}
            onClose={() => setSurfaceFor(-1)}
          />
        )}
        {surfaceMoon && (
          <PlanetSurfaceEditor
            title={'改 ' + (names.moons[surfaceMoon.planet]?.[surfaceMoon.moon] ?? '卫星') + ' 的地表'}
            phases={moonPhases(sys.design, surfaceMoon.planet, surfaceMoon.moon)?.text ?? ''}
            surface={moonSurfaceOf(surfaceMoon.planet, surfaceMoon.moon)}
            onChange={(s) => onChange(setMoon(overrides, surfaceMoon.planet, surfaceMoon.moon, { surface: s }))}
            onClose={() => setSurfaceMoon(null)}
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 8, marginTop: 10 }}>
          {sys.design.planets.map((pl, i) => {
            const isHome = i === spec.home;
            const moonWorld = sys.design.habitableMoon?.index === i;
            const air = pl.atmos;
            return (
              <div
                key={i}
                data-card={i}
                onClick={() => setCard(i)}
                style={{
                  border: `1px solid ${card === i ? 'rgba(95,168,95,0.8)' : 'rgba(128,128,128,0.25)'}`,
                  borderRadius: 8,
                  padding: '8px 9px',
                  background: isHome ? 'rgba(201,161,90,0.10)' : 'rgba(255,255,255,0.55)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <input
                    aria-label="行星名"
                    data-act={`rename-planet-${i}`}
                    value={names.planets[i] ?? `行星 ${i + 1}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setBodyName({ planet: [i, e.target.value] })}
                    title="点这里改这颗行星的名字(清空 = 恢复按种子生成的名字)"
                    style={{ width: 108, fontSize: 12, fontWeight: 600, padding: '1px 4px', border: '1px solid rgba(60,60,67,0.18)', borderRadius: 4, background: 'rgba(255,255,255,0.7)', color: '#1d1d1f' }}
                  />
                  <span style={{ opacity: 0.55 }}>{pl.kind === 'gas' ? '气态' : moonWorld ? '卫星' : '岩石'}</span>
                  {isHome && (
                    <span style={{ marginLeft: 'auto', color: '#c9a15a' }}>
                      {params.homeMoon !== undefined && params.home === i + 1 ? '母星（主行星是它的卫星）' : '主行星'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4, fontSize: 11.5, flexWrap: 'wrap' }} data-act="planet-type-row">
                  <span style={{ opacity: 0.6 }}>类型</span>
                  {PLANET_TYPES.map((t) => (
                    <button
                      key={t}
                      className="ov-btn"
                      data-act={`planet-type-${t}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange(setPlanet(overrides, i, { type: t }));
                      }}
                      style={planetTypeOf(pl) === t ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}
                    >
                      {PLANET_TYPE_NAME[t]}
                    </button>
                  ))}
                  {isHotJupiter(pl) && <span style={{ color: '#c9a15a' }}>热木星</span>}
                  <span style={{ opacity: 0.55 }}>改类型会按类型重算半径/质量/大气/温度</span>
                </div>
                <div style={{ opacity: 0.7, marginTop: 3 }}>
                  {pl.a.toFixed(2)} AU · {pl.ecc.toFixed(2)} e · {pl.incDeg.toFixed(1)}° i
                </div>
                <div style={{ opacity: 0.7 }}>
                  {(pl.tempK - 273.15).toFixed(0)}°C · 半径 {pl.radius.toFixed(2)} R⊕
                </div>
                <div style={{ opacity: 0.7 }}>
                  {pl.kind === 'gas' ? `${pl.moons.length} 颗卫星（不做地表）` : air.breathable ? '可呼吸' : '不可呼吸'} · 卫星 {pl.moons.length}
                </div>
                {(
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 11.5 }}>
                    <span style={{ opacity: 0.6 }}>卫星数</span>
                    {(() => {
                      const own = overrides.planets.find((x) => x.index === i)?.moonCount;
                      const cur = own !== undefined ? own : pl.moons.length;
                      const setN = (v: number) => onChange(setPlanet(overrides, i, { moonCount: Math.max(0, Math.min(12, Math.round(v))) }));
                      return (
                        <>
                          <button className="ov-btn" data-act={`moon-count-${i}-dec`} disabled={cur <= 0} onClick={(e) => { e.stopPropagation(); setN(cur - 1); }} style={{ padding: '0 5px', fontSize: 11 }}>−</button>
                          <span onClick={(e) => e.stopPropagation()}>
                            <NumIn value={cur} min={0} max={12} step={1} onSet={(v) => setN(v ?? 0)} />
                          </span>
                          <button className="ov-btn" data-act={`moon-count-${i}-inc`} disabled={cur >= 12} onClick={(e) => { e.stopPropagation(); setN(cur + 1); }} style={{ padding: '0 5px', fontSize: 11 }}>+</button>
                        </>
                      );
                    })()}
                    {overrides.planets.find((x) => x.index === i)?.moonCount !== undefined && (
                      <button
                        className="ov-btn"
                        data-act={`moon-count-auto-${i}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChange(setPlanet(overrides, i, { moonCount: undefined }));
                        }}
                        style={{ padding: '0 5px', fontSize: 11 }}
                      >
                        按种子
                      </button>
                    )}
                  </div>
                )}
                {pl.kind === 'rocky' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <button
                      className="ov-btn"
                      data-act={`reroll-${i}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const cur = overrides.planets.find((x) => x.index === i)?.reroll ?? 0;
                        onChange(setPlanet(overrides, i, { reroll: (cur % 999) + 1 }));
                      }}
                      title="只换这颗行星的随机性(水圈 / 生物圈 / 大气),别的行星和恒星不动"
                      style={{ padding: '0 6px', fontSize: 11.5 }}
                    >
                      换一颗
                    </button>
                    <button
                      className="ov-btn"
                      data-act={`terrain-edit-${i}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTerrainFor(i);
                      }}
                      title="给这颗行星改地形(火山 / 山脉 / 湖 / 压低);和世界里改地形同一种改动,只作用在这颗行星"
                      style={{ padding: '0 6px', fontSize: 11.5, marginLeft: 6 }}
                    >
                      改地形…
                    </button>
                    <button
                      className="ov-btn"
                      data-act={`surface-edit-${i}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSurfaceFor(i);
                      }}
                      title="这颗行星的地表参数:陆地比例 / 气温 / 降水 / 精细度(不写 = 按它的温度与物质状态自动)"
                      style={{ padding: '0 6px', fontSize: 11.5, marginLeft: 6 }}
                    >
                      地表…
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {tab === 'planets' ? (
          <div style={box}>
            <div style={{ ...rowStyle, ...th }}>
              <span>行星</span>
              <span>轨道 a（AU）</span>
              <span>偏心率 e</span>
              <span>黄道角 i（°）</span>
              <span>升交点 Ω（°）</span>
              <span>半径 R⊕</span>
              <span>均温</span>
              <span>主行星</span>
              <span>生命</span>
            </div>
            {sys.design.planets.map((pl, i) => {
              const isHome = i === spec.home;
              const isMoonWorld = sys.design.habitableMoon?.index === i;
              return (
                <div key={i} onClick={() => setSel({ kind: 'planet', i })} style={{ ...rowStyle, background: card === i ? 'rgba(95,168,95,0.08)' : undefined, cursor: 'pointer' }} data-planet={i}>
                  <span title={isMoonWorld ? '气态巨星的宜居卫星' : undefined}>
                    {names.planets[i] ?? `行星 ${i + 1}`}
                    <small style={{ opacity: 0.55, marginLeft: 4 }}>{pl.kind === 'gas' ? '气态' : isMoonWorld ? '卫星' : '岩石'}</small>
                  </span>
                  <NumIn value={pl.a} min={0.01} max={60} step={0.01} onSet={(v) => onChange(setPlanet(overrides, i, { a: v ?? undefined }))} />
                  <NumIn value={pl.ecc} min={0} max={0.9} step={0.005} onSet={(v) => onChange(setPlanet(overrides, i, { ecc: v ?? undefined }))} />
                  <NumIn value={pl.incDeg} min={0} max={90} step={0.1} onSet={(v) => onChange(setPlanet(overrides, i, { incDeg: v ?? undefined }))} />
                  <NumIn value={pl.nodeDeg} min={0} max={360} step={1} onSet={(v) => onChange(setPlanet(overrides, i, { nodeDeg: v ?? undefined }))} />
                  <span style={{ fontSize: 12 }}>{pl.radius.toFixed(2)}</span>
                  <span style={{ fontSize: 12 }}>{(pl.tempK - 273.15).toFixed(0)}°C</span>
                  <button className="ov-btn" data-act={`home-${i}`} onClick={() => setHomePlanet(i)} title="文明从这里开始" style={isHome ? { color: '#c9a15a', borderColor: '#c9a15a' } : undefined}>
                    {isHome ? '主' : '设为'}
                  </button>
                  {pl.kind === 'rocky' ? (
                    <select
                      data-life={i}
                      value={String(overrides.planets.find((x) => x.index === i)?.life ?? 0)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        onChange(setPlanet(overrides, i, { life: v === 0 ? undefined : v }));
                      }}
                      style={{ ...numIn, width: 90 }}
                      title="这颗行星有没有生命(有生物圈才可呼吸;有生命的天体才能推文明)"
                    >
                      <option value="0">按种子</option>
                      <option value="1">有生命</option>
                      <option value="2">无生命</option>
                    </select>
                  ) : (
                    <span style={{ opacity: 0.4, fontSize: 11 }}>—</span>
                  )}
                </div>
              );
            })}
            <div style={{ fontSize: 11.5, opacity: 0.55, marginTop: 6 }}>轨道/偏心率/倾角改完立刻生效(均温、可呼吸跟着重算)。清空输入框 = 回到种子给的值。</div>
          </div>
        ) : (
          <div style={box}>
            {moonRows.length === 0 && <div style={{ fontSize: 12.5, opacity: 0.6 }}>这个星系还没有卫星(在「行星与生命」里把「主行星卫星数」调大)。</div>}
            {moonRows.length > 0 && (
              <div style={{ ...rowStyle, ...th, gridTemplateColumns: '220px 110px 90px 84px 110px', }}>
                <span>卫星</span>
                <span>离母星（R母）</span>
                <span>半径 R⊕</span>
                <span>潮汐锁定</span>
                <span>地形</span>
              </div>
            )}
            {moonRows.map((r) => {
              const m = r.p.moons[r.mi];
              return (
                <div key={`${r.planet}.${r.moon}`} style={{ ...rowStyle, gridTemplateColumns: '220px 110px 90px 84px 110px' }} data-moon={`${r.planet}.${r.moon}`}>
                  <span style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      aria-label="卫星名"
                      data-act={`rename-moon-${r.planet}-${r.moon}`}
                      value={names.moons[r.planet]?.[r.mi] ?? `卫星 ${r.mi + 1}`}
                      onChange={(e) => setBodyName({ moon: [r.planet, r.moon, e.target.value] })}
                      title="点这里改卫星名(清空 = 恢复按种子生成的名字)"
                      style={{ width: 120, fontSize: 12, padding: '1px 4px', border: '1px solid rgba(60,60,67,0.18)', borderRadius: 4, background: 'rgba(255,255,255,0.7)', color: '#1d1d1f' }}
                    />
                    <span style={{ opacity: 0.55 }}>{names.planets[r.planet] ?? `行星 ${r.planet + 1}`}</span>
                  </span>
                  <NumIn value={m.distance} min={0.5} max={2000} step={1} onSet={(v) => onChange(setMoon(overrides, r.planet, r.moon, { distance: v ?? undefined }))} />
                  <NumIn value={m.radius} min={0.05} max={20} step={0.01} onSet={(v) => onChange(setMoon(overrides, r.planet, r.moon, { radius: v ?? undefined }))} />
                  <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={m.locked} onChange={(e) => onChange(setMoon(overrides, r.planet, r.moon, { locked: e.target.checked }))} />
                    {m.locked ? '锁定' : ''}
                  </label>
                  <button
                    className="ov-btn"
                    data-act={`moon-view-${r.planet}-${r.moon}`}
                    onClick={() => setMoonView({ planet: r.planet, moon: r.moon })}
                    style={{ padding: '0 6px', fontSize: 11.5 }}
                    title="只看这颗卫星的地表(只读;要改就点「改地形…」)"
                  >
                    看地表…
                  </button>
                  <button
                    className="ov-btn"
                    data-act={`moon-terrain-${r.planet}-${r.moon}`}
                    onClick={() => setTerrainMoon({ planet: r.planet, moon: r.moon })}
                    style={{ padding: '0 6px', fontSize: 11.5 }}
                    title="给这颗卫星改地形(和世界里改地形同一种 TerrainOp)"
                  >
                    改地形…
                  </button>
                  <button
                    className="ov-btn"
                    data-act={`moon-surface-${r.planet}-${r.moon}`}
                    onClick={() => setSurfaceMoon({ planet: r.planet, moon: r.moon })}
                    style={{ padding: '0 6px', fontSize: 11.5 }}
                    title="这颗卫星的地表参数(不写 = 按母行星温度与物质状态自动)"
                  >
                    地表…
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {moonView && (
          <MoonSurfaceView
            title={`${names.moons[moonView.planet]?.[moonView.moon] ?? '卫星'} 的地表`}
            sub={moonPhases(sys.design, moonView.planet, moonView.moon)?.text ?? ''}
            worldOf={() => generateWorld(moonWorldParams(sys.design, moonView.planet, moonView.moon, params, moonSurfaceOf(moonView.planet, moonView.moon), moonGenOf(moonView.planet, moonView.moon)))}
            onClose={() => setMoonView(null)}
            skin={moonSkinOf(sys.design, moonView.planet, moonView.moon)}
          />
        )}
        <div style={{ fontSize: 11.5, opacity: 0.55, marginTop: 8 }}>
          这些改动只进存档文件,不进分享链接(A 方案);旧世界、没改过的世界和以前逐字节一样。
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 每颗行星自己的地形编辑:和世界里改地形同一种 TerrainOp(火山 / 山脉 / 湖 / 压低),只作用在这颗行星。
 * 画布是把这颗行星的地表按地块摊平画的(不引主地图那套渲染,弹层里够用)。
 */
/** 这颗行星的地貌风格(改地形底图用) */
/** 卫星类型 → 地貌皮肤(ice → 冰封,dwarf → 矮行星,rocky → 无大气岩石) */
function moonSkinOf(design: { planets: PlanetDesign[] }, planet: number, moon: number): SurfaceSkin {
  const p = design.planets[planet];
  const m = p?.moons?.[moon];
  if (!p || !m) return 'airless';
  const t = moonTypeOf(m, p.tempK);
  return t === 'ice' ? 'frozen' : t === 'dwarf' ? 'dwarf' : 'airless';
}

function skinOfPlanet(sys: { design: { planets: PlanetDesign[] } }, index: number): SurfaceSkin {
  const p = sys.design.planets[index];
  if (!p) return 'earth';
  const phase = phasesOf(p.tempK, p.atmos.pressure, { hasWater: p.hydro });
  return skinOf({ type: planetTypeOf(p), tempK: p.tempK, liquidWater: phase.water === 'liquid', hydro: p.hydro });
}

function PlanetTerrainEditor({
  title,
  worldOf,
  ops,
  onOps,
  onClose,
  sketchUrl, look,
}: {
  title: string;
  worldOf: (ops: TerrainOp[]) => World;
  ops: TerrainOp[];
  onOps: (ops: TerrainOp[]) => void;
  onClose: () => void;
  /** 这颗行星照的手绘图(半透明底图);没照图 = 不给 */
  sketchUrl?: string | null;
  /** 按行星类型给的配色(不给 = 地球色) */
  look?: TerrainLook;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const worldOfRef = useRef(worldOf);
  worldOfRef.current = worldOf;
  // 用内容的字符串当依赖:父组件每次渲染都会新建数组/闭包,直接依赖它们会无限重生成
  const opsKey = JSON.stringify(ops);
  const [tool, setTool] = useState<TerrainOp['kind']>('volcano');
  const [busy, setBusy] = useState(true);
  const W = 400;
  const H = 200;

  useEffect(() => {
    setBusy(true);
    const timer = window.setTimeout(() => {
      const cv = ref.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const world = worldOfRef.current(ops);
      const { mesh, water, elevation, temperature } = world;
      // 按地块索引给颜色(水体/高程/温度),再用 nearest 逐像素栅格化成一张连续的地图(不是撒点)
      const lookNow = look ?? lookOf('earth');
      const colorOf = (i: number): [number, number, number] => {
        const e = elevation[i];
        const t = temperature[i];
        // 高差阴影:和邻近地块比一下,山脊亮、坡面暗(只用来做立体感)
        return terrainColor(lookNow, e, t, water[i]);
      };
      const geo = geometryOf(mesh);
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const wy = ((y + 0.5) / H) * mesh.height;
        let hint = 0;
        for (let x = 0; x < W; x++) {
          const wx = ((x + 0.5) / W) * mesh.width;
          const cell = geo.nearest(wx, wy, hint);
          hint = cell;
          const c = colorOf(cell);
          const o = (y * W + x) * 4;
          img.data[o] = c[0];
          img.data[o + 1] = c[1];
          img.data[o + 2] = c[2];
          img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      // 照着手绘图长的那颗:把原图半透明铺在上面,方便对着改
      if (sketchUrl) {
        const im = new Image();
        im.onload = () => {
          ctx.globalAlpha = 0.38;
          ctx.drawImage(im, 0, 0, W, H);
          ctx.globalAlpha = 1;
        };
        im.src = sketchUrl;
      }
      setBusy(false);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [opsKey, sketchUrl]);

  const place = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 2048);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1024);
    const op: TerrainOp =
      tool === 'volcano'
        ? { kind: 'volcano', pts: [x, y], r: 18, s: 1.05 }
        : tool === 'range'
          ? { kind: 'range', pts: [x, y - 14, x, y, x, y + 14], r: 18, s: 1 }
          : tool === 'lake'
            ? { kind: 'lake', pts: [x, y], r: 14, s: 1 }
            : { kind: 'lower', pts: [x, y], r: 24, s: 1 };
    onOps([...ops, op]);
  };

  const tools: { id: TerrainOp['kind']; name: string }[] = [
    { id: 'volcano', name: '火山' },
    { id: 'range', name: '山脉' },
    { id: 'lake', name: '湖' },
    { id: 'lower', name: '压低' },
  ];

  return (
    <div style={{ ...box, marginTop: 10 }} data-act="planet-terrain-editor">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b style={{ fontSize: 13 }}>{title}</b>
        <span style={{ fontSize: 11.5, opacity: 0.6 }}>点地图上放:火山 / 山脉 / 湖 / 压低 · 已放 {ops.length} 处 · 只作用在这颗行星</span>
        <button className="ov-btn" data-act="terrain-done" onClick={onClose} style={{ marginLeft: 'auto' }}>
          完成
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 12, alignItems: 'center' }}>
        {tools.map((t) => (
          <button key={t.id} className="ov-btn" data-terrain-tool={t.id} onClick={() => setTool(t.id)} style={tool === t.id ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>
            {t.name}
          </button>
        ))}
        <button className="ov-btn" data-act="terrain-undo" disabled={!ops.length} onClick={() => onOps(ops.slice(0, -1))}>
          撤销一处
        </button>
        <button className="ov-btn" data-act="terrain-clear" disabled={!ops.length} onClick={() => onOps([])}>
          清空
        </button>
        {busy && <span style={{ opacity: 0.6 }}>生成中…</span>}
      </div>
      <canvas
        ref={ref}
        width={W}
        height={H}
        data-act="terrain-canvas"
        onClick={place}
        style={{ width: '100%', marginTop: 6, aspectRatio: '2 / 1', borderRadius: 6, cursor: 'crosshair', display: 'block', border: '1px solid rgba(128,128,128,0.25)' }}
      />
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>同一处点两次会叠加;地形修改和世界里的地形修改是同一种(TerrainOp),跟着存档走、不进分享链接。</div>
    </div>
  );
}

/**
 * 一颗天体的地表参数:陆地比例 / 气温偏移 / 降水倍率 / 精细度。
 * 不写的那几项 = 按这颗天体自己的温度与物质状态自动派生(gen/astroWorlds.planetWorldParams)。
 */
function PlanetSurfaceEditor({
  title,
  phases,
  surface,
  onChange,
  onClose,
}: {
  title: string;
  phases: string;
  surface?: SurfaceOverride;
  onChange: (s: SurfaceOverride | undefined) => void;
  onClose: () => void;
}) {
  const s = surface ?? {};
  const set = (patch: Partial<SurfaceOverride>) => {
    const next: SurfaceOverride = { ...s, ...patch };
    for (const k of Object.keys(patch) as (keyof SurfaceOverride)[]) if (patch[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const sliderRow = (label: string, val: number | undefined, min: number, max: number, step: number, fmt: (v: number) => string, on: (v: number | undefined) => void) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 4 }}>
      <span style={{ width: 72, opacity: 0.7 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={val ?? Math.round(((min + max) / 2) / step) * step} onChange={(e) => on(Number(e.target.value))} style={{ flex: 1 }} data-surf={label} />
      <span style={{ width: 64, textAlign: 'right' }}>{val === undefined ? '自动' : fmt(val)}</span>
      {val !== undefined && (
        <button className="ov-btn" data-surf-auto={label} style={{ padding: '0 6px', fontSize: 11 }} onClick={() => on(undefined)}>
          自动
        </button>
      )}
    </div>
  );
  const cellsOptions: { v: number; label: string }[] = [
    { v: 12000, label: '粗' },
    { v: 36000, label: '中' },
    { v: 90000, label: '细' },
    { v: 200000, label: '极细' },
  ];
  return (
    <div style={{ ...box, marginTop: 10 }} data-act="planet-surface-editor">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b style={{ fontSize: 13 }}>{title}</b>
        <span style={{ fontSize: 11.5, opacity: 0.6 }}>不写 = 按温度与物质状态自动</span>
        <button className="ov-btn" data-act="surface-done" onClick={onClose} style={{ marginLeft: 'auto' }}>
          完成
        </button>
      </div>
      {phases && <div style={{ fontSize: 11.5, opacity: 0.7, marginTop: 4 }}>物质状态:{phases}</div>}
      {sliderRow('陆地比例', s.landFraction, 0.02, 0.98, 0.02, (v) => Math.round(v * 100) + '%', (v) => set({ landFraction: v }))}
      {sliderRow('气温偏移', s.temperature, -40, 40, 1, (v) => Math.round(v) + '°C', (v) => set({ temperature: v ?? undefined }))}
      {sliderRow('降水倍率', s.rainfall, 0, 5, 0.1, (v) => v.toFixed(1) + '×', (v) => set({ rainfall: v ?? undefined }))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 6 }}>
        <span style={{ width: 72, opacity: 0.7 }}>精细度</span>
        {cellsOptions.map((o) => (
          <button
            key={o.v}
            className="ov-btn"
            data-act={`surface-cells-${o.v}`}
            onClick={() => set({ cells: o.v })}
            style={s.cells === o.v ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}
          >
            {o.label}
          </button>
        ))}
        <span style={{ opacity: 0.6 }}>{s.cells === undefined ? '自动(按预算)' : `${s.cells} 地块`}</span>
        {s.cells !== undefined && (
          <button className="ov-btn" data-act="surface-cells-auto" style={{ padding: '0 6px', fontSize: 11 }} onClick={() => set({ cells: undefined })}>
            自动
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>这些参数跟着存档走、不进分享链接;改完点行星卡片上的「改地形…」或直接看星球系页的详情。</div>
    </div>
  );
}


/** R1-3:卫星地表只读预览(640×320;和水体/高程/温度同一套上色) */
function MoonSurfaceView({ title, sub, worldOf, skin, onClose }: { title: string; sub: string; worldOf: () => World; skin: SurfaceSkin; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    setBusy(true);
    const t = window.setTimeout(() => {
      const cv = ref.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const W = 640;
      const H = 320;
      const world = worldOf();
      const { mesh, water, elevation, temperature } = world;
      const look = lookOf(skin);
      const geo = geometryOf(mesh);
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const wy = ((y + 0.5) / H) * mesh.height;
        let hint = 0;
        for (let x = 0; x < W; x++) {
          const wx = ((x + 0.5) / W) * mesh.width;
          const cell = geo.nearest(wx, wy, hint);
          hint = cell;
          const c = terrainColor(look, elevation[cell], temperature[cell], water[cell]);
          const o = (y * W + x) * 4;
          img.data[o] = c[0];
          img.data[o + 1] = c[1];
          img.data[o + 2] = c[2];
          img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      setBusy(false);
    }, 30);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div data-act="moon-surface-view" style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(10,12,18,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#12161f', color: '#dbe6f7', borderRadius: 12, padding: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <b style={{ fontSize: 14 }}>{title}</b>
          <span style={{ fontSize: 11.5, opacity: 0.6 }}>{busy ? '生成中…' : sub}</span>
          <button className="ov-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
            关闭
          </button>
        </div>
        <canvas ref={ref} width={640} height={320} style={{ display: 'block', borderRadius: 8, width: 640, height: 320, background: '#0b0f16' }} />
      </div>
    </div>
  );
}