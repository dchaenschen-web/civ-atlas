/**
 * 世界概览(点世界名、侧栏里的"全部 N 国""编年史""世界参数"打开):全屏浮层。
 *
 *   头部  世界名;一行"种子 7，当前 2679 年，未干预"(设了纪年:"当前公元前 850 年");一行汇总(现存几国、历来几国、民族、城镇、州,跟着时间轴的当前年份);
 *         关闭。存档、导出、AI 设置、写成史书不放这里:宽屏在侧栏和地图右上,手机在底部世界卡片的按钮和「···」里
 *   页签  国家(WorldOverviewCountries.tsx)/ 民族(WorldOverviewCultures.tsx)/ 编年史(Chronicle.tsx)/ 人物(WorldOverviewPeople.tsx:名人、君主、将领)/
 *         之最(WorldOverviewRecords.tsx:在位最久、疆域最大、打得最久……15 条纪录,跟着时间轴)/
 *         标记(WorldOverviewMarks.tsx:作者在地图上放的标记)/
 *         大纲(OutlinePage.tsx:作者先写下的故事,照大纲推演;手机上不要概览的头和页签,整页是大纲)/
 *         我的干预(WorldOverviewInterventions.tsx)/
 *         世界设定(WorldOverviewGenesis.tsx:创建时定下的种子、参数、地形,只能看;以它为底稿新建、回放世界形成)
 *   世界名旁边"改名"(点了就地变成输入框)
 *   底部  一行小字:源代码、隐私政策、用户协议(新标签页打开;网址在 links.ts)
 * 关闭:右上角的关闭 / Esc / 点浮层外面。窄屏铺满全屏。开没开、在哪一页见 overviewStore.ts(别处用 openOverview(tab, opts) 打开某一页)。
 * 打开时时间轴在放:先停下,头部年份那行末尾一枚「已暂停,关掉接着放」(窄屏单起一行,在汇总那行下面);这三种方式关掉就接着放,
 * 从概览里点进别处(点一国、一个人、一件事)以后停着(overviewStore.ts 的 dismissOverview / closeOverview)。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { World, WorldParams } from '../gen/world';
import type { Raster } from '../gen/raster';
import type { Civ } from '../gen/civ/types';
import { polityAlive, populationAt } from '../gen/readers/openQuery';
import { Chronicle } from './Chronicle';
import { PeoplePage } from './WorldOverviewPeople';
import { RecordsPage } from './WorldOverviewRecords';
import { recordBook } from '../gen/civ/story/records';
import { MarksPage } from './WorldOverviewMarks';
import { CountriesPage } from './WorldOverviewCountries';
import { CulturesPage } from './WorldOverviewCultures';
import { InterventionsPage } from './WorldOverviewInterventions';
import { OutlinePage, OutlinePhone, useOutlinePickReturn } from './OutlinePage';
import { closeEdit, getOutlineUi } from './outlineStore';
import { interventionRows } from './outlineInfo';
import { SettingsPage } from './WorldOverviewGenesis';
import { SystemPage } from './SystemPage';
import { SkyGeoPage } from './SkyGeoPage';
import { TechPage } from './TechPage';
import { getCivTime, subscribeCivTime } from './civView';
import { commitEdits, getEdits, useEdits, useEra } from './editsStore';
import { cratersToOps, type ImpactCrater } from '../gen/impacts';
import { TERRAIN_MAX_OPS } from '../gen/terrainOps';
import { spaced, yearAt } from '../gen/era';
import { cleanCivSeed } from '../gen/edits';
import { currentWorld, renameWorld, useSavesVersion } from './saveStore';
import { closeOverview, dismissOverview, getOverview, setOverviewTab, useOverview, useOverviewHold, type OverviewTab } from './overviewStore';
import { PRIVACY_URL, SOURCE_URL, TERMS_URL } from './links';
import { ContactLink } from './ContactLink';
import { useNarrow } from './device';
import { Icon } from './icons';
import { VersionText } from './VersionNews';
import { BeianLinks } from './BeianLinks';
import { TitleInput } from './worldParts';
import './overview.css';

export interface WorldOverviewProps {
  data: { world: World; raster: Raster } | null;
  /** 第 0 年的星球(有地形大事时是大事以前的那颗;世界设定里文明起源落在哪一州按它看) */
  baseWorld: World | null;
  civ: Civ | null;
  params: WorldParams;
  /** 世界还在生成 */
  generating: boolean;
  /** 正在重推历史(干预页先不判"未生效") */
  resimBusy: boolean;
  /** 回放世界形成:能不能点、正在放 */
  replay: { on: boolean; ready: boolean };
  onReplay: () => void;
  /** 以这个世界为底稿新建(世界设定页) */
  onDraftFrom: () => void;
}

