/**
 * 世界概览浮层(WorldOverview.tsx)开没开、在哪一页。别处要打开某一页直接调:
 *
 *   openOverview()                               打开(停在上次那一页)
 *   openOverview('chronicle', { polity: 3 })     打开编年史,只看 3 号国家的事
 *   openOverview('outline')                      打开"大纲"(OutlinePage.tsx)
 *   openOverview('interventions')                打开"我的干预"
 *   openOverview('cultures')                     打开"民族"页(侧栏「民族」的"全部 N 族")
 *   openPeople({ list: 'rulers', polity: 3 })    打开人物页,看 3 号国家的历代君主(usePeople() 读人物页的筛选)
 *   openLineage(3, { dynasty: 4, focus: 120 })   打开人物页,看 3 号国家的世系图:第 4 朝,圈出 120 号人物
 *   closeOverview()                              收起(编年史的"只看这一国"一起清掉);从概览里点进别处(点一国、一个人、一件事……)用它
 *   dismissOverview()                            用的人直接关掉(×、Esc、点外面):打开时是概览停下的播放,照原样接着放
 *   useOverview() / getOverview()                { open, tab }
 *   useOverviewHold() / getOverviewHold()        时间轴是不是打开概览时停下的(概览顶上标「已暂停,关掉接着放」)
 *
 * 打开时时间轴在放(连"回放世界形成"接着放文明的那一段):先停下,国家表、民族表不再跟着年份换顺序,也不会点到刚挪上来的那一国;
 * 记下停在哪一年、是不是那一段。直接关掉时从这一年照原来的快慢接着放;从概览里点进别处以后停着。
 * 开着时时间被别处动过(重推完从生效年份接着放、跳到某一年……),关掉就不再照记下的接着放。
 *
 * 编年史以前是单独的窗口(civView.ts 的 setChronicle({ open })),现在是概览里的一页:
 * 两边保持一致 —— setChronicle({ open: true }) 等于打开概览的编年史页,setChronicle({ open: false }) 在编年史页时收起概览;
 * 网址 chron=1 / chron=all 打开网页时就停在编年史页。
 */
import { getChronicle, getCivTime, pausePlayback, setChronicle, setCivTime, subscribeChronicle, subscribeCivTime, type ChronicleView, type CivTime } from './civView';
import { createListeners, createStore } from './createStore';

export type OverviewTab = 'countries' | 'cultures' | 'chronicle' | 'people' | 'records' | 'marks' | 'outline' | 'interventions' | 'system' | 'sky' | 'tech' | 'genesis';

export const OVERVIEW_TABS: readonly OverviewTab[] = ['countries', 'cultures', 'chronicle', 'people', 'records', 'marks', 'outline', 'interventions', 'system', 'sky', 'tech', 'genesis'];

export interface OverviewState {
  open: boolean;
  tab: OverviewTab;
}

export interface OverviewOpts {
  /** 编年史只看这一国(null = 全部国家;不给 = 不变) */
  polity?: number | null;
  /** 编年史只看大事(不给 = 不变) */
  major?: boolean;
  /** 编年史打开后滚到这一年(不给 = 滚到时间轴当前那年) */
  at?: number;
}

const chron0 = getChronicle();
let state: OverviewState = { open: chron0.open, tab: chron0.open ? 'chronicle' : 'countries' };
const subs = createListeners();

/** 打开概览时停下的播放:停在哪一年(显示的那一年)、快慢、是不是"回放世界形成"接着放文明的那一段;null = 不是概览停的 */
let hold: { year: number; speed: CivTime['speed']; story: boolean } | null = null;

function holdPlayback() {
  const t = getCivTime();
  if (!t.playing || t.year === null) return;
  pausePlayback();
  const p = getCivTime();
  if (p.playing || p.year === null) return;
  hold = { year: p.year, speed: p.speed, story: t.story };
}

// 开着时时间被别处动过(又放起来了、跳了年份、换了快慢):不再是概览停的,关掉也不接着放。
// 停下那一下往后挪不到一年不算:逐年推演显示的是取整到一步的年份,停下后再把地图换成播放头真正停的那一刻(Stepwise.tsx),从那一刻接着放
subscribeCivTime((t) => {
  if (!hold || (!t.playing && !t.scrubbing && t.speed === hold.speed && t.year !== null && t.year >= hold.year && t.year < hold.year + 1)) return;
  hold = null;
  subs.emit();
});

