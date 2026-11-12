/**
 * 「新建世界」的两步弹窗(在「我的世界」点「新建世界」时弹):
 *
 *   第 1 步  怎么生成:随机生成 / 照手绘图生成(两张带图的卡片,默认随机;双击一张 = 选它并下一步)。
 *            选好以后进新建界面,两种不能互换
 *   第 2 步  基础参数(就是新建界面「世界参数」那几样,默认值不变)。随机的有种子(随机给一个,能换);
 *            照图的先选一张图(拖进来或「选一张图」),不列陆地比例(海陆照图定),种子随机给,进去以后在「山河、地名换一种」里换。
 *            照图的「精细度」下面一组「拓荒」:民族扩散、国家扩张两条滑条(默认 1Ã—),「地形难走程度」一行点开原地展开八样地形
 *            (改过的数字变成强调色、前面一个圆点;「恢复默认」一下还原),组下面一段说明。
 *            最后一组「历史」:开关「推演超过 3000 年」(默认关),组下面一直写着那段说明;开了多一条「推演到」(刚打开 10000 年)。
 *            随机生成的不列「拓荒」「历史」(先只做地图,这两样在新建界面第 2 步「打造文明」里定)。
 *            底下一句说进去以后这些都还能改
 *
 * 朋友的预设链接(presetLink.ts)打开的:直接到第 2 步(随机生成),参数照链接填好;第 2 步标题下面那句换成一条浅蓝
 * "朋友分享的预设「…」，参数已经照它填好",右边「存进我的预设…」(打开「存成预设」小窗,名字先填好;存的是分享来的那一套,
 * 弹窗里后来改过的不算;不点不存)。
 * 选的预设带着规则:预设框旁边(手机上是下面一行)写一句,点「开始」时这个世界的规则选好那一套。
 *
 * 点「开始」才交给 App(存下没建完的世界、进新建界面;照图的把读好的图交过去,进去直接是第 1 步「认出海陆」)。
 * 首页上点的「开始」、地图程序还没下完(wait):按钮变成转圈 +「准备中」,旁边一句下了多少,下好就自动开始;
 * 这时参数先改不了、「上一步」点不了,「取消」照常(不打开了)。
 * 「取消」、Esc、点窗口外面:什么都不留下(读好的图也扔掉)。
 * 电脑上是浮在页面正中的窗口(第 2 步比窗口高时:标题和底部按钮不动,中间一段自己滚,上下各一条细线隔开);
 * 手机上从底部升起、几乎占满屏:顶上一排(取消 / 上一步、标题、第几步),底部一个大按钮。
 */