const TABS: { id: OverviewTab; name: string }[] = [
  { id: 'countries', name: '国家' },
  { id: 'cultures', name: '民族' },
  { id: 'chronicle', name: '编年史' },
  { id: 'people', name: '人物' },
  { id: 'records', name: '之最' },
  { id: 'marks', name: '标记' },
  { id: 'outline', name: '大纲' },
  { id: 'interventions', name: '我的干预' },
  { id: 'system', name: '星球系' },
  { id: 'sky', name: '天象与地质' },
  { id: 'tech', name: '技术路线' },
  { id: 'genesis', name: '世界设定' },
];

const subscribeYear = (f: () => void) => subscribeCivTime(() => f());

/** 时间轴当前年份(取整;回放时一年只重新渲染一次) */
function useYear(civ: Civ | null): number {
  const end = civ?.endYear ?? 0;
  return useSyncExternalStore(subscribeYear, () => Math.floor(Math.min(end, Math.max(0, getCivTime().year ?? end))));
}

export function WorldOverview(p: WorldOverviewProps) {
  const { open, tab } = useOverview();
  const edits = useEdits();
  const narrow = useNarrow();
  // 大纲在地图上点完、取消:回到「大纲」页接着编
  useOutlinePickReturn();
  // 概览开着、手上空闲时先把世界之最整理好(扫一遍历史要几十毫秒),翻到「之最」页时只查表
  const civ = p.civ;
  useEffect(() => {
    if (!open || !civ?.viable) return;
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const prep = () => void recordBook(civ);
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(prep, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(h);
    }
    const h = setTimeout(prep, 400);
    return () => clearTimeout(h);
  }, [open, civ]);

  // Esc 收起(先于页面上别的 Esc:不顺手取消地图上的选中)。输入框里打字时不管;
  // 存档 / 导出菜单、AI 设置、盖在上面的调规则的大卡(世界设定里点「规则」)开着时先让它们收
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.ov .save-menu, .ov .export-menu, .ov .era-pick, .ov .pm-menu, .ai-dialog-bg, .rs-root')) return;
      e.stopPropagation();
      // 大纲正在编一条:先收起那一栏
      if (getOverview().tab === 'outline' && getOutlineUi().edit) closeEdit();
      else dismissOverview();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  // 干预和地形大事一起数(同一页列在一起;照大纲硬改的一条情节算一处)
  const nIv = interventionRows(edits.interventions) + (edits.upheavals?.length ?? 0);
  const nPlots = edits.outline?.plots.length ?? 0;
  if (open && narrow && tab === 'outline')
    return (
      <div className="ov-root">
        <div className="ov-scrim" onClick={dismissOverview} />
        <OutlinePhone civ={p.civ} />
      </div>
    );
  return (
    <div className="ov-root" hidden={!open}>
      <div className="ov-scrim" onClick={dismissOverview} />
      <div className="ov" role="dialog" aria-modal="true" aria-label="世界概览" onPointerDown={stop} onDoubleClick={stop} onWheel={stop}>
        <header className="ov-head">
          {open ? <OverviewSummary civ={p.civ} seed={p.data ? p.data.world.params.seed : null} /> : <span className="ov-summary" />}
          <div className="ov-actions">
            <button className="ov-x" data-act="ov-close" onClick={dismissOverview} title="关闭(Esc)" aria-label="关闭">
              <Icon name="close" size={14} />
            </button>
          </div>
        </header>
        <nav className="ov-tabs" role="tablist" aria-label="概览">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`ov-tab${tab === t.id ? ' on' : ''}`} data-tab={t.id} onClick={() => setOverviewTab(t.id)}>
              {t.name}
              {t.id === 'interventions' && ` ${nIv}`}
              {t.id === 'outline' && ` ${nPlots}`}
            </button>
          ))}
        </nav>
        <div className={`ov-body tab-${tab}`}>{open && <OverviewPage {...p} tab={tab} />}</div>
        <AboutLinks />
      </div>
    </div>
  );
}