function set(next: OverviewState, resume = false) {
  if (next.open === state.open && next.tab === state.tab) return;
  const closing = state.open && !next.open;
  if (!state.open && next.open) holdPlayback();
  const back = closing ? hold : null;
  if (closing) hold = null;
  state = next;
  subs.emit();
  // 编年史"开着" = 概览开在编年史页(同步到 civView 的编年史状态:App 根元素的 chron-open 读它);
  // 收起概览时"只看这一国"一起清掉:时间轴上的事件点跟着编年史的筛选,收起后回到全部国家。两样一次改(分两次改,下面的订阅会在中间把概览又打开)
  const shown = state.open && state.tab === 'chronicle';
  const c = getChronicle();
  const patch: Partial<ChronicleView> = {};
  if (c.open !== shown) patch.open = shown;
  if (closing && c.polity !== null) patch.polity = null;
  if (patch.open !== undefined || patch.polity !== undefined) setChronicle(patch);
  // 直接关掉:照停下前的样子接着放(快慢没动过,还是原来的 1× / 4×)
  if (back && resume) setCivTime({ playing: true, story: back.story, scrubbing: false });
}

// 别处还按老办法开关编年史(setChronicle({ open })):换成开关概览的编年史页
subscribeChronicle(() => {
  const c = getChronicle();
  const shown = state.open && state.tab === 'chronicle';
  if (c.open && !shown) set({ open: true, tab: 'chronicle' });
  else if (!c.open && shown) set({ ...state, open: false });
});

export function getOverview(): OverviewState {
  return state;
}

export function useOverview(): OverviewState {
  return subs.use(getOverview);
}

/** 打开概览(不给 tab = 停在上次那一页);opts 给编年史页设筛选 */
export function openOverview(tab?: OverviewTab, opts: OverviewOpts = {}) {
  const patch: Partial<ChronicleView> = {};
  if (opts.polity !== undefined) patch.polity = opts.polity;
  if (opts.major !== undefined) patch.major = opts.major;
  if (opts.at !== undefined) patch.at = opts.at;
  if (Object.keys(patch).length) setChronicle(patch);
  set({ open: true, tab: tab ?? state.tab });
}

/** 收起;打开时停下的播放不接着放(从概览里点进一国、一个人、一件事以后停着,和在地图上点开详情一样) */
export function closeOverview() {
  set({ ...state, open: false });
}

/** 用的人直接关掉(右上角 ×、Esc、点浮层外面;手机大纲页的「世界」):打开时是概览停下的播放,从停下那一年照原来的快慢接着放 */
export function dismissOverview() {
  set({ ...state, open: false }, true);
}

/** 时间轴是不是打开概览时停下的(关掉会接着放) */
export function getOverviewHold(): boolean {
  return hold !== null;
}

export function useOverviewHold(): boolean {
  return subs.use(getOverviewHold);
}

/** 换页(开着时) */
export function setOverviewTab(tab: OverviewTab) {
  set({ ...state, tab });
}

// ---- 人物页的筛选:我的(作者的人物)/ 名人 / 君主 / 将领,只看哪一国 ----

export type PeopleList = 'mine' | 'famous' | 'rulers' | 'generals' | 'ministers';

export interface PeopleView {
  /** 看哪一档;null = 还没挑过:有作者自己的人物先看「我的」,没有先看「名人」 */
  list: PeopleList | null;
  /** 只看这一国(null = 全部国家) */
  polity: number | null;
  /** 君主看世系图(只看一国、不是共和国时才有;不然照列表看) */
  tree: boolean;
  /** 世系图看哪一朝(Polity.dynasties 的下标;null = 时间轴那一年的那一朝) */
  dynasty: number | null;
  /** 世系图里圈出这个人(人物编号;从人物卡片点「世系图」进来);null = 不圈 */
  focus: number | null;
}

const people = createStore<PeopleView>({ list: null, polity: null, tree: false, dynasty: null, focus: null });

export function getPeople(): PeopleView {
  return people.get();
}

export function setPeople(patch: Partial<PeopleView>) {
  const prev = people.get();
  const next = { ...prev, ...patch };
  // 世系图只在「君主」、只看一国时有:换成全部国家或别的档,回到列表;换了国家,看哪一朝、圈出谁作废
  if (next.polity === null || next.list !== 'rulers') next.tree = false;
  if (next.polity !== prev.polity) {
    if (patch.dynasty === undefined) next.dynasty = null;
    if (patch.focus === undefined) next.focus = null;
  }
  people.set(next);
}

export function usePeople(): PeopleView {
  return people.use();
}

/** 打开概览的人物页(国家卡片的"全部 N 位" = 这国的历代君主,照列表看) */
export function openPeople(patch: Partial<PeopleView> = {}) {
  setPeople({ tree: false, dynasty: null, focus: null, ...patch });
  set({ open: true, tab: 'people' });
}

/** 打开一国的世系图(人物卡片、国家卡片的「世系图」);不给朝代 = 时间轴那一年的那一朝 */
export function openLineage(polity: number, opts: { dynasty?: number; focus?: number } = {}) {
  openPeople({ list: 'rulers', polity, tree: true, dynasty: opts.dynasty ?? null, focus: opts.focus ?? null });
}