import { Fragment, Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { WorldParams } from '../gen/world';
import type { BaseParamKey } from '../gen/params';
import { CONT_SLIDERS, SLIDERS, YEARS_NOTE, YEARS_ON, YEARS_SLIDER, YEARS_SWITCH, contBrief, type SliderLike } from './genesisSliders';
import { CONT_RESET, ContinentSeg, OptionRow, ParamField, rangeFill } from './ParamField';
import { createPortal } from 'react-dom';
import type { SystemOverrides } from '../gen/astroDesign';
import { setCurrentSystem } from '../gen/systemState';
import { PresetPicker, SavePreset, type PresetPick } from './PresetPicker';
import { changedKeys, choiceParams, getPresets, usePresets, type SharedPreset } from './presetStore';
import { terrainChangedCount, type Frontier } from '../gen/civ/frontier';
import type { RuleSet } from '../gen/civ/ruleSet';
import { EXPAND_SLIDER, SPREAD_SLIDER, TERRAIN_SLIDERS, terrainValue, withSpeed, withTerrain, withoutTerrain } from './frontierUi';
import { isImageFile, loadImage, type LoadedImage } from './imageFile';
import { Icon } from './icons';
import { useMyRulesNames } from './rulesCount';
import { rulesUiOn } from './rules/flag';
import './ai.css';
import './newWorld.css';

export type NewWorldMode = 'random' | 'image';

export interface NewWorldStart {
  mode: NewWorldMode;
  params: WorldParams;
  /** 照手绘图:读好的那张图(交给 App 以后由它管,不再收回) */
  picture: LoadedImage | null;
  /** 推演到第几年(没开「推演超过 3000 年」= 不给) */
  endYear?: number;
  /** 拓荒(都是默认 = 不给) */
  frontier?: Frontier;
  /** 用哪一套规则(官方 = 不给;整套存进新世界,本机「我的规则」里的那一套带着本机编号) */
  rules?: RuleSet;
}

/** 从哪一步开始(刷新了照手绘图还没选好图的新建:回到它的第 2 步,参数、推演年数照网址) */
export interface NewWorldInit {
  mode: NewWorldMode;
  params: WorldParams;
  step: 1 | 2;
  endYear?: number;
}

export interface NewWorldDialogProps {
  phone: boolean;
  init?: NewWorldInit;
  /** 打开朋友的预设链接来的:分享的那一套(第 2 步顶上一条说明 +「存进我的预设…」) */
  shared?: SharedPreset;
  /** 这个世界的规则先选好这一套(别人分享的规则「用它新建世界」;原样交给 onStart,新建界面「文明」那一步里还能换) */
  rules?: RuleSet;
  /** 随机一个种子 */
  randomSeed: () => number;
  onCancel: () => void;
  onStart: (s: NewWorldStart) => void;
  /** 点了「开始」、地图程序还没下完:下了百分之几(null = 不知道) */
  wait?: { pct: number | null };
}

const PIC_RANDOM = `${import.meta.env.BASE_URL}new-random.jpg`;
const PIC_SKETCH = `${import.meta.env.BASE_URL}new-sketch.jpg`;

/** 首页出来以后先把第 1 步两张卡片的图下好(点「新建世界」时不用再等图) */
export function warmNewWorldPictures() {
  for (const src of [PIC_RANDOM, PIC_SKETCH]) new Image().src = src;
}

/** 第 1 步的两张卡片 */
const CARDS: { mode: NewWorldMode; name: string; desc: string }[] = [
  { mode: 'random', name: '随机生成', desc: '程序按一个种子长出整颗星球。不满意就换一颗，也能再用笔改地形。' },
  { mode: 'image', name: '照手绘图生成', desc: '导入你画的地图或高度图。海和陆地照着图长，山、河、气候由程序补上。' },
];

/** 第 2 步的几组参数:组名、组名右边一句(电脑上)、哪几样;「大陆」一组另外写(只有随机生成有) */
function groups(mode: NewWorldMode): { name: string; note?: string; keys: BaseParamKey[] }[] {
  return [
    mode === 'random'
      ? {
          name: '陆地',
          note: '海和陆地怎么分',
          keys: ['landFraction', 'plates', 'mountains'],
        }
      : // 照图的海陆照图定;板块硬度管山怎么长,照样有
        {
          name: '陆地',
          note: '山脉、高原怎么长',
          keys: ['plates', 'mountains', 'hardness'],
        },
    { name: '气候', keys: ['temperature', 'rainfall'] },
    // 星系、行星、卫星的一切(含地表参数与地形)都收在「星系与天体…」那一棵树里,这里不再摆滑条
    { name: '精细度', note: '越精细越慢', keys: ['cells'] },
  ];
}

const sliderOf = (k: keyof WorldParams) => (SLIDERS.find((x) => x.key === k) ?? CONT_SLIDERS.find((x) => x.key === k))!;

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/**
 * 一项参数:名字、滑条、能直接打字的数值框。打的字不对时这一行下面一句红字(超出范围:按回车会改成哪个数)。
 * sub = 展开的下一级(地形难走程度的八样,往里缩一点)
 */
function ParamRow({ s, value, onChange, phone, sub, changed }: { s: SliderLike; value: number; onChange: (v: number) => void; phone: boolean; sub?: boolean; changed?: boolean }) {
  const k = s.key;
  const [err, setErr] = useState<string | null>(null);
  const name = k === 'cells' ? '地块' : s.name;

  // 有具体名字的几档(恒星类型/构型/生命/撞击频率):不摆滑条,摆成分段选项
  if (s.options) {
    return (
      <div className={`nd-pr nd-pr-opt${sub ? ' sub' : ''}`} title={s.hint} data-param={k}>
        <span className="nd-n">{name}</span>
        <OptionRow s={s} value={value} onCommit={onChange} />
      </div>
    );
  }

  return (
    <>
      <label className={`nd-pr${sub ? ' sub' : ''}${err ? ' has-err' : ''}`} title={s.hint} data-param={k}>
        <span className="nd-n">{name}</span>
        <span className="tp-range">
          <input
            type="range"
            aria-label={s.name}
            className={k === 'north' ? 'mid' : undefined}
            min={s.min}
            max={s.max}
            step={s.step}
            value={value}
            style={rangeFill(s, value)}
            onChange={(e) => onChange(s.snap ? s.snap(Number(e.target.value)) : Number(e.target.value))}
          />
        </span>
        <ParamField s={s} value={value} onCommit={onChange} onBad={setErr} changed={changed} />
      </label>
      {err && <div className={`nd-err${phone ? ' phone' : ''}`}>{err}</div>}
    </>
  );
}

/** 打开弹窗时的参数:停在上次选的预设上(存了种子的连种子,存了规则的连规则) */
function startParams(randomSeed: () => number): {
  params: WorldParams;
  endYear?: number;
  rules?: RuleSet;
} {
  const c = choiceParams(getPresets(), getPresets().chosen);
  return {
    // 新世界默认开星球系,并且主行星默认有生物圈(保证可呼吸;想改在「星球系」一组里调)
    params: { ...c.params, astro: 1, life: 1, seed: c.seed ?? randomSeed() },
    endYear: c.endYear,
    rules: c.rules,
  };
}

/** 星系结构编辑器按需加载:首页只带一个按钮,编辑器(和它引的星系/命名代码)在打开时才下 */
const LazySystemEditor = lazy(() => import('./SystemEditor').then((m) => ({ default: m.SystemEditor })));

export function NewWorldDialog(p: NewWorldDialogProps) {
  const [step, setStep] = useState<1 | 2>(p.init?.step ?? 1);
  const [mode, setMode] = useState<NewWorldMode>(p.init?.mode ?? 'random');
  const [first] = useState(() => (p.init ? { params: p.init.params, endYear: p.init.endYear, rules: p.shared?.rules } : startParams(p.randomSeed)));
  const [params, setParams] = useState<WorldParams>(first.params);
  const [seedText, setSeedText] = useState(String(params.seed));
  const [seedBad, setSeedBad] = useState(false);
  const [picture, setPicture] = useState<LoadedImage | null>(null);
  /** 星系结构的逐行星/卫星覆盖表(S2:新建时可细化;空 = 和种子一样) */
  const [sysOv, setSysOv] = useState<SystemOverrides>({ planets: [], moons: [] });
  const [sysOpen, setSysOpen] = useState(false);
  /** 新建时先选:生成星球系(星系流程) / 不生成(原版流程) */
  const [astroOn, setAstroOn] = useState(false);
  /** 推演到第几年(开关关着 = undefined,就是 3000 年) */
  const [years, setYears] = useState<number | undefined>(first.endYear);
  /** 「大陆」一组展开了没有(平时收着,像打印窗口的「显示详细信息」) */
  const [contOpen, setContOpen] = useState(false);
  const presets = usePresets();
  /** 和所选预设不一样的几样(数字用主色写) */
  const changed = changedKeys(presets, presets.chosen, params);
  /** preset = 跟着选的预设来的;p.rules(别人分享的规则「用它新建世界」)先用,选了带规则的预设才换 */
  const [rules, setRules] = useState<{ r: RuleSet; preset: boolean } | null>(() => (p.rules ? { r: p.rules, preset: false } : first.rules && rulesUiOn() ? { r: first.rules, preset: true } : null));
  const ruleNames = useMyRulesNames();
  /** 选了一个预设:参数换成它的;存了种子的连种子换;没存规则的回到打开弹窗时的规则 */
  const applyPreset = (c: PresetPick) => {
    const seed = c.seed ?? params.seed;
    setParams({ ...c.params, seed });
    setSeedText(String(seed));
    setSeedBad(false);
    setYears(c.endYear);
    setSysOv({ planets: [], moons: [] });
    setRules(c.rules && rulesUiOn() ? { r: c.rules, preset: true } : p.rules ? { r: p.rules, preset: false } : null);
  };
  /** 拓荒(都是默认 = undefined);「地形难走程度」展开没有 */
  const [frontier, setFrontier] = useState<Frontier | undefined>(undefined);
  const [terrOpen, setTerrOpen] = useState(false);
  const [over, setOver] = useState(false);
  const loading = useRef(0);
  /** 还没交出去的那张图(关掉弹窗、换一张时扔掉) */
  const held = useRef<LoadedImage | null>(null);
  const given = useRef(false);
  useEffect(
    () => () => {
      // 还在读的图读完时窗口已经关了:算作过时的,读好就扔掉
      loading.current++;
      if (!given.current && held.current) URL.revokeObjectURL(held.current.url);
    },
    [],
  );

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const req = ++loading.current;
    const l = await loadImage(file);
    if (!l) return;
    if (req !== loading.current) return URL.revokeObjectURL(l.url);
    if (held.current) URL.revokeObjectURL(held.current.url);
    held.current = l;
    setPicture(l);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = () => fileRef.current?.click();
  // 等地图程序时参数先改不了(点「开始」时已经定了)
  const sheetRef = useRef<HTMLDivElement>(null);
  const waiting = !!p.wait;
  useEffect(() => {
    for (const el of sheetRef.current?.querySelectorAll('.nd-preset, .nd-scroll, .nd-pbody') ?? []) el.toggleAttribute('inert', waiting);
  }, [waiting]);
  // 没等到(地图程序下载失败,弹窗回到能改的样子):图还没人接,仍归这个弹窗管,关掉时照常扔掉
  const waited = useRef(false);
  useEffect(() => {
    if (waiting) waited.current = true;
    else if (waited.current) {
      waited.current = false;
      given.current = false;
    }
  }, [waiting]);

  const commitSeed = () => {
    const n = Math.floor(Number(seedText));
    if (n > 0) setParams((q) => ({ ...q, seed: n }));
    else setSeedText(String(params.seed));
  };
  const reroll = () => {
    const seed = p.randomSeed();
    setSeedBad(false);
    setSeedText(String(seed));
    setParams((q) => ({ ...q, seed }));
  };
  /** 朋友分享的预设:「存进我的预设…」的小窗开着没有、存过没有 */
  const [keepOpen, setKeepOpen] = useState(false);
  const [kept, setKept] = useState(false);
  const canStart = mode === 'random' || !!picture;
  const start = () => {
    if (!canStart) return;
    const n = Math.floor(Number(seedText));
    // 照手绘图:海岸照图,大陆一组里只露出板块硬度;预设带来的其余几样不显示,也不用
    const final = mode === 'random' ? (n > 0 ? { ...params, seed: n } : params) : { ...params, ...CONT_RESET, hardness: params.hardness };
    // 星系结构的覆盖表跟着这一次生成走(生成/推演请求都从 systemState 读)
    setCurrentSystem(sysOv);
    given.current = true;
    if (mode !== 'image' && held.current) URL.revokeObjectURL(held.current.url);
    p.onStart({ mode, params: final, picture: mode === 'image' ? picture : null, ...(years ? { endYear: years } : {}), ...(frontier && mode === 'image' ? { frontier } : {}), ...(rules ? { rules: rules.r } : {}) });
  };
  const next = (m: NewWorldMode = mode) => {
    setMode(m);
    // 星系流程:直接进「星系与天体」全屏树形页,不再走原来的第 2 步参数页
    if (astroOn && m === 'random') {
      setParams((q) => ({ ...q, astro: 1 }));
      setSysOpen(true);
      return;
    }
    setStep(2);
  };

  // Esc = 取消(第 2 步也是,"上一步"用按钮)
  const cancelRef = useRef(p.onCancel);
  cancelRef.current = p.onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
  
  return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 把图拖进窗口:第 2 步照手绘图时收下(别处松手不当成打开存档)
  // 点了「开始」在等地图程序的:图已经交出去了,不再换
  const dropOk = step === 2 && mode === 'image' && !p.wait;
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dropOk ? 'copy' : 'none';
    if (dropOk !== over) setOver(dropOk);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (dropOk && f && isImageFile(f)) void choose(f);
  };

  const title = step === 1 ? '新建世界' : mode === 'random' ? '随机生成' : '照手绘图生成';
  const sub =
    step === 1
      ? '先选这颗星球的地形从哪来。选好以后不能换成另一种。'
      : mode === 'random'
        ? '先定几样大的。拿不准就用默认的，进去以后看着星球再调。'
        : '选一张图，再定几样大的。海和陆地照图来，所以这里不用定陆地比例。';
  const info =
    mode === 'random'
      ? p.phone
        ? '进去以后这些都还能改，还能用笔改地形。地图做好了，可以先保存，也可以接着打造文明：推演年数、拓荒、文明从哪里起源，都在那一步。'
        : '进去以后，这些在左边「世界参数」里都还能改，还能用笔改地形。地图做好了，可以先保存，也可以接着打造文明：推演年数、拓荒、文明从哪里起源，都在那一步。'
      : '进去以后先认出图里的海和陆地，再用笔修。这些参数在「参数和名字」那一步都还能改；点「创建世界」以后才定下来。';

  const cards = (
    <div className="nd-cards" role="radiogroup" aria-label="怎么生成">
      {CARDS.map((c) => (
        <button
          key={c.mode}
          className={`nd-card${mode === c.mode ? ' on' : ''}`}
          role="radio"
          aria-checked={mode === c.mode}
          data-mode={c.mode}
          onClick={() => setMode(c.mode)}
          onDoubleClick={() => next(c.mode)}
        >
          <span className={`nd-pic ${c.mode}`}>
            <img src={c.mode === 'random' ? PIC_RANDOM : PIC_SKETCH} alt="" draggable={false} />
            {mode === c.mode ? (
              <span className="nd-check">
                <Icon name="check" size={14} />
              </span>
            ) : (
              <span className="nd-ring" />
            )}
          </span>
          <b>{c.name}</b>
          <span className="nd-d">{c.desc}</span>
        </button>
      ))}
    </div>
  );

  const seedGroup = (
    <>
      <div className="nd-lab">星球</div>
      <div className="nd-grp">
        <div className="nd-pr">
          <span className="nd-n">种子</span>
          <input
            className="nd-fld"
            aria-label="种子"
            data-act="dlg-seed"
            value={seedText}
            inputMode="numeric"
            onChange={(e) => {
              const v = e.target.value;
              const d = v.replace(/\D/g, '');
              setSeedBad(d !== v);
              setSeedText(d.slice(0, 9));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            onBlur={() => {
              setSeedBad(false);
              commitSeed();
            }}
          />
          {!p.phone && <span className={`nd-seed-tip${seedBad ? ' bad' : ''}`}>{seedBad ? '只能填数字' : '同一个种子总长出同一颗星球'}</span>}
          <button className="nd-sbtn" data-act="dlg-reroll" onClick={reroll}>
            <Icon name="dice" size={15} />
            换一个
          </button>
        </div>
      </div>
    </>
  );

  const imageBox = picture ? (
    <div className="nd-picked" data-act="dlg-picked">
      <img src={picture.url} alt="" draggable={false} />
      <div className="nd-picked-tx">
        <b title={picture.name}>{picture.name}</b>
        <span>
          {picture.w} Ã— {picture.h}，{picture.pic.colorful ? '彩色' : '灰度'}
        </span>
        <button className="nd-link" data-act="dlg-repick" onClick={pick}>
          换一张
        </button>
      </div>
    </div>
  ) : (
    <div className={`nd-drop${over ? ' over' : ''}`} data-act="dlg-drop">
      <Icon name="image" size={30} />
      {!p.phone && <b>把图片拖到这里</b>}
      <button className="nd-btn b2 nd-pick" data-act="dlg-pick" onClick={pick}>
        选一张图
      </button>
      <span className="nd-fine">手画的地图、彩色地图、只描了海岸的铅笔线稿、灰度高度图都行。图片只在这台{p.phone ? '手机' : '电脑'}上认，不会上传。</span>
    </div>
  );

  const setKey = (k: BaseParamKey) => (v: number) => setParams((q) => ({ ...q, [k]: v }));
  const row = (k: BaseParamKey) => <ParamRow key={k} s={sliderOf(k)} value={params[k]} phone={p.phone} changed={changed.has(k)} onChange={setKey(k)} />;
  // 大陆这几样和选中的预设(或默认)一样就不显示「恢复默认」;点它回到选中的那一套
  const contKeys = Object.keys(CONT_RESET) as (keyof typeof CONT_RESET)[];
  const contPlain = !contKeys.some((k) => changed.has(k));
  const resetCont = () => {
    const c = choiceParams(presets, presets.chosen).params;
    setParams((q) => ({ ...q, ...Object.fromEntries(contKeys.map((k) => [k, c[k]])) }));
  };
  // 「大陆」一组(只有随机生成):平时收成一行,右边写改了哪些;展开是大陆数量(分段按钮)和四个滑条
  const contSec = mode === 'random' && (
    <div className="nd-sec" data-sec="continents">
      <div className="nd-lab">
        大陆
        {!contOpen ? (
          <small>可选</small>
        ) : contPlain ? (
          !p.phone && <small>数量、形状和分布</small>
        ) : (
          <button className="nd-lab-a" data-act="dlg-cont-reset" onClick={resetCont}>
            恢复默认
          </button>
        )}
      </div>
      <div className="nd-grp">
        {!contOpen ? (
          <button className="nd-pr nd-more" data-act="dlg-cont" aria-expanded={false} onClick={() => setContOpen(true)}>
            <span className="nd-more-n">数量、聚拢、破碎、软硬、南北</span>
            <span className="nd-more-s">{contBrief(params) ?? '都按种子来'}</span>
            <Icon name="chevron" size={14} />
          </button>
        ) : (
          <>
            <div className="nd-pr" data-param="continents">
              <span className="nd-n">大陆数量</span>
              <ContinentSeg value={params.continents} onChange={setKey('continents')} plates={params.plates} land={params.landFraction} />
            </div>
            {CONT_SLIDERS.map((x) => row(x.key))}
          </>
        )}
      </div>
      {contOpen && <p className="nd-foot">这几样改的是大陆怎么长：同一个种子配上不同的设置，会长出不一样的星球。</p>}
    </div>
  );
  const terrN = terrainChangedCount(frontier);
  const frontierGroup = (
    <div className="nd-sec" data-group="frontier">
      <div className="nd-lab">
        拓荒
        <small>越快，荒地越早有人住</small>
      </div>
      <div className="nd-grp">
        <ParamRow s={SPREAD_SLIDER} value={SPREAD_SLIDER.pos(frontier?.spread ?? 1)} phone={p.phone} changed={frontier?.spread !== undefined} onChange={(v) => setFrontier((f) => withSpeed(f, 'spread', SPREAD_SLIDER.value(v)))} />
        <ParamRow s={EXPAND_SLIDER} value={EXPAND_SLIDER.pos(frontier?.expand ?? 1)} phone={p.phone} changed={frontier?.expand !== undefined} onChange={(v) => setFrontier((f) => withSpeed(f, 'expand', EXPAND_SLIDER.value(v)))} />
        <div className="nd-pr nd-go-row" role="button" tabIndex={0} aria-expanded={terrOpen} data-act="dlg-terrain" onClick={() => setTerrOpen((o) => !o)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setTerrOpen((o) => !o))}>
          <span className="nd-n w2">地形难走程度</span>
          <span className="nd-go">
            {terrOpen ? (
              terrN > 0 && (
                <span
                  className="nd-lk"
                  role="button"
                  data-act="dlg-terrain-reset"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFrontier((f) => withoutTerrain(f));
                  }}
                >
                  恢复默认
                </span>
              )
            ) : (
              <span>{terrN ? `改过 ${terrN} 样` : '默认'}</span>
            )}
            <Icon name="chevron" size={13} className={`nd-chev${terrOpen ? ' up' : ''}`} />
          </span>
        </div>
        {terrOpen &&
          TERRAIN_SLIDERS.map(({ g, s }) => {
            const v = terrainValue(frontier, g);
            return <ParamRow key={g.key} s={s} sub value={s.pos(v)} phone={p.phone} changed={v !== g.def} onChange={(x) => setFrontier((f) => withTerrain(f, g, s.value(x)))} />;
          })}
      </div>
      <p className="nd-foot">
        {terrOpen && (
          <>
            <b>地形难走程度</b>：走同样远的路要花几倍的时间，森林算 1。调大了，人和国家都更难往那里去。冰原和大片沙漠本来就住不了人，调小了也只是走得过去，不会有人住下。
            <br />
          </>
        )}
        {p.phone ? (
          <>
            <b>民族扩散</b>：人往荒地走得多快，2Ã— 大约第 1500 年住满。
            <br />
            <b>国家扩张</b>：国家并下周围部落地有多快。
          </>
        ) : (
          <>
            <b>民族扩散</b>：人往荒地走得多快。1Ã— 是现在的样子，大约第 3000 年住满；2Ã— 大约第 1500 年就住满了。
            <br />
            <b>国家扩张</b>：国家把周围没有国家的地并进来有多快。调快了，没有国家的部落地留得少。
          </>
        )}
      </p>
    </div>
  );

  const paramsBody = (
    <>
      {mode === 'random' ? seedGroup : imageBox}
      {groups(mode).map((g, i) => (
        <Fragment key={g.name}>
          <div className="nd-sec">
            <div className="nd-lab">
              {g.name}
              {g.note && (!p.phone || g.keys[0] === 'cells') && <small>{g.note}</small>}
            </div>
            <div className="nd-grp">{g.keys.map(row)}</div>
          </div>
          {i === 0 && contSec}
        </Fragment>
      ))}
      {step === 2 && (
        <div className="nd-sec">
          <div className="nd-lab">
            星系与天体
            <small>恒星 / 行星 / 卫星 一棵树</small>
          </div>
          <div className="nd-grp" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="ov-btn" data-act="open-system-editor" onClick={() => setSysOpen(true)}>
              打开「星系与天体」…
            </button>
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              {sysOv.planets.length + sysOv.moons.length ? `改了 ${sysOv.planets.length + sysOv.moons.length} 项` : '按种子（没改）'}
            </span>
          </div>
          <p className="nd-foot">恒星类型、构型、行星/卫星数量、小行星带、每颗行星的轨道与物理、各天体的地表参数与地形，都在这个树里改；改动只进存档文件。</p>
        </div>
      )}
      {/* 随机生成先只做地图:拓荒、历史在新建界面的第 2 步「打造文明」里定 */}
      {mode === 'image' && (
        <>
          {frontierGroup}
          <div className="nd-sec">
            <div className="nd-lab">
              历史
              <small>年数越多，打开越慢</small>
            </div>
            <div className="nd-grp">
              <label className="nd-pr">
                <span className="nd-n wide">{YEARS_SWITCH}</span>
                <button className={`ai-switch${years ? ' on' : ''}`} role="switch" aria-checked={!!years} data-act="dlg-years" onClick={() => setYears(years ? undefined : YEARS_ON)} />
              </label>
              {years && <ParamRow s={YEARS_SLIDER} value={years} phone={p.phone} onChange={setYears} />}
            </div>
            <p className="nd-foot">{YEARS_NOTE}</p>
          </div>
        </>
      )}
      {(mode === 'random' || picture) && (
        <div className="nd-info">
          <Icon name="info" size={17} />
          <span>{info}</span>
        </div>
      )}
    </>
  );
  // 朋友分享的预设(第 2 步):一条浅蓝说明 +「存进我的预设…」(存过以后换成一句"已存好")
  const sharedBar = p.shared && step === 2 && (
    <div className="nd-shared" data-testid="shared-preset">
      <Icon name="info" size={17} />
      <span className="nd-shared-tx">
        {p.shared.gallery ? `作品墙上${p.shared.gallery.by ? `${p.shared.gallery.by}的` : '的'}「${p.shared.name}」` : `朋友分享的预设「${p.shared.name}」`}
        {p.phone ? <br /> : '，'}参数已经照它填好
      </span>
      {kept ? (
        <span className="nd-shared-done">已存好</span>
      ) : (
        <button className="nd-shared-btn" data-act="shared-preset-keep" onClick={() => setKeepOpen(true)}>
          存进我的预设…
        </button>
      )}
    </div>
  );
  const keepDlg =
    keepOpen &&
    p.shared &&
    createPortal(
      <SavePreset
        params={{ ...p.shared.params, seed: p.shared.seed ?? params.seed }}
        endYear={p.shared.endYear}
        initial={{ name: p.shared.name, withSeed: p.shared.seed !== undefined, rules: p.shared.rules }}
        onSaved={() => setKept(true)}
        onClose={() => setKeepOpen(false)}
      />,
      document.body,
    );
  const rulesNote = rules?.preset && (
    <span className="nd-rl" data-testid="preset-rules-note">
      <Icon name="sliders" size={15} />
      <span>带着规则「{(rules.r.id && ruleNames.get(rules.r.id)) || rules.r.name}」，打造文明时还能换</span>
    </span>
  );
  const presetRow = (
    <div className="ps-row nd-preset">
      <span className="ps-l">预设</span>
      <PresetPicker params={params} endYear={years} rules={rules?.r} onPick={applyPreset} phone={p.phone} saveLink={!p.phone} after={p.phone ? undefined : rulesNote} />
    </div>
  );

  const startBtn = p.wait ? (
    <button className="nd-btn b1 wait" data-act="dlg-start" aria-disabled="true">
      <i className="spin nd-spin" aria-hidden="true" />
      准备中
    </button>
  ) : (
    <button className="nd-btn b1" data-act={step === 1 ? 'dlg-next' : 'dlg-start'} disabled={step === 2 && !canStart} autoFocus onClick={() => (step === 1 ? next() : start())}>
      {step === 1 ? '下一步' : '开始'}
    </button>
  );
  /** 等地图程序时按钮旁边那一句 */
  const waitSay = p.wait && (
    <span className="nd-wait">
      {p.wait.pct === null ? '地图程序还在下载，下好就自动开始' : `地图程序还在下载（${p.wait.pct}%），下好就自动开始`}
    </span>
  );
  const file = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        void choose(f);
      }}
    />
  );


  const sysDlg = sysOpen
    ? createPortal(
        <Suspense fallback={null}>
          <LazySystemEditor
            params={params}
            overrides={sysOv}
            onChange={setSysOv}
            onParams={(patch) => setParams((x) => ({ ...x, ...patch }))}
            onClose={() => {
              setSysOpen(false);
              // 星系流程:树形页「完成」= 直接开始生成(不再回第 2 步)
              if (astroOn) start();
            }}
          />
        </Suspense>,
        document.body,
      )
    : null;

  return (
    <div className="nd-scrim" onPointerDown={stop} onClick={p.onCancel} onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop} onWheel={stop}>
      {p.phone ? (
        <div ref={sheetRef} className="nd-psheet" role="dialog" aria-modal="true" aria-label={title} data-step={step} data-mode={mode} onClick={stop}>
          <div className="nd-pnav">
            {step === 1 ? (
              <button className="nd-pl" data-act="dlg-cancel" onClick={p.onCancel}>
                取消
              </button>
            ) : (
              <button className="nd-pl" data-act="dlg-back" disabled={waiting} onClick={() => setStep(1)}>
                <Icon name="back" size={18} />
                上一步
              </button>
            )}
            <b>{title}</b>
            {step === 1 ? (
              <span className="nd-pr-r">1 / 2</span>
            ) : (
              <button className="nd-pl r" data-act="dlg-cancel" onClick={p.onCancel}>
                取消
              </button>
            )}
          </div>
          {sharedBar}
          {step === 2 && presetRow}
          {step === 2 && rulesNote && <div className="nd-rl-row">{rulesNote}</div>}
          <div className="nd-pbody">
            {step === 1 && <p className="nd-sub">{sub}</p>}
            {step === 1 ? (
              <>
                {cards}
                <div className="nd-syspick" data-act="sys-pick" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 13, flexWrap: 'wrap' }}>
                  <span style={{ opacity: 0.7 }}>生成星球系</span>
                  <button className="ov-btn" data-act="sys-on" onClick={() => { setAstroOn(true); setParams((q) => ({ ...q, astro: 1 })); }} style={astroOn ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>
                    开（星系与天体）
                  </button>
                  <button className="ov-btn" data-act="sys-off" onClick={() => { setAstroOn(false); setParams((q) => ({ ...q, astro: 0 })); }} style={!astroOn ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>
                    关（原版流程）
                  </button>
                  <span style={{ opacity: 0.55, fontSize: 12 }}>开 → 下一步直接进「星系与天体」；关 → 原版参数流程</span>
                </div>
              </>
            ) : (
              paramsBody
            )}
          </div>
          <div className="nd-pfoot">
            {waitSay}
            {startBtn}
          </div>
          {file}
          {keepDlg}
          {sysDlg}
        </div>
      ) : (
        <div
          ref={sheetRef}
          className={`nd-sheet${step === 2 ? ' tall' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="nd-title"
          data-step={step}
          data-mode={mode}
          onClick={stop}
        >
          <div className="nd-hd">
            <h2 id="nd-title">{title}</h2>
            <span className="nd-step">第 {step} 步，共 2 步</span>
          </div>
          {sharedBar || <p className="nd-sub">{sub}</p>}
          {step === 1 ? (
            <>
              {cards}
              <div className="nd-syspick" data-act="sys-pick" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ opacity: 0.7 }}>生成星球系</span>
                <button className="ov-btn" data-act="sys-on" onClick={() => { setAstroOn(true); setParams((q) => ({ ...q, astro: 1 })); }} style={astroOn ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>
                  开（星系与天体）
                </button>
                <button className="ov-btn" data-act="sys-off" onClick={() => { setAstroOn(false); setParams((q) => ({ ...q, astro: 0 })); }} style={!astroOn ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}>
                  关（原版流程）
                </button>
                <span style={{ opacity: 0.55, fontSize: 12 }}>开 → 下一步直接进「星系与天体」；关 → 原版参数流程</span>
              </div>
            </>
          ) : (
            <>
              {presetRow}
              {/* 预设一行和底下的按钮不动,中间的参数滚 */}
              <div className="nd-scroll">{paramsBody}</div>
            </>
          )}
          <div className="nd-ft">
            <button className="nd-btn b2" data-act="dlg-cancel" onClick={p.onCancel}>
              取消
            </button>
            {waitSay || <span className="nd-sp" />}
            {step === 2 && (
              <button className="nd-btn b2" data-act="dlg-back" disabled={waiting} onClick={() => setStep(1)}>
                上一步
              </button>
            )}
            {startBtn}
          </div>
          {file}
          {keepDlg}
          {sysDlg}
        </div>
      )}
    </div>
  );
}