const ABOUT = [
  { id: 'source', name: '源代码', href: SOURCE_URL },
  { id: 'privacy', name: '隐私政策', href: PRIVACY_URL },
  { id: 'terms', name: '用户协议', href: TERMS_URL },
];

/**
 * 底部一行小字:源代码、隐私政策、用户协议(新标签页打开)、联系我们(配了交流群才有;手机上在「更多」菜单里),
 * 正中是备案号(有号码时;手机上那排已经占满,在「更多」菜单里),最右边是版本号
 */
function AboutLinks() {
  const narrow = useNarrow();
  return (
    <footer className="ov-about">
      {ABOUT.map((l) => (
        <a key={l.id} href={l.href} target="_blank" rel="noreferrer" data-link={l.id}>
          {l.name}
        </a>
      ))}
      {!narrow && <ContactLink />}
      {!narrow && <BeianLinks className="ov-beian" />}
      <VersionText className="ov-ver" />
    </footer>
  );
}

/** 国家页、民族页跟着时间轴的当前年份(一年重新渲染一次);其余几页不用 */
function Countries({ civ }: { civ: Civ | null }) {
  const year = useYear(civ);
  return <CountriesPage civ={civ} year={year} />;
}

function Cultures({ civ }: { civ: Civ | null }) {
  const year = useYear(civ);
  return <CulturesPage civ={civ} year={year} />;
}

/** 把陨击结算的坑写成地形修改:和地形编辑同一种改动,存进存档、重新生成世界(推演跟着重来) */
function applyCraters(craters: ImpactCrater[]): void {
  const ops = cratersToOps(craters);
  if (!ops.length) return;
  const cur = getEdits();
  const terrain = [...cur.terrain, ...ops].slice(-TERRAIN_MAX_OPS);
  commitEdits({ ...cur, terrain });
}

function OverviewPage(p: WorldOverviewProps & { tab: OverviewTab }) {
  switch (p.tab) {
    case 'countries':
      return <Countries civ={p.civ} />;
    case 'cultures':
      return <Cultures civ={p.civ} />;
    case 'chronicle':
      return <Chronicle civ={p.civ} world={p.data?.world ?? p.baseWorld ?? null} />;
    case 'people':
      return <PeoplePage civ={p.civ} data={p.data} />;
    case 'records':
      return <RecordsPage civ={p.civ} />;
    case 'marks':
      return <MarksPage civ={p.civ} data={p.data} />;
    case 'outline':
      return <OutlinePage civ={p.civ} />;
    case 'interventions':
      return <InterventionsPage civ={p.civ} world={p.data?.world ?? null} busy={p.resimBusy} />;
    case 'sky':
      return <SkyGeoPage world={p.data?.world ?? p.baseWorld ?? null} civ={p.civ} onApplyCraters={applyCraters} />;
    case 'system':
      return <SystemPage world={p.data?.world ?? p.baseWorld ?? null} civ={p.civ} onApplyCraters={applyCraters} />;
    case 'tech':
      return <TechPage world={p.data?.world ?? p.baseWorld ?? null} />;
    case 'genesis':
      return (
        <SettingsPage
          params={p.params}
          world={p.baseWorld ?? p.data?.world ?? null}
          civ={p.civ}
          generating={p.generating || !p.data}
          replay={p.replay}
          onReplay={() => {
            closeOverview();
            p.onReplay();
          }}
          onDraftFrom={() => {
            closeOverview();
            p.onDraftFrom();
          }}
        />
      );
  }
}

/**
 * 头部左边:世界名、种子 · 当前年份 · 干预数(连地形大事);汇总数字(跟着时间轴当前年份)。
 * 时间轴是打开概览时停下的:年份那行末尾一枚「已暂停,关掉接着放」;窄屏那行放不下,单起一行放在汇总那行下面
 */
function OverviewSummary({ civ, seed }: { civ: Civ | null; seed: number | null }) {
  useSavesVersion();
  const edits = useEdits();
  const era = useEra();
  const year = useYear(civ);
  const held = useOverviewHold();
  const narrow = useNarrow();
  const cur = currentWorld();
  const title = cur?.title;
  const [naming, setNaming] = useState(false);
  const n = interventionRows(edits.interventions) + (edits.upheavals?.length ?? 0);
  const stats = useMemo(() => {
    if (!civ || !civ.viable) return null;
    let alive = 0;
    let founded = 0;
    for (const p of civ.polities) {
      if (p.founded > year) continue;
      founded++;
      if (polityAlive(p, year)) alive++;
    }
    let cultures = 0;
    for (const cu of civ.cultures) if (cu.born <= year && (cu.ended === undefined || cu.ended > year)) cultures++;
    let towns = 0;
    for (const s of civ.settlements) if (populationAt(s, year) > 0) towns++;
    return { alive, founded, cultures, towns, regions: civ.regions.count };
  }, [civ, year]);
  const civSeed = cleanCivSeed(edits.civSeed);
  const sub = [seed !== null ? `种子 ${seed}${civSeed !== undefined && civSeed !== seed ? `，文明种子 ${civSeed}` : ''}` : '正在生成', civ ? `当前${spaced(yearAt(year, era))}` : null, n ? `干预了 ${n} 处` : '未干预'].filter(Boolean).join('，');
  return (
    <div className="ov-summary">
      <div className="ov-title">
        {naming && cur ? (
          <TitleInput
            className="ov-name-input"
            initial={title ?? ''}
            onDone={(t) => {
              setNaming(false);
              if (t !== null) renameWorld(cur.id, t);
            }}
          />
        ) : (
          <span className="ov-name-row">
            <span className="ov-name">{title || '未命名世界'}</span>
            {cur && (
              <button className="ov-rename" data-act="ov-rename" onClick={() => setNaming(true)}>
                <Icon name="rename" size={14} />
                改名
              </button>
            )}
          </span>
        )}
        <span className="ov-subline">
          {sub}
          {held && !narrow && <PausedChip />}
        </span>
        {stats && (
          <span className="ov-subline ov-stats">
            现存 {stats.alive} 国（历来 {stats.founded} 国），{stats.cultures} 个民族，{stats.towns} 座城镇，{stats.regions} 州
          </span>
        )}
        {held && narrow && (
          <span className="ov-paused-row">
            <PausedChip />
          </span>
        )}
      </div>
    </div>
  );
}

/** 「已暂停,关掉接着放」:打开概览时停下了时间轴(关掉接着放) */
function PausedChip() {
  return (
    <span className="ov-paused" data-testid="ov-paused">
      <svg viewBox="0 0 10 10" aria-hidden="true">
        <rect x="1.5" y="1" width="2.4" height="8" rx=".6" />
        <rect x="6.1" y="1" width="2.4" height="8" rx=".6" />
      </svg>
      已暂停，关掉接着放
    </span>
  );
}
