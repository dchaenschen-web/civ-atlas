/**
 * 存档的浏览器存储:"我的世界"。
 *
 * - 一个世界一个编号(newWorldId,网址里的 w=):同一个种子 + 参数可以存好几个,各走各的历史。
 *   存档本身(gen/savefile.ts 的 SaveFile,和"存成文件"同一个格式)、缩略图、几项只在本地用的信息(还在新建、最近打开、现存几国)
 *   各存一个键;以前按"种子 + 参数"当编号存的,第一次读的时候原地换成新编号(换不了就照旧用老编号,照样能打开);
 *   改版前的网址(只带种子、参数)刷新还回到它(legacyWorld)。
 * - 世界分三种(attachWorld 的 kind):
 *     draft    新建世界这一步(种子、参数、地形还能改):作者动过(起名、调参数、改地形)才存,在"我的世界"里标"没建完"
 *     created  建好的世界(种子、参数、地形锁住):一直存着,没有修改也在列表里
 *     visit    打开别人的分享链接、带种子的网址:先不存;改了名字、历史(或起了名)才存进"我的世界",从此算建好的
 * - 自动存:App 生成完一个世界就 attachWorld;之后修改(editsStore)一变就写一次。换世界前 App 先 detachWorld,
 *   清空旧世界的修改就不会被当成这个世界的。
 * - 缩略图(480×240 JPEG dataURL)单独存一个键,第一次存这个世界时由 App 给的 thumbMaker 截一张(截不到就过一会儿再试);
 *   新建中的世界地形变了、刚创建完,App 调 refreshThumb 重截。另有一张"地图缩略图"(实景、第 0 年的地形、不带国界和地名,
 *   「我的世界」的「地图」页签用;mapThumbMaker 给),和缩略图一起截;只在这台设备上,不同步(没有的就用缩略图)。
 *   编辑地形时(App 调 setThumbEditing)连着涂不截:地形停了 THUMB_EDIT_QUIET 毫秒没再变才截(每截一张要先画一整张底图,
 *   连涂时跟着每一笔画是内存冲高的一大块);收起编辑地形时不再等停笔;换世界、全部存成文件、页面藏起来 / 关掉之前
 *   (flushThumb)当场截,存下的不会是旧地形的。
 * - 只存了地图、还没有文明的(新建时点「保存地图」,saveCurrentAsMap):本地信息记 map,存档里只有参数和地形修改。
 *   它不当世界打开,只在「我的世界」的「地图」页签里,点「打造文明」在它上面新建(见 mapGroups.ts)。
 * - 存储有上限:最多存 MAX_WORLDS 个世界;存满了(个数到上限、或浏览器配额满了)这一次就存不下,**绝不自动删别的世界**:
 *   顶部提示"没能自动存档",带"存成文件"(同一次满只提示一回,之后写成功了再重新算);腾出地方(自己删掉几个)后下一次改动就存下了。
 * - 浏览器不让用 localStorage(隐私模式、禁用了存储)时退回"只在内存里":这次打开的页面里照样能用,
 *   刷新就没了;第一次存的时候顶部提示一句(带"存成文件",10 秒后自己收起),存档菜单里一直写着。所有读写都 try/catch,从不往外抛错。
 * - 投影、中央经线、经纬网(ui/projection.ts、mapWrap.ts)跟着世界存:存档时按当时的设置写进 view;
 *   已经存着的世界换了投影 / 中心 / 经纬网,App 调 viewChanged 重写一次(没记经纬网的旧存档,打开时不算换了)。
 * - 删掉一个世界,AI 给它写的东西(ai/library.ts,按世界编号存)一起删。
 * - 旧版本生成器存的世界,第一次按新版重存时,把浏览器里原来那份原样另存一份(keepOriginal;同一个世界只留最早那份,
 *   以后不覆盖):重存会把存档里的生成器版本换成新的,留着这份才知道它原来是哪一版、长什么样。删除、撤销、复制跟着世界走;
 *   存储满了留不下就不留,不为它删别的世界,也不挡着新的存进去。打开旧版本的分享链接、旧网址(还没存着)以后改了才存进来的,
 *   第一次存时把打开的那一份同样留着。「看原样」(ui/oldSite.ts)读的就是这一份(originalOf、currentOriginal)。
 * - 登录了网站账号的,世界还会同步进账号(account/sync.ts):这里给它原样读写一个世界(rawWorld / putSyncedWorld),
 * - 删世界时记一笔(trashMarks:编号 → 什么时候删的),撤销时划掉。世界的内容(ui/worldStore.ts、ui/resultStore.ts)只有在这份记录里才会被清:
 *   清内容不看"我的世界"的列表,因为列表没了也可能是浏览器清了 localStorage。这份记录和存档存在一处,要么一起在、要么一起没,没了就什么都不清。
 */
import type { WorldParams } from '../gen/world';
import { GENERATOR_VERSION, keptMapOf, newHistoryEdits, type NewHistoryOptions, type WorldEdits } from '../gen/edits';
import {
  CHECK_WARNING,
  DEFAULT_VIEW,
  SHARE_BROKEN,
  TITLE_MAX,
  cleanOrigin,
  cleanTitle,
  editCount,
  makeSave,
  parseSave,
  sameView,
  worldKey,
  type SaveFile,
  type SaveOrigin,
  type SaveView,
} from '../gen/savefile';
import { currentSystem } from '../gen/systemState';
import type { RosterMarks } from '../worldRoster';
import { getEdits, subscribeEdits } from './editsStore';
import { createListeners } from './createStore';
import type { DraftBase } from './stageStore';
import { getContourKind, getGraticuleLines, getProjection } from './projectionStore';
import { getMapCenter } from './mapWrap';
import { clearToast, showToast, type ToastAction } from './toastStore';

/** 当前的投影、中央经线、经纬网和等值线(存档时写进去) */
export function currentView(): SaveView {
  return { projection: getProjection(), center: Math.round(getMapCenter() * 100) / 100, graticule: getGraticuleLines(), contours: getContourKind() ?? '' };
}

const PREFIX = 'wenming-ditu:world:';
const THUMB = 'wenming-ditu:thumb:';
const META = 'wenming-ditu:meta:';
/** 地图缩略图(见文件头) */
const MAPTHUMB = 'wenming-ditu:mapthumb:';
/** AI 写的东西(ai/library.ts)按世界编号存的键:正文现在在世界仓库里,这里是搬走之前的旧副本和仓库用不了时的退路 */
const NOTES = 'civ-atlas:ai-notes:';
/** 以前按"种子 + 参数"当编号存的世界换成了哪个新编号(旧网址只带种子、参数,刷新还回到它) */
const LEGACY = 'wenming-ditu:legacy:';
/** 旧版本生成器存的世界,第一次按新版重存之前的原样(存档原文;见 keepOriginal) */
const ORIG = 'wenming-ditu:orig:';
/** 用的人删掉的世界(见文件头) */
export const TRASH = 'civ-atlas:trash';
/** 最近一次全清的时间(几个标签页靠它知道仓库被清了;在这之前的内容不再认回来) */
export const VAULT_CLEARED = 'civ-atlas:vault-cleared';
/** 最多存多少个世界(每个几 KB + 缩略图三十来 KB) */
export const MAX_WORLDS = 60;
/** 缩略图的大小("我的世界"里一张卡片宽 480) */
export const THUMB_W = 480;
export const THUMB_H = 240;

// ---------------------------------------------------------------------------
// 键值存储:localStorage,用不了就退回内存

interface KV {
  get(k: string): string | null;
  /** 写不下(配额满了)= false */
  set(k: string, v: string): boolean;
  remove(k: string): void;
  keys(): string[];
}

const mem = new Map<string, string>();
const memKV: KV = {
  get: (k) => mem.get(k) ?? null,
  set: (k, v) => (mem.set(k, v), true),
  remove: (k) => void mem.delete(k),
  keys: () => [...mem.keys()],
};

function isQuota(e: unknown): boolean {
  const x = e as { name?: string; code?: number } | null;
  return !!x && (x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED' || x.code === 22 || x.code === 1014);
}

function openLocal(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    if (!s) return null;
    const probe = 'wenming-ditu:probe';
    try {
      s.setItem(probe, '1');
    } catch (e) {
      // 满了不等于不能用:连这一点都写不下时,里面存的世界还读得出来
      if (isQuota(e)) return s;
      throw e;
    }
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** AI 正文那边(ai/library.ts)接上的两样 */
let notesHooks: { freeRoom: () => boolean; safeElsewhere: (id: string, raw: string) => boolean } = { freeRoom: () => false, safeElsewhere: () => false };
export function setNotesHooks(h: typeof notesHooks) {
  notesHooks = h;
}

let local: Storage | null | undefined;
/** 以前按"种子 + 参数"当编号存的世界换过新编号了(每次打开页面查一次) */
let migrated = false;
/** 浏览器存储能不能用(第一次用到时探测) */
function store(): KV {
  if (local === undefined) local = openLocal();
  const s = local;
  const kv: KV = !s
    ? memKV
    : {
        get: (k) => {
          try {
            return s.getItem(k);
          } catch {
            return mem.get(k) ?? null;
          }
        },
        set: (k, v) => {
          try {
            s.setItem(k, v);
            return true;
          } catch (e) {
            if (isQuota(e)) {
              // 写不下:AI 正文那边有已经搬走、核对过的旧副本的话清掉,再试一次
              if (!notesHooks.freeRoom()) return false;
              try {
                s.setItem(k, v);
                return true;
              } catch {
                return false;
              }
            }
            // 别的错(存储突然不让用了):退回内存
            local = null;
            mem.set(k, v);
            return true;
          }
        },
        remove: (k) => {
          try {
            s.removeItem(k);
          } catch {
            /* 删不掉就算了 */
          }
          mem.delete(k);
        },
        keys: () => {
          try {
            const out: string[] = [];
            for (let i = 0; i < s.length; i++) {
              const k = s.key(i);
              if (k !== null) out.push(k);
            }
            return out;
          } catch {
            return [...mem.keys()];
          }
        },
      };
  if (!migrated) {
    migrated = true;
    migrateLegacy(kv);
  }
  return kv;
}

/** 存档能不能留到下次打开(false = 只在这次打开的页面里) */
export function persistent(): boolean {
  store();
  return !!local;
}

// ---------------------------------------------------------------------------
// 世界编号

const ID_RE = /^w[0-9a-z]{6,24}$/;

/** 一个新的世界编号(w + 时间 + 随机几位,只有小写字母和数字,放进网址不用转义) */
export function newWorldId(): string {
  const kv = store();
  for (;;) {
    let r = '';
    try {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      r = a[0].toString(36);
    } catch {
      r = Math.floor(Math.random() * 2 ** 32).toString(36);
    }
    const id = `w${Date.now().toString(36)}${r.padStart(7, '0').slice(-5)}`;
    if (kv.get(PREFIX + id) === null && kv.get(META + id) === null) return id;
  }
}

/** 像不像一个世界编号(网址里的 w= 先过一遍;老编号是"种子 + 参数"那一串,也认) */
export function isWorldId(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 400 && (ID_RE.test(s) || /^seed=/.test(s));
}

/** 以前按"种子 + 参数"当编号存的世界:换成新编号(连同缩略图、AI 写的东西);写不下就照旧用老编号 */
function migrateLegacy(kv: KV) {
  for (const k of kv.keys()) {
    if (!k.startsWith(PREFIX)) continue;
    const old = k.slice(PREFIX.length);
    if (ID_RE.test(old)) continue;
    const text = kv.get(k);
    if (text === null) continue;
    let id = '';
    for (let i = 0; i < 4 && !id; i++) {
      const c = `w${Date.now().toString(36)}${(Math.floor(Math.random() * 36 ** 5) + i).toString(36).padStart(5, '0').slice(-5)}`;
      if (kv.get(PREFIX + c) === null) id = c;
    }
    if (!id || !kv.set(PREFIX + id, text)) continue;
    const moved = [THUMB, NOTES].every((p) => {
      const v = kv.get(p + old);
      return v === null || kv.set(p + id, v);
    });
    if (!moved) {
      for (const p of [PREFIX, THUMB, NOTES]) kv.remove(p + id);
      continue;
    }
    // 旧版本的原样跟过去;写不下就不带,不挡着换新编号
    const orig = kv.get(ORIG + old);
    if (orig !== null) kv.set(ORIG + id, orig);
    for (const p of [PREFIX, THUMB, NOTES, META, ORIG]) kv.remove(p + old);
    kv.set(LEGACY + old, id);
  }
}

/** 以前按"种子 + 参数"存的那个世界(改版前的网址只带种子、参数,刷新时找回它);没有 = null */
export function legacyWorld(params: WorldParams): StoredWorld | null {
  const kv = store();
  const old = worldKey(params);
  // 没换成新编号的(写不下)照旧用老编号
  const direct = loadWorld(old);
  if (direct) return direct;
  const id = kv.get(LEGACY + old);
  if (id === null) return null;
  const w = ID_RE.test(id) ? loadWorld(id) : null;
  if (w && worldKey(w.save.params) === old) return w;
  kv.remove(LEGACY + old);
  return null;
}

// ---------------------------------------------------------------------------
// 订阅(菜单里的列表、提示)

let version = 0;
const subs = createListeners();
function changed() {
  version++;
  subs.emit();
}
// 别的标签页存了、删了世界(同步取回来的也算):这里跟着刷新"我的世界",云同步也看一眼
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => otherTabChanged(e.key, e.newValue));
}

/** 别的页面里改过正在看的世界,点"载入"重新打开它(App 给) */
let reopenHandler: ((id: string) => void) | null = null;
export function setReopenHandler(f: ((id: string) => void) | null) {
  reopenHandler = f;
}

/** 正在看的世界在别的页面里删了、改了:说一声,这里不再自动存 */
function tellOtherTab(c: Current, why: 'deleted' | 'changed') {
  const id = c.id;
  if (why === 'deleted') {
    showToast({ id: 'other-tab', kind: 'warn', text: '这个世界在别的页面里删掉了', more: ['这里再改不会自动存下来；要留着就存成文件'], action: saveFileAction(), ttl: 0 });
    return;
  }
  const reopen = reopenHandler;
  showToast({
    id: 'other-tab',
    kind: 'warn',
    text: '这个世界在别的页面里改过',
    more: ['这里再改不会自动存下来；载入那边改过的样子'],
    action: reopen
      ? {
          label: '载入',
          act: 'other-tab-reload',
          onClick: () => {
            clearToast('other-tab');
            reopen(id);
          },
        }
      : saveFileAction(),
    ttl: 0,
  });
}

/** 别的标签页改了浏览器存储(storage 事件;单测直接调):key = null 是整个清空 */
export function otherTabChanged(key: string | null, newValue: string | null): void {
  if (key !== null && ![PREFIX, THUMB, MAPTHUMB, META, NOTES, LEGACY].some((p) => key.startsWith(p))) return;
  const c = current;
  // 整个清空:存过的当前世界也没了
  const cleared = key === null && !!c && (c.kind === 'created' || (c.kind === 'draft' && !c.pristine)) && store().get(PREFIX + c.id) === null;
  if (c && (key === PREFIX + c.id || cleared)) {
    const now = cleared ? null : newValue;
    if (now !== null && now === c.wrote) {
      // 那边撤销了删除(放回来的就是这里存的那份):接着自动存(只读打开的本来就不存)
      if (c.gone) clearToast('other-tab');
      c.gone = c.readonly ? 'changed' : undefined;
    } else {
      // 删了,或者存成了别的样子(那边也开着它改了、同步取回了另一台设备改过的):这里的还是旧的,不再自动存,不然一改就把那边的盖掉
      const why = now === null ? 'deleted' : 'changed';
      if (c.gone !== why) {
        if (!c.gone) stopThumb();
        c.gone = why;
        tellOtherTab(c, why);
      }
    }
  } else if (key !== null && newValue === null) {
    // 别的标签页删了别的世界,可能腾出了地方
    retryUnsaved();
  }
  changed();
}

/** 存档有变化时调 f(返回取消函数) */
export function subscribe(f: () => void) {
  return subs.subscribe(f);
}

/** 存档有变化时重新渲染(返回一个递增的版本号) */
/** 存档以外的东西变了,列表要重画 */
export function savesChanged() {
  changed();
}

export function useSavesVersion(): number {
  return subs.use(() => version);
}

export interface SaveNotice {
  kind: 'ok' | 'warn' | 'error';
  /** 第一行 */
  text: string;
  /** 第二行小字(版本不同、找不到的改名……;几条连成一行) */
  more?: string[];
  /** 右侧的按钮 */
  action?: ToastAction;
  /** 左边一个绿点(存好了一个文件这类) */
  dot?: boolean;
  /** 毫秒;不给 = 成功的 7 秒,别的留着 */
  ttl?: number;
  /** 这条提示没了就调(见 toastStore 的 onGone) */
  onGone?: () => void;
  stamp: number;
}

let notice: SaveNotice | null = null;
/**
 * 存档的提示(读档结果、复制了分享链接……):显示在顶部的提示条上(toastStore,来源 'save');
 * 成功的 7 秒后收起,有警告 / 出错的留着等用户关。null = 收起
 */
export function notify(n: Omit<SaveNotice, 'stamp'> | null) {
  notice = n ? { ...n, stamp: performance.now() } : null;
  if (n) showToast({ id: 'save', kind: n.kind, text: n.text, more: n.more?.length ? n.more : undefined, action: n.action, dot: n.dot, onGone: n.onGone, ...(n.ttl !== undefined ? { ttl: n.ttl } : {}) });
  else clearToast('save');
  changed();
}
export function useSaveNotice(): SaveNotice | null {
  useSavesVersion();
  return notice;
}

// ---------------------------------------------------------------------------
// 读档提示的短说法:gen/savefile.ts 的原话是完整的句子,提示条上只留一行小字里的几个短句

const BRIEF_WARNING: Record<string, string> = {
  [CHECK_WARNING]: '地形和存档时对不上',
};
/** 读档的警告(版本不同、地形对不上……)→ 短句;认不出的原样 */
export function briefWarning(w: string): string {
  return BRIEF_WARNING[w] ?? w;
}
/** 打不开存档 / 分享链接的原因 → 短句;认不出的原样 */
export function briefError(e: string): string {
  if (e === SHARE_BROKEN) return '链接不完整,请让对方重新复制';
  if (e.includes('来自更新版本')) return '来自更新的版本,刷新页面后再打开';
  if (e.includes('浏览器太旧')) return '浏览器版本太旧,请换新版浏览器或改用存档文件';
  if (e.includes('不是「文明与地图」')) return e.includes('链接') ? '链接被改动过,请让对方重新复制' : '不是「文明与地图」的存档';
  return e;
}

// ---------------------------------------------------------------------------
// 存不下时的提示(顶部提示条,来源 'storage':不和读档结果的 'save' 互相顶掉)

/**
 * "存成文件"(提示条上的按钮调它):每个挂着的 SaveMenu 登记一次、卸下时撤掉自己那一次,
 * 用最后登记的那个 —— 同时挂着几个存档菜单(手机的世界卡片和概览)时,卸下其中一个不影响别的
 */
const fileSavers: (() => void)[] = [];
export function addFileSaver(f: () => void): () => void {
  fileSavers.push(f);
  return () => {
    const i = fileSavers.lastIndexOf(f);
    if (i >= 0) fileSavers.splice(i, 1);
  };
}
function saveFileAction(): ToastAction | undefined {
  if (!fileSavers.length) return undefined;
  return {
    label: '存成文件',
    onClick: () => {
      clearToast('storage');
      fileSavers[fileSavers.length - 1]?.();
    },
  };
}

/** 自动存写不下(个数到了上限、浏览器配额满了);写成功一次就清掉 */
let storageFull = false;
/** 只在内存里存(浏览器不让存)的提示已经说过了 */
let memoryWarned = false;
/** 存不下的原因:个数到上限 / 浏览器配额满了 */
let fullWhy: 'count' | 'quota' = 'quota';

/** 自动存是不是写不下了(菜单里的一行字用) */
export function storageIsFull(): boolean {
  return storageFull;
}

/** 最近一次存不下的原因,一小句话:个数到了上限,还是浏览器存储满了 */
export function storageFullWhy(): string {
  return fullWhy === 'count' ? `「我的世界」最多存 ${MAX_WORLDS} 个` : '浏览器存储已满';
}

export function storageFullByQuota(): boolean {
  return storageFull && fullWhy === 'quota';
}

/** 被关掉了也算说过,腾出地方前不再说 */
let vaultFullSaid = false;

export function reportVaultFull() {
  if (vaultFullSaid || storageFull) return;
  vaultFullSaid = true;
  showToast({ id: 'storage', kind: 'warn', text: '没能自动存档', more: ['浏览器存储已满。存成文件就不会丢，或者删掉几个世界'], action: saveFileAction() });
}

export function vaultRoomBack() {
  if (!vaultFullSaid) return;
  vaultFullSaid = false;
  if (!storageFull) clearToast('storage');
}

function reportFull(why: 'count' | 'quota') {
  // 已经提示过、原因没变:不再重复;原因变了(删了一个以后个数够了、但浏览器存储还是不够)就换成新的说法
  if (storageFull && fullWhy === why) return;
  fullWhy = why;
  storageFull = true;
  showToast({
    id: 'storage',
    kind: 'warn',
    text: '没能自动存档',
    more: [`${storageFullWhy()}。存成文件就不会丢，或者删掉几个世界`],
    action: saveFileAction(),
  });
  changed();
}

function reportMemoryOnly() {
  if (memoryWarned || local) return;
  memoryWarned = true;
  // 停 10 秒自己收起(存档菜单里当前世界那一行一直写着)
  showToast({ id: 'storage', kind: 'warn', text: '浏览器不让网页存数据', more: ['修改只留在这个页面里,关掉前请存成文件'], action: saveFileAction(), ttl: 10_000 });
}

// ---------------------------------------------------------------------------
// 存、读、列、删

/** 只在本地用的几项(不进存档文件) */
interface Meta {
  /** 还在新建(没点"创建世界") */
  draft?: boolean;
  /** 最近一次打开(ISO 8601) */
  opened?: string;
  /** 结束那一年现存几国(没长出文明 = 0);还不知道 = 没有 */
  alive?: number;
  /** 新建中、以某个世界为底稿:原来那个世界 */
  base?: DraftBase;
  /** 只存了地图、还没有文明(见文件头) */
  map?: boolean;
  /** 逐年推演:从哪个世界的哪一年开始的(存回推演模式时能选"覆盖原来的";只在这台设备上) */
  from?: string;
  /** 从文件打开进来的时间(ISO;存档菜单写「来自文件」用;只在这台设备上,不进文件、不同步) */
  fromFile?: string;
}

export interface StoredWorld {
  id: string;
  save: SaveFile;
  /** 改了几处 */
  count: number;
  thumb: string | null;
  /** 还在新建("没建完") */
  draft: boolean;
  /** 最近打开或修改的时间(ISO;列表按它排,最近的在前) */
  at: string;
  /** 结束那一年现存几国;还不知道 = undefined */
  alive?: number;
  /** 新建中、以某个世界为底稿:原来那个世界 */
  base?: DraftBase;
  /** 只存了地图、还没有文明 */
  map: boolean;
  /** 地图缩略图(没截过 = null) */
  mapThumb: string | null;
  /** 从文件打开进来的时间(只在这台设备上记) */
  fromFile?: string;
}

function readSave(id: string): SaveFile | null {
  const text = store().get(PREFIX + id);
  if (!text) return null;
  const r = parseSave(text);
  return r.ok ? r.save : null;
}

function readMeta(id: string): Meta {
  const text = store().get(META + id);
  return text ? parseMeta(text) : {};
}

function parseMeta(text: string): Meta {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const m: Meta = {};
    if (v.draft === true) m.draft = true;
    if (v.map === true && v.draft !== true) m.map = true;
    if (typeof v.opened === 'string' && !Number.isNaN(Date.parse(v.opened))) m.opened = v.opened;
    if (typeof v.alive === 'number' && Number.isFinite(v.alive) && v.alive >= 0) m.alive = Math.floor(v.alive);
    const b = v.base as Record<string, unknown> | undefined;
    if (b && typeof b === 'object' && typeof b.id === 'string' && typeof b.title === 'string')
      m.base = { id: b.id, title: cleanTitle(b.title) || '未命名世界', names: Math.max(0, Math.floor(Number(b.names) || 0)), interventions: Math.max(0, Math.floor(Number(b.interventions) || 0)) };
    if (typeof v.from === 'string' && v.from) m.from = v.from;
    if (typeof v.fromFile === 'string' && !Number.isNaN(Date.parse(v.fromFile))) m.fromFile = v.fromFile;
    return m;
  } catch {
    return {};
  }
}

/** 浏览器里存的一个世界;没有 = null */
export function loadWorld(id: string): StoredWorld | null {
  const save = readSave(id);
  if (!save) return null;
  const m = readMeta(id);
  const at = m.opened && m.opened > save.savedAt ? m.opened : save.savedAt;
  const kv = store();
  return { id, save, count: editCount(save.edits), thumb: kv.get(THUMB + id), draft: !!m.draft, at, alive: m.alive, base: m.draft ? m.base : undefined, map: !!m.map, mapThumb: kv.get(MAPTHUMB + id), ...(m.fromFile ? { fromFile: m.fromFile } : {}) };
}

/** 存过的世界,最近打开或改过的在前 */
export function listWorlds(): StoredWorld[] {
  const out: StoredWorld[] = [];
  for (const k of store().keys()) {
    if (!k.startsWith(PREFIX)) continue;
    const w = loadWorld(k.slice(PREFIX.length));
    if (w) out.push(w);
  }
  return out.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : a.id < b.id ? -1 : 1));
}

/** 这个编号在浏览器里存着 */
export function isStored(id: string): boolean {
  return store().get(PREFIX + id) !== null;
}

const nameOf = (id: string) => {
  const s = readSave(id);
  return s ? s.title || `种子 ${s.seed}` : null;
};

function removeKeys(id: string) {
  const kv = store();
  for (const p of [PREFIX, THUMB, META, NOTES, ORIG, MAPTHUMB]) kv.remove(p + id);
}

/** 写一个键;浏览器写不下就算了(返回 false),不为它删任何已经存着的世界 */
function put(key: string, value: string): boolean {
  return store().set(key, value);
}

function writeMeta(id: string, m: Meta): boolean {
  const v: Meta = {};
  if (m.draft) v.draft = true;
  if (m.opened) v.opened = m.opened;
  if (m.alive !== undefined) v.alive = m.alive;
  if (m.draft && m.base) v.base = m.base;
  if (m.map && !m.draft) v.map = true;
  if (m.from) v.from = m.from;
  // 自动存写本地信息时不带这一项(只在从文件打开时记一次),原来有的留着
  const fromFile = m.fromFile ?? readMeta(id).fromFile;
  if (fromFile) v.fromFile = fromFile;
  return put(META + id, JSON.stringify(v));
}

/** 记下这个世界是从文件打开进来的(存档菜单写「来自文件」;只在这台设备上):存不下就算了 */
export function markFromFile(id: string): void {
  if (store().get(PREFIX + id) === null) return;
  writeMeta(id, { ...readMeta(id), fromFile: new Date().toISOString() });
  changed();
}

/** 只写本地信息(最近打开、现存几国):存不下就算了 */
function touchMeta(id: string, m: Meta): boolean {
  return writeMeta(id, m);
}

/**
 * 一个世界要存成第 next 版生成器的存档:浏览器里原来那份是更旧的版本存的、还没留过,返回它的原文(存档原文,一个字不改),
 * 新的存进去以后由 keepOriginal 另存;不用留 = null。同一个世界只留最早那份(以后再升级也不覆盖);读不出来的坏存档不留
 */
function originalToKeep(id: string, next: number): string | null {
  const kv = store();
  if (kv.get(ORIG + id) !== null) return null;
  const text = kv.get(PREFIX + id);
  if (text === null) return null;
  const r = parseSave(text);
  return r.ok && r.save.generator < next ? text : null;
}

/** 新的存进去了:把原来那份原样留着。写不下就算了:不为它删别的世界,也不拦着这次存 */
export function keepOriginal(id: string, text: string | null) {
  if (text !== null) store().set(ORIG + id, text);
}

/**
 * 写一个世界的存档(和本地信息);新存一个而个数已到上限、或浏览器写不下,就存不下(返回 false),不会删掉任何已经存着的世界。
 * 本地信息没写进去也算没存成:没有"还在新建"那一条,没建完的世界下次打开会被当成建好的、锁住。
 * 新存的就把存档也拿掉;原来就有的留着原来那份本地信息。
 * first:第一次存进来的世界原来是哪一份(打开旧版本的分享链接、旧网址以后改了才存的):比这次存的版本旧就原样留着
 */
function writeSave(id: string, save: SaveFile, meta?: Meta, first?: SaveFile | null): boolean {
  const kv = store();
  const fresh = kv.get(PREFIX + id) === null;
  if (fresh && storedCount() >= MAX_WORLDS) {
    reportFull('count');
    return false;
  }
  const text = JSON.stringify(save);
  const orig = !fresh ? originalToKeep(id, save.generator) : first && first.generator < save.generator ? JSON.stringify(first) : null;
  let ok = put(PREFIX + id, text);
  if (ok && meta && !writeMeta(id, meta)) {
    if (fresh) kv.remove(PREFIX + id);
    ok = false;
  }
  // 存档和本地信息都写成了才留原样(留它占的地方不挡着本地信息)
  if (ok) keepOriginal(id, orig);
  if (ok) {
    if (current?.id === id) current.wrote = text;
    if (storageFull) {
      storageFull = false;
      clearToast('storage');
    }
    reportMemoryOnly();
  } else reportFull('quota');
  return ok;
}

/** 用的人删掉的世界:编号 → 什么时候删的(毫秒) */
export function trashMarks(): Record<string, number> {
  try {
    const v = JSON.parse(store().get(TRASH) ?? '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, t] of Object.entries(v)) if (typeof t === 'number' && Number.isFinite(t)) out[k] = t;
    return out;
  } catch {
    return {};
  }
}

/** 记下来、划掉。写不下就算了:没记下的世界内容留着,多占点地方,不会丢东西。返回记的时间 */
export function markTrash(id: string, at: number = Date.now()): number {
  store().set(TRASH, JSON.stringify({ ...trashMarks(), [id]: at }));
  return at;
}

/** 划掉一条:撤销了删除、内容已经清了 */
export function unmarkTrash(id: string) {
  const m = trashMarks();
  if (!(id in m)) return;
  delete m[id];
  if (Object.keys(m).length) store().set(TRASH, JSON.stringify(m));
  else store().remove(TRASH);
}

/** 删除、撤销在世界仓库里也记一笔(localStorage 被回退时靠它分清,见 ../worldRoster.ts)。那段代码不在首页那一份里,用到才下;记不下就算了 */
function tellVault(id: string, marks: RosterMarks) {
  if (!persistent()) return;
  void import('./worldStore').then((m) => m.noteRoster(id, marks)).catch(() => {});
}

/** 用户删掉了一个世界(云同步记下来,账号里跟着删) */

/**
 * 删掉一个存档(连同缩略图、AI 写的东西)。删的是正在看的世界:不再自动存它。
 * 返回撤销用的那份;存档本身已经不在了(别的页面里删掉了)= null,没有可撤销的
 */
export function deleteWorld(id: string): DeletedWorld | null {
  const kv = store();
  const keys: [string, string][] = [];
  for (const p of [PREFIX, THUMB, META, NOTES, ORIG, MAPTHUMB]) {
    const v = kv.get(p + id);
    if (v !== null) keys.push([p + id, v]);
  }
  const had = keys.some(([k]) => k === PREFIX + id);
  removeKeys(id);
  const at = had ? markTrash(id) : undefined;
  if (at !== undefined) {
    tellVault(id, { deleted: at });
  }
  if (current?.id === id) {
    current = null;
    stopThumb();
  }
  retryUnsaved();
  changed();
  return had ? { id, keys, at } : null;
}

/** 删掉的世界删之前的样子(撤销删除用):存档、缩略图、打开记录、AI 写的史书和名字由来、旧版本的原样,各自原来存的字符串 */
export interface DeletedWorld {
  id: string;
  keys: [string, string][];
  /** 这次删除记录上的时间 */
  at?: number;
}

/**
 * 撤销删除:把删之前的几样原样写回,"我的世界"里回到原来的位置(按最近打开 / 修改的时间排)。
 * 别的页面里还开着它、删了以后又自动存过的:以那边新存的为准,只补回现在没有的。
 * 存档、打开记录(没建完的世界靠它记着还在建)、AI 写的东西有一样写不下(浏览器存储满了)
 * = false,这次写回的都撤掉;缩略图(再打开会重画)、旧版本的原样、已经搬进世界仓库的 AI 正文的旧副本写不下就算了,不为它们挡着世界放回来
 */
export function restoreWorld(d: DeletedWorld): boolean {
  const kv = store();
  const wrote: string[] = [];
  for (const p of [PREFIX, META, NOTES, ORIG, THUMB, MAPTHUMB]) {
    const k = p + d.id;
    const v = d.keys.find((e) => e[0] === k)?.[1];
    if (v === undefined || kv.get(k) !== null) continue;
    if (kv.set(k, v)) wrote.push(k);
    else if (p !== THUMB && p !== ORIG && p !== MAPTHUMB && !(p === NOTES && notesHooks.safeElsewhere(d.id, v))) {
      for (const w of wrote) kv.remove(w);
      changed();
      return false;
    }
  }
  // 放回来了才划掉:没放回来的世界还算删了
  const at = trashMarks()[d.id] ?? d.at;
  unmarkTrash(d.id);
  if (at !== undefined) tellVault(d.id, { undid: at });
  changed();
  return true;
}

/** 给存档起名(改名);当前世界还没存过的(打开的链接),顺手存下来 */
export function renameWorld(id: string, title: string) {
  const t = cleanTitle(title);
  if (current?.id === id) {
    current.title = t || undefined;
    if (current.readonly) notify({ kind: 'warn', text: READONLY_EDIT });
    saveCurrent(true);
    changed();
    return;
  }
  const w = readSave(id);
  if (!w) return;
  // 改名也算改了它:最后修改时间跟着变(我的世界里排到前面)
  const next: SaveFile = { ...w, savedAt: new Date().toISOString() };
  if (t) next.title = t;
  else delete next.title;
  writeSave(id, next);
  changed();
}

const CN = ['二', '三', '四', '五', '六', '七', '八', '九', '十'];
/** 另一个世界的名字:"苍澜界" → "苍澜界(二)";已经有了就(三)、(四)……(和存着的世界、当前世界都不重名) */
export function nextTitle(base: string): string {
  const root = cleanTitle(base).replace(/（[二三四五六七八九十\d]+）$/, '') || '未命名世界';
  const taken = new Set(listWorlds().map((w) => w.save.title ?? ''));
  if (current?.title) taken.add(current.title);
  for (let i = 0; i < 99; i++) {
    const n = i < CN.length ? CN[i] : String(i + 2);
    const suffix = `（${n}）`;
    const head = [...root].slice(0, TITLE_MAX - suffix.length).join('');
    const t = head + suffix;
    if (!taken.has(t)) return t;
  }
  return root;
}

/** "我的世界"里复制一份(名字加"(二)",缩略图、旧版本的原样一起;AI 写的东西由 ai/library 的 copyNotes 复制);返回新编号,复制不了 = null */
export function duplicateWorld(id: string): string | null {
  const w = loadWorld(id);
  if (!w) return null;
  if (storedCount() >= MAX_WORLDS) {
    fullWhy = 'count';
    return null;
  }
  const nid = newWorldId();
  const save: SaveFile = { ...w.save, title: nextTitle(w.save.title || '未命名世界'), savedAt: new Date().toISOString() };
  if (!writeSave(nid, save, { draft: w.draft, alive: w.alive })) return null;
  // 缩略图写不下就先不要,打开它时再截一张
  if (w.thumb) put(THUMB + nid, w.thumb);
  if (w.mapThumb) put(MAPTHUMB + nid, w.mapThumb);
  // 原样写不下就不带(原件那里还有)
  keepOriginal(nid, store().get(ORIG + id));
  changed();
  return nid;
}

/**
 * 照原样打开的旧世界「按新版另存一份」:复制一份(名字后面加「（新版）」,重了再编号),修改换成 edits(带着要推演的那几条),
 * 存档记现在的生成器版本,打开时按新版重新生成、推演(edits 记着地图留着的,地图不重新长,见 gen/edits.ts 文件头"地图留着的世界")。原来那份不动。
 * title = 另起的名字(不给 = 上面那样)。返回新编号(存不下、满了 = null)
 */
export function saveAsNewVersion(id: string, edits: WorldEdits, want?: string): string | null {
  const w = loadWorld(id);
  if (!w) return null;
  if (storedCount() >= MAX_WORLDS) {
    fullWhy = 'count';
    return null;
  }
  const suffix = '（新版）';
  const root = cleanTitle(w.save.title) || '未命名世界';
  const first = [...root].slice(0, TITLE_MAX - suffix.length).join('') + suffix;
  const taken = new Set(listWorlds().map((x) => x.save.title ?? ''));
  const title = cleanTitle(want) || (taken.has(first) ? nextTitle(first) : first);
  // 地形校验留空:新版生成出来的地形可能不一样,打开后按生成出来的记上(不提示"对不上")
  const save = makeSave(w.save.params, edits, '', title, undefined, w.save.view, w.save.origin, currentSystem());
  const nid = newWorldId();
  if (!writeSave(nid, save, { alive: w.alive })) return null;
  changed();
  return nid;
}

/**
 * 在一个建好的世界的地图上新开一段历史(gen/edits.ts 文件头"文明种子"):存一个新的世界,参数、初始地形(地形修改、草图)、
 * 投影、底稿出处照原来的,修改换成 newHistoryEdits(新的文明种子、记着用的哪张地图,原来的历史和作者内容一样不带)。
 * 名字不给 = 原来的名字加"(二)"(重了再编号)。原来那个不动。返回新编号(没有这个世界、没建完、存不下、满了 = null)。
 * 原来的世界是旧版本建的、地图在现在的版本里长得不一样时不能这样新开:调用前先核对(这里不管)
 */
export function newHistoryWorld(id: string, o: Omit<NewHistoryOptions, 'from'> & { title?: string }): string | null {
  const w = loadWorld(id);
  if (!w || w.draft) return null;
  if (storedCount() >= MAX_WORLDS) {
    fullWhy = 'count';
    return null;
  }
  const { title: want, ...opts } = o;
  const edits = newHistoryEdits(w.save.edits, { ...opts, from: id });
  const title = cleanTitle(want) || nextTitle(w.save.title || '未命名世界');
  // 地形校验:同一张地图照抄;旧版本建的留空,打开后按生成出来的记上
  const check = w.save.generator === GENERATOR_VERSION ? w.save.check : '';
  const save = makeSave(w.save.params, edits, check, title, undefined, w.save.view, w.save.origin, currentSystem());
  const nid = newWorldId();
  if (!writeSave(nid, save, { opened: save.savedAt })) return null;
  changed();
  return nid;
}

/**
 * 照正在看的世界另存一个(参数、地形校验、投影、底稿出处照旧;算建好的),修改换成 edits,名字 title。
 * 逐年推演用:从某一年开始演绎(from = 原来那个世界,存回推演模式时能选覆盖它)、存回推演模式存成新世界(from 不给)。
 * 原来的不动。返回新编号(没有正在看的世界、存不下、满了 = null)
 */
export function saveCurrentAs(edits: WorldEdits, title: string, from?: string): string | null {
  const c = current;
  if (!c) return null;
  if (storedCount() >= MAX_WORLDS) {
    fullWhy = 'count';
    return null;
  }
  // 照原样打开的旧世界另存出来的:按现在的版本打开、推演(地形校验留空,打开后按生成出来的记上)
  const save = makeSave(c.params, edits, c.frozen !== undefined ? '' : c.check, cleanTitle(title) || undefined, undefined, currentView(), c.origin, currentSystem());
  const nid = newWorldId();
  if (!writeSave(nid, save, { opened: save.savedAt, ...(from && isStored(from) ? { from } : {}) })) return null;
  changed();
  return nid;
}

/** 逐年推演的世界是从哪个世界开始的(那个世界还在、建好了才算;没有 = null) */
export function stepOrigin(id: string): { id: string; title: string } | null {
  const from = readMeta(id).from;
  if (!from || from === id) return null;
  const w = loadWorld(from);
  if (!w || w.draft || w.map) return null;
  return { id: from, title: w.save.title || '未命名世界' };
}

/**
 * 盖掉一个存着的世界的修改(存回推演模式时"覆盖原来的"):名字、参数、投影照旧,修改换成 edits。
 * 正在看的就是它 = 不在这里改(返回 false)。写进去了 = true
 */
export function overwriteWorld(id: string, edits: WorldEdits): boolean {
  if (current?.id === id) return false;
  const w = loadWorld(id);
  if (!w || w.draft || w.map) return false;
  // 地形校验:旧版本建的留空(这一份记现在的版本,打开后按生成出来的记上)
  const check = w.save.generator === GENERATOR_VERSION ? w.save.check : '';
  const save = makeSave(w.save.params, edits, check, w.save.title, undefined, w.save.view, w.save.origin, currentSystem());
  // 结束那一年现存几国、缩略图都是原来那段历史的:去掉,打开时重新数、重截
  const meta: Meta = { ...readMeta(id), opened: save.savedAt };
  delete meta.alive;
  if (!writeSave(id, save, meta)) return false;
  store().remove(THUMB + id);
  changed();
  return true;
}

/** 两份存档是不是同一个世界的同一个样子(参数、修改、名字、底稿出处都相同;投影、存档时间不算) */
export function sameSave(a: SaveFile, b: SaveFile): boolean {
  return worldKey(a.params) === worldKey(b.params) && (a.title ?? '') === (b.title ?? '') && JSON.stringify(a.edits) === JSON.stringify(b.edits) && sameOrigin(a.origin, b.origin);
}

/** 两个底稿出处是不是一样(都没有也算) */
export function sameOrigin(a: SaveFile['origin'], b: SaveFile['origin']): boolean {
  if (!a || !b) return !a && !b;
  return (a.by ?? '') === (b.by ?? '') && a.title === b.title && a.url === b.url && (a.gallery ?? '') === (b.gallery ?? '');
}

/**
 * 从文件打开:存进"我的世界"(算建好的),返回它的编号。
 * 已经有一个一模一样的(参数、修改、名字、底稿出处都相同,比如同一个文件打开了两次)就用那一个,不重复存
 */
export function importSave(save: SaveFile): string | null {
  for (const w of listWorlds()) {
    if (w.draft || w.map || !sameSave(w.save, save)) continue;
    // 只差投影 / 中央经线 / 经纬网 / 等值线:用文件里的(下次打开还是文件里的样子;文件记了经纬网、等值线,存着的没记,也换成文件里的)
    let ok = true;
    const grat = save.view?.graticule;
    const iso = save.view?.contours;
    const view = !sameView(w.save.view, save.view) || (grat !== undefined && w.save.view?.graticule !== grat) || (iso !== undefined && w.save.view?.contours !== iso);
    // 文件是更新的版本:存着的跟着记文件的版本(以后打开按文件的版本,不再照原样读旧的那一份);旧的那份留作原样
    const newer = save.generator > w.save.generator;
    if (view || newer) {
      const next: SaveFile = { ...w.save, savedAt: new Date().toISOString() };
      if (view) {
        if (save.view) next.view = save.view;
        else delete next.view;
      }
      const was = store().get(PREFIX + w.id);
      if (newer) {
        next.generator = save.generator;
        next.check = save.check;
      }
      ok = writeSave(w.id, next);
      if (ok && newer && store().get(ORIG + w.id) === null) keepOriginal(w.id, was);
      changed();
    }
    // 存着的已经是更新的版本、还没留原样:文件这份就是它原来的样子(看原样);存档写成了以后再留
    if (ok && save.generator < w.save.generator && originalOf(w.id) === null) keepOriginal(w.id, JSON.stringify(save));
    return w.id;
  }
  const id = newWorldId();
  const copy: SaveFile = { ...save, savedAt: new Date().toISOString() };
  if (!writeSave(id, copy, { opened: copy.savedAt })) return null;
  changed();
  return id;
}

// ---------------------------------------------------------------------------
// 当前世界 + 自动存

export type WorldKind = 'draft' | 'created' | 'visit';

interface Current {
  id: string;
  params: WorldParams;
  check: string;
  title?: string;
  kind: WorldKind;
  /** 新建中、作者还没动过(没起名、没调参数、没改地形):不存 */
  pristine: boolean;
  /** 结束那一年现存几国(存进本地信息,"我的世界"的卡片上写) */
  alive?: number;
  /** 新建中、以某个世界为底稿:原来那个世界 */
  base?: DraftBase;
  /** 最近一次存下的修改(同一个对象不重复存) */
  saved: WorldEdits | null;
  /** 最近一次存下的投影设置 */
  savedView?: SaveView;
  /** 最近一次没写进去(浏览器存储满了):最新的改动只在这个页面里 */
  unsaved?: boolean;
  /**
   * 别的标签页把它删了(删掉、退出登录时选了从这台设备上删掉)、或者存成了别的样子(那边也开着它改了、同步取回了另一台设备改过的):
   * 不再自动存,不然一改又存回去、把那边的盖掉
   */
  gone?: 'deleted' | 'changed';
  /** 浏览器里存着的这个世界、这里知道的最新一份(这里写进去的、打开时存着的):别的标签页写的和它不一样 = 那边改过 */
  wrote?: string | null;
  /** 底稿出处(从别人的分享短链接另存来的;存进存档) */
  origin?: SaveOrigin;
  /** 打开时还没存着、来自旧版本的世界(分享链接、旧网址):原来那一份,第一次存进来时原样留着 */
  original?: SaveFile;
  /** 照原样打开的旧世界(读的是它那一版的原件,没有重新生成):建它的生成器版本,存档照旧记这一版 */
  frozen?: number;
  /** 只读打开(见 AttachSpec.readonly) */
  readonly?: boolean;
  /**
   * 只有配方的旧世界(存着的存档比现在旧,内容没存下,看到的这一份是按现在的规则算的):存档照旧记建它的那一版、当时的地形校验。
   * 打开、改名都不写成新版,不然配方就不再是存档本身,标记和另存的入口也跟着没了;要留看到的样子走另存
   */
  oldRecipe?: { generator: number; check: string };
}

let current: Current | null = null;

/** 当前世界的存档:照原样打开的旧世界、只有配方的旧世界照旧记建它的那一版 */
function saveOf(c: Current, edits: WorldEdits, view: SaveView | null | undefined): SaveFile {
  const save = makeSave(c.params, edits, c.oldRecipe?.check ?? c.check, c.title, undefined, view, c.origin, currentSystem());
  if (c.frozen !== undefined) save.generator = c.frozen;
  else if (c.oldRecipe) save.generator = c.oldRecipe.generator;
  return save;
}
/**
 * 截缩略图(App 给):画布还没画好这个世界 = null(过一会儿再来要)。
 * now = 只截这一次、不会再来要(要的整张底图还没在后台备好也当场画);没给 = 底图还在后台备着就先 null
 */
type ThumbMaker = (id: string, now?: boolean) => string | null;
let thumbMaker: ThumbMaker | null = null;
let thumbTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * 等着截的那一张:哪个世界、force = 要重截(已经有了也截)、第几次试;
 * thumbDone / mapDone = 缩略图 / 地图缩略图这一轮已经截好了,再试时只截还差的那张
 */
let pending: ({ id: string; force: boolean; tries: number } & Done) | null = null;
type Done = { thumbDone?: boolean; mapDone?: boolean };
/** 截一张之前至少等多久(毫秒;画布这时可能还没画好) */
const THUMB_DELAY = 700;
/** 编辑地形:地形停了多久没再变(涂了一笔、按新地形重新生成完)才截(毫秒) */
export const THUMB_EDIT_QUIET = 4000;
/** 正在编辑地形(App 给) */
let thumbEditing = false;
/** 编辑地形:到这一刻(performance.now)之前先不截 */
let quietUntil = 0;
/** 地形变了、还没截到新缩略图的世界编号(收起编辑地形、flushThumb 时要补截) */
let thumbOld: string | null = null;

/** 不截了(换世界、删掉) */
function stopThumb() {
  if (thumbTimer !== undefined) clearTimeout(thumbTimer);
  thumbTimer = undefined;
  pending = null;
}

/** 编辑地形时还要等多少毫秒才截(没在编辑 = 0) */
const quietLeft = () => (thumbEditing ? quietUntil - performance.now() : 0);

/** 地形变了(涂了一笔、按新地形重新生成完):编辑地形时从这一刻重新算停了多久 */
function noteTerrainChange() {
  quietUntil = performance.now() + THUMB_EDIT_QUIET;
}

/**
 * 编辑地形开着没有(App 在它开关时调):开着时连着涂不截缩略图,停够 THUMB_EDIT_QUIET 才截;
 * 收起时等着的那一张不再等停笔,这次编辑里地形变过、还没截到的补截一张
 */
export function setThumbEditing(on: boolean) {
  if (thumbEditing === on) return;
  thumbEditing = on;
  if (on) return;
  const c = current;
  if (c && thumbOld === c.id) scheduleThumb(c.id, true, 0, pending?.id === c.id ? { thumbDone: pending.thumbDone, mapDone: pending.mapDone } : {});
  else if (pending) armThumb();
}

export function setThumbMaker(f: ThumbMaker | null) {
  thumbMaker = f;
}

/** 截地图缩略图(App 给;见文件头):画布还没画好 = null;now 同 thumbMaker */
let mapThumbMaker: ThumbMaker | null = null;
export function setMapThumbMaker(f: ThumbMaker | null) {
  mapThumbMaker = f;
}

const take = (f: ThumbMaker | null, id: string, now = false): string | null => {
  try {
    return f?.(id, now) ?? null;
  } catch {
    return null;
  }
};

export type CurrentWorld = Readonly<Omit<Current, 'saved' | 'savedView'>>;

/** 当前世界(自动存的对象);换世界途中 = null */
export function currentWorld(): CurrentWorld | null {
  return current;
}

/** 当前世界最近的改动没写进浏览器(存储满了,只在这个页面里;退出登录选"删掉"前要拦住) */
export function currentUnsaved(): boolean {
  return !!current?.unsaved;
}

/** 当前世界 → 存档(存成文件用) */
export function currentSave(): SaveFile | null {
  if (!current) return null;
  return saveOf(current, getEdits(), currentView());
}

/**
 * 过一会儿截一张缩略图(画布这时可能还没画好这个世界,截不到就再等等);force = 已经有了也重截。
 * tries、done 是再试时带着的(第几次、这一轮哪张已经截好了)
 */
function scheduleThumb(id: string, force = false, tries = 0, done: Done = {}) {
  // 等着重截的不被随后一次普通的盖掉
  if (pending?.id === id && pending.force) force = true;
  stopThumb();
  if (tries > 40) return;
  pending = { id, force, tries, ...done };
  armThumb();
}

/** 按等着的那一张排上:至少等 THUMB_DELAY;编辑地形时等到地形停够了 */
function armThumb() {
  if (thumbTimer !== undefined) clearTimeout(thumbTimer);
  thumbTimer = setTimeout(
    () => {
      thumbTimer = undefined;
      // 等的时候又涂了一笔(停了多久重新算)
      if (quietLeft() > 0) return armThumb();
      shootThumb(false);
    },
    Math.max(THUMB_DELAY, quietLeft()),
  );
}

/** 截等着的那一张;now = 不再等了(要的整张底图还没在后台备好也当场画)。截不到的照旧过一会儿再试 */
function shootThumb(now: boolean) {
  const p = pending;
  stopThumb();
  if (!p) return;
  const { id, force, tries } = p;
  const kv = store();
  if (current?.id !== id || !kv.get(PREFIX + id)) return;
  const wantThumb = !p.thumbDone && (force || !kv.get(THUMB + id));
  const wantMap = !!mapThumbMaker && !p.mapDone && (force || !kv.get(MAPTHUMB + id));
  if (!wantThumb && !wantMap) return;
  const url = wantThumb ? take(thumbMaker, id, now) : null;
  const map = wantMap ? take(mapThumbMaker, id, now) : null;
  const a = !!url && put(THUMB + id, url);
  const b = !!map && put(MAPTHUMB + id, map);
  if (a || b) changed();
  const done = { thumbDone: !!p.thumbDone || a, mapDone: !!p.mapDone || b };
  // 地形变了以后的两张都截到了
  if (force && thumbOld === id && done.thumbDone && (done.mapDone || !mapThumbMaker)) thumbOld = null;
  // 再试时只截还差的那张
  if (wantThumb && !url) return scheduleThumb(id, force, tries + 1, done);
  if (wantMap && !map) {
    // 只差地图缩略图:旧的那张(地形变了以前的)不留,下一次补上
    kv.remove(MAPTHUMB + id);
    scheduleThumb(id, force, tries + 1, done);
  }
}

/**
 * 等着截的缩略图(还有地形变了、还没截到的)不再等,当场截:换世界之前、全部存成文件、页面藏起来 / 关掉之前调。
 * 当场也截不到的(正在按新地形重新生成……)照旧过一会儿再试
 */
export function flushThumb() {
  const c = current;
  if (!c || (pending?.id !== c.id && thumbOld !== c.id)) return;
  if (pending?.id !== c.id) pending = { id: c.id, force: true, tries: 0 };
  else if (thumbOld === c.id) pending.force = true;
  shootThumb(true);
}

/** 当前世界的样子变了(新建中改了地形、刚创建完):缩略图重截 */
export function refreshThumb() {
  if (current && store().get(PREFIX + current.id) !== null) scheduleThumb(current.id, true);
}

function metaOf(c: Current, opened?: string): Meta {
  const m = readMeta(c.id);
  return { draft: c.kind === 'draft', opened: opened ?? m.opened, alive: c.alive ?? m.alive, base: c.kind === 'draft' ? c.base : undefined, from: m.from };
}

const READONLY_EDIT = '这里的改动不会存。要留下，先另存一份';

/** 要重推的走 historyGate,到这里的是改名这类 */
function tellReadonlyEdit(c: Current, edits: WorldEdits) {
  if (!c.readonly || edits === c.saved) return;
  c.saved = edits;
  notify({ kind: 'warn', text: READONLY_EDIT });
}

/** 把当前世界存下来(修改没变就不存;force = 起名、换了投影、刚创建……) */
/** 存当前世界;返回写进去没有(没有当前世界、没改过不用存 = false) */
function saveCurrent(force = false): boolean {
  const c = current;
  if (!c) return false;
  const edits = getEdits();
  if (c.gone) {
    tellReadonlyEdit(c, edits);
    return false;
  }
  // 上次没写进去的(存储满了):修改没再变也再试一次
  if (!force && edits === c.saved && !c.unsaved) return false;
  // 干预、地形大事变了:历史要重推,缩略图上结束那一年的地形、国家跟着变,重截(App 等重推完、那一段的主图铺好才给图)
  const was = c.saved;
  const differs = (a: unknown, b: unknown) => a !== b && JSON.stringify(a ?? []) !== JSON.stringify(b ?? []);
  const redraw = !!was?.interventions && (differs(edits.interventions, was.interventions) || differs(edits.upheavals, was.upheavals));
  // 编辑地形涂了一笔:停了多久从这一刻重新算
  if (was && (edits.terrain !== was.terrain || edits.sketch !== was.sketch)) noteTerrainChange();
  c.saved = edits;
  // 新建中:走到这里就是作者动了(改了地形、起了名、调了参数);只换投影的走不到这里(没存过的不为它存)
  if (c.kind === 'draft') c.pristine = false;
  // 打开的链接改过了:存进"我的世界",从此算建好的
  if (c.kind === 'visit') c.kind = 'created';
  const view = currentView();
  c.savedView = view;
  const ok = writeSave(c.id, saveOf(c, edits, view), metaOf(c), c.original);
  c.unsaved = !ok;
  if (ok) scheduleThumb(c.id, redraw);
  changed();
  return ok;
}

/** 当前世界上次没写进浏览器(存储满了):删了别的世界、腾出地方以后再存一次(不然要等再改一处才存) */
function retryUnsaved() {
  if (current?.unsaved) saveCurrent(true);
}

/**
 * 这个世界里存了 AI 写的东西(史书、名字由来):只是看看的世界从此存进"我的世界"(那些东西按世界编号存,
 * 不存这个世界的话刷新以后就找不回来了)。新建中的、已经存着的不用管
 */
export function keepWorld(id: string) {
  const c = current;
  if (!c || c.id !== id || c.kind !== 'visit') return;
  saveCurrent(true);
}

/**
 * 投影 / 中央经线变了(App 停下来以后调):当前世界已经存着的话重写一次(最后修改时间跟着变);
 * 没存过的世界不存(只改了看法、没改世界,不占"我的世界"列表)
 */
export function viewChanged() {
  const c = current;
  if (!c || sameView(c.savedView, currentView())) return;
  if (store().get(PREFIX + c.id) === null) return;
  saveCurrent(true);
}

/** 旧存档没记经纬网:打开时经纬网照旧,就当存的是现在这样(之后改了经纬网才算改了看法) */
function withGraticule(v: SaveView): SaveView {
  let out = v.graticule === undefined ? { ...v, graticule: getGraticuleLines() } : v;
  if (out.contours === undefined) out = { ...out, contours: getContourKind() ?? '' };
  return out;
}

export interface AttachSpec {
  id: string;
  params: WorldParams;
  /** 地形的短哈希(worldCheck) */
  check: string;
  kind: WorldKind;
  title?: string;
  /**
   * 已经存下的(或者打开时就带着的)修改:App 套上的修改和它是同一个对象就不重写;
   * 不一样(比如旧格式的键换成了新的)就写一次
   */
  saved: WorldEdits;
  /** 存档里的投影设置(打开存着的世界时) */
  view?: SaveView;
  /** 新建中、作者还没动过:不存 */
  pristine?: boolean;
  /** 新建中、以某个世界为底稿:原来那个世界 */
  base?: DraftBase | null;
  /** 底稿出处(存着的世界、存档文件里带着的;打开别人的分享短链接时是那个链接)。新建中的没有 */
  origin?: SaveOrigin | null;
  /** 还没存着、来自旧版本的世界(分享链接、旧网址、存不进浏览器的存档文件):原来那一份(看原样用,第一次存进来时原样留着) */
  original?: SaveFile | null;
  /** 照原样打开的旧世界(读的原件):建它的生成器版本(存档照旧记这一版;只对建好的、比现在旧的算) */
  frozen?: number;
  /**
   * 只读打开:看的不是存档里的这份,不自动存,存档不动。两种:存档里有没推完的修改(见 ui/world/worldTarget.ts 的 Target.readonly);
   * 旧世界存的内容这次读不出,先按现在的规则算了一遍(存了就再也回不到原来的样子,下次打开要再读一次存的内容)
   */
  readonly?: boolean;
}

/**
 * 生成完一个世界、App 套上修改(setEdits)之后调:以后它的修改自动存。
 * 建好的世界、动过的新建世界:浏览器里没存过、或者存的和现在的对不上(参数、地形、名字、修改),就写一次;
 * 存着的世界原样打开:只记一下"最近打开"
 */
export function attachWorld(spec: AttachSpec) {
  const prev = readSave(spec.id);
  const title = cleanTitle(spec.title) || undefined;
  current = {
    id: spec.id,
    params: { ...spec.params },
    check: spec.check,
    title,
    kind: spec.kind,
    pristine: spec.kind === 'draft' && !!spec.pristine,
    base: spec.kind === 'draft' ? (spec.base ?? undefined) : undefined,
    saved: spec.saved,
    savedView: withGraticule(spec.view ?? prev?.view ?? DEFAULT_VIEW),
    // 新建中的没有底稿出处;两种例外,出处跟着(建好以后侧栏照样写):在别的世界的地图上打造的文明(地图出自那里)、
    // 照作品墙上的新建参数作品新建的(参数出自那里)
    origin: spec.kind === 'draft' && !spec.saved?.map?.from && !spec.origin?.gallery ? undefined : (cleanOrigin(spec.origin) ?? undefined),
    original: spec.kind === 'draft' || !spec.original || spec.original.generator >= GENERATOR_VERSION ? undefined : spec.original,
    frozen: spec.kind === 'created' && spec.frozen !== undefined && spec.frozen < GENERATOR_VERSION ? spec.frozen : undefined,
    gone: spec.readonly ? 'changed' : undefined,
    readonly: spec.readonly || undefined,
    oldRecipe: spec.kind === 'created' && spec.frozen === undefined && !spec.readonly && prev && prev.generator < GENERATOR_VERSION ? { generator: prev.generator, check: prev.check } : undefined,
  };
  const keep = spec.kind === 'created' || (spec.kind === 'draft' && !spec.pristine);
  const same =
    !!prev &&
    worldKey(prev.params) === worldKey(spec.params) &&
    prev.check === (current.oldRecipe?.check ?? spec.check) &&
    (prev.title ?? '') === (title ?? '') &&
    JSON.stringify(prev.origin ?? null) === JSON.stringify(current.origin ?? null) &&
    getEdits() === spec.saved &&
    !!readMeta(spec.id).draft === (spec.kind === 'draft');
  if (keep && !same) {
    saveCurrent(true);
    // 新建中换了参数、地形:换了一颗星球,缩略图重截
    if (!spec.readonly && prev && (worldKey(prev.params) !== worldKey(spec.params) || prev.check !== spec.check)) scheduleThumb(spec.id, true);
  } else if (prev && spec.kind === 'draft' && spec.pristine) {
    // 新建中又变回没动过(换了一颗星球,改过的地形作废):原来存的那份拿掉
    removeKeys(spec.id);
  } else if (prev) {
    touchMeta(spec.id, metaOf(current, new Date().toISOString()));
    // 刚从文件打开的(先存了、再生成):还没有缩略图,截一张
    if (store().get(THUMB + spec.id) === null || (mapThumbMaker && store().get(MAPTHUMB + spec.id) === null)) scheduleThumb(spec.id);
    // 只有配方的旧世界按现在的规则长出来,地形和存的不一样:封面跟着看到的换(存档不动)
    else if (current.oldRecipe && current.oldRecipe.check !== spec.check) scheduleThumb(spec.id, true);
  }
  current.wrote = store().get(PREFIX + spec.id);
  changed();
}

/**
 * 只读打开时放弃存档里没推完的修改:存档换成现在看到的这一份,从此和平常一样自动存。
 *   ok         写进去了
 *   full       写不进去(存储满了):还是只读,修改还留在存档里
 *   elsewhere  打开以后别的页面、云同步改过或删了这个世界:这里的不是最新的,不盖,说一声(quiet = 不说)
 *   none       不是只读打开的,没有东西可放弃
 */
export function dropPendingEdits(quiet = false): 'ok' | 'full' | 'elsewhere' | 'none' {
  const c = current;
  if (!c?.readonly) return 'none';
  const now = store().get(PREFIX + c.id);
  if (now !== (c.wrote ?? null)) {
    c.gone = now === null ? 'deleted' : 'changed';
    if (!quiet) tellOtherTab(c, c.gone);
    return 'elsewhere';
  }
  const { gone } = c;
  c.readonly = undefined;
  c.gone = undefined;
  if (saveCurrent(true)) return 'ok';
  c.readonly = true;
  c.gone = gone;
  c.unsaved = undefined;
  return 'full';
}

/** 回到我的世界、又点开下面一直开着的这个世界(不用重新打开):记一下"最近打开" */
export function markOpened(id: string) {
  const c = current;
  const text = store().get(PREFIX + id);
  if (!c || c.id !== id || text === null) return;
  // 别的页面里存过、但和这里开着的一样(App 比过,只差投影之类):以存着的为准,接着自动存
  if (c.gone) {
    c.gone = undefined;
    c.wrote = text;
    clearToast('other-tab');
  }
  touchMeta(id, metaOf(c, new Date().toISOString()));
  changed();
}

/** 新建世界点了"创建世界":从此算建好的(种子、参数、地形锁住),一直存着 */
export function markCreated(): boolean {
  const c = current;
  if (!c || c.kind !== 'draft') return false;
  c.kind = 'created';
  c.pristine = false;
  c.base = undefined;
  return saveCurrent(true);
}

/**
 * 新建中点了「保存地图」:当前世界存成只有地图的一份(参数、地形修改、草图;名字、地名风格、推演年数这些文明的设定都不要),
 * 缩略图、地图缩略图当场截(截不到就没有);从此不再自动存它(App 接着回到我的世界)。写进去了 = true
 */
export function saveCurrentAsMap(): boolean {
  const c = current;
  if (!c || c.kind !== 'draft' || c.gone) return false;
  const e = getEdits();
  const edits: WorldEdits = { names: {}, interventions: [], terrain: e.terrain, ...(e.sketch ? { sketch: e.sketch } : {}) };
  // 出处跟着(照作品墙上的新建参数作品新建的:地图出自那套参数)
  const save = makeSave(c.params, edits, c.check, undefined, undefined, currentView(), c.origin, currentSystem());
  const prev = store().get(PREFIX + c.id);
  if (!writeSave(c.id, save, { map: true, opened: save.savedAt })) {
    // 存档换成了只有地图的、本地信息却没写上:放回原来那份(还是没建完的,名字、文明的设定都在)
    if (prev !== null && store().get(PREFIX + c.id) !== prev) put(PREFIX + c.id, prev);
    changed();
    return false;
  }
  const url = take(thumbMaker, c.id, true);
  const map = take(mapThumbMaker, c.id, true);
  if (url) put(THUMB + c.id, url);
  if (map) put(MAPTHUMB + c.id, map);
  current = null;
  stopThumb();
  changed();
  return true;
}

/** 结束那一年现存几国(App 推演完告诉这里;"我的世界"的卡片上写) */
export function setWorldStats(alive: number) {
  const c = current;
  if (!c || c.alive === alive) return;
  c.alive = alive;
  if (store().get(PREFIX + c.id) !== null) {
    touchMeta(c.id, metaOf(c));
    changed();
  }
}

/** 当前世界按新的地形修改重新生成完(新建中改地形):记下新的地形校验,已经存着的存档跟着改、缩略图重截 */
export function updateCheck(check: string) {
  const c = current;
  if (!c || c.check === check) return;
  c.check = check;
  if (store().get(PREFIX + c.id) === null) return;
  saveCurrent(true);
  // 编辑地形时:停够了才截(连着涂不截)
  noteTerrainChange();
  thumbOld = c.id;
  scheduleThumb(c.id, true);
}

/** 换世界(或读档)之前:之后的修改(clearEdits)不再算这个世界的 */
export function detachWorld() {
  current = null;
  stopThumb();
  thumbOld = null;
  changed();
}

/** 开始自动存(App 挂载时调一次;返回取消函数)。页面藏起来、关掉之前,等着的缩略图当场截 */
export function startAutoSave(): () => void {
  const off = subscribeEdits(() => saveCurrent());
  if (typeof window === 'undefined' || typeof document === 'undefined') return off;
  const hide = () => {
    if (document.visibilityState === 'hidden') flushThumb();
  };
  window.addEventListener('pagehide', flushThumb);
  document.addEventListener('visibilitychange', hide);
  return () => {
    off();
    window.removeEventListener('pagehide', flushThumb);
    document.removeEventListener('visibilitychange', hide);
  };
}

// ---------------------------------------------------------------------------
// 云同步(account/sync.ts)用:原样读写一个世界

/** 跟着世界同步的本地信息(最近打开不同步:每台设备各记各的) */
export interface SyncMeta {
  draft?: boolean;
  alive?: number;
  base?: DraftBase;
  map?: boolean;
}

/** 本地信息 → 同步的那几项(键的顺序固定,算指纹用) */
export function syncMetaOf(m: Meta): SyncMeta {
  const v: SyncMeta = {};
  if (m.draft) v.draft = true;
  if (m.alive !== undefined) v.alive = m.alive;
  if (m.draft && m.base) v.base = m.base;
  if (m.map && !m.draft) v.map = true;
  return v;
}

/** 服务器给的 meta(不认识的字段不要,坏的当没有) */
export function cleanSyncMeta(v: unknown): SyncMeta {
  if (!v || typeof v !== 'object') return {};
  return syncMetaOf(parseMeta(JSON.stringify(v)));
}

export interface RawWorld {
  /** 存档原文(JSON) */
  save: string;
  meta: SyncMeta;
  thumb: string | null;
}

/** 浏览器里存着的全部世界的编号(老编号的也算) */
export function allWorldIds(): string[] {
  return store()
    .keys()
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => k.slice(PREFIX.length));
}

/** 浏览器里存着的世界编号(老编号"种子 + 参数"的不算:服务器只认新编号) */
export function storedIds(): string[] {
  const out: string[] = [];
  for (const k of store().keys()) {
    if (!k.startsWith(PREFIX)) continue;
    const id = k.slice(PREFIX.length);
    if (ID_RE.test(id)) out.push(id);
  }
  return out;
}

/** 能不能存进账号(老编号"种子 + 参数"的不能:服务器只认新编号) */
export function syncable(id: string): boolean {
  return ID_RE.test(id);
}

/**
 * 还用老编号存着的世界(打开网页时换新编号,浏览器存储满了没换成的,留在原处;腾出地方、刷新页面会再换一次)。
 * 它们存不进账号:退出登录选"从这台设备上删掉"前要先看一眼
 */
export function legacyIds(): string[] {
  const out: string[] = [];
  for (const k of store().keys()) {
    if (!k.startsWith(PREFIX)) continue;
    const id = k.slice(PREFIX.length);
    if (!ID_RE.test(id) && readSave(id)) out.push(id);
  }
  return out;
}

/** 浏览器里存着几个世界(连同老编号的) */
export function storedCount(): number {
  return storedIds().length + legacyIds().length;
}

/** 一个世界的原样(读不出来的坏存档 = null) */
export function rawWorld(id: string): RawWorld | null {
  const kv = store();
  const save = kv.get(PREFIX + id);
  if (!save || !parseSave(save).ok) return null;
  return { save, meta: syncMetaOf(readMeta(id)), thumb: kv.get(THUMB + id) };
}

/**
 * 把同步下来的世界写进浏览器(不为它删别的世界:写不下 = false,原来的不动)。
 * opened:这边还没记"最近打开"时用它(「全部存成文件」放回来时带着)。
 * 正在看的就是它:先不再自动存它(App 重新打开)
 */
export function putSyncedWorld(id: string, w: RawWorld, opened0?: string): boolean {
  const r = ID_RE.test(id) ? parseSave(w.save) : null;
  if (!r?.ok) return false;
  const kv = store();
  const old = kv.get(PREFIX + id);
  const had = readMeta(id);
  const opened = had.opened ?? opened0;
  // 另一台设备在新版里重存过的旧世界:写成了以后,这里原来那份原样留着
  const orig = old === null ? null : originalToKeep(id, r.save.generator);
  if (!kv.set(PREFIX + id, w.save)) return false;
  const m: Meta = { ...w.meta };
  if (opened) m.opened = opened;
  if (had.fromFile) m.fromFile = had.fromFile;
  if (!kv.set(META + id, JSON.stringify(m))) {
    if (old === null) kv.remove(PREFIX + id);
    else kv.set(PREFIX + id, old);
    return false;
  }
  keepOriginal(id, orig);
  // 缩略图写不下就先不要(打开时再截一张)
  if (!w.thumb || !kv.set(THUMB + id, w.thumb)) kv.remove(THUMB + id);
  if (current?.id === id) {
    current = null;
    stopThumb();
  }
  changed();
  return true;
}

/**
 * 「全部存成文件」放回来时,已经有的同一个世界:存档里没记投影、缺缩略图、不知道现存几国、没建完的不知道底稿的,用文件里的补上;
 * 文件里"最近打开"更晚的也用文件里的(存不下就算了,不为它删别的);返回补了没有("最近打开"不算)
 */
export function fillMissing(id: string, w: { view?: SaveView; thumb: string | null; alive?: number; base?: DraftBase; opened?: string }): boolean {
  const kv = store();
  const save = readSave(id);
  if (!save) return false;
  let done = false;
  // 正在看的这个:投影按页面上的(下次自动存就写页面上的),不补
  const open = current?.id === id ? current : null;
  if (w.view && !save.view && !open && kv.set(PREFIX + id, JSON.stringify({ ...save, view: w.view }))) done = true;
  if (w.thumb && !kv.get(THUMB + id) && kv.set(THUMB + id, w.thumb)) done = true;
  const m = readMeta(id);
  const next: Meta = { ...m };
  if (w.alive !== undefined && m.alive === undefined) next.alive = w.alive;
  if (w.base && m.draft && !m.base) next.base = w.base;
  // 文件里的"最近打开"比这边卡片上的时间晚:用文件里的(卡片时间、排序跟着回来;不算"补上了")
  const at = m.opened && m.opened > save.savedAt ? m.opened : save.savedAt;
  if (w.opened && w.opened > at) next.opened = w.opened;
  const more = next.alive !== m.alive || next.base !== m.base;
  let moved = false;
  if ((more || next.opened !== m.opened) && kv.set(META + id, JSON.stringify(next))) {
    // 正在看的这个也记上(下次自动存按页面里的写本地信息,不然又写没了)
    if (open && open.alive === undefined && next.alive !== undefined) open.alive = next.alive;
    if (open && open.kind === 'draft' && !open.base && next.base) open.base = next.base;
    if (more) done = true;
    moved = next.opened !== m.opened;
  }
  if (done || moved) changed();
  return done;
}

/** 别的设备上删掉了:这里跟着删(不算这台设备上的删除) */
export function removeSyncedWorld(id: string) {
  if (isStored(id)) {
    const at = markTrash(id);
    tellVault(id, { deleted: at, settled: at });
  }
  removeKeys(id);
  if (current?.id === id) {
    current = null;
    stopThumb();
  }
  // 腾出了地方:当前世界没存进去的再存一次。放到这一步做完以后(同步这时不理睬"存了"的通知),存了就会再排一次同步把它传上去
  queueMicrotask(retryUnsaved);
  changed();
}

/**
 * 退出登录时选了"从这台设备上删掉":浏览器里的世界全删;返回删干净了没有。
 * 浏览器不让删、看不了还剩什么 = false:删掉了的几样原样放回去(不然剩下半个世界,下次同步会把缺了东西的那份存进账号),
 * 正在看的世界接着用
 */
export function removeAllWorlds(): boolean {
  const ours = (k: string) => [PREFIX, THUMB, META, NOTES, LEGACY, ORIG, MAPTHUMB].some((p) => k.startsWith(p));
  if (!wipeBrowser(ours)) {
    // 正在看的那份没能放回去:马上再存一次
    if (current?.wrote != null && store().get(PREFIX + current.id) === null) saveCurrent(true);
    changed();
    return false;
  }
  // 删干净了当场记一笔:仓库要等一会儿才清,这中间打开的标签页不能把世界认回来
  store().set(VAULT_CLEARED, String(Date.now()));
  for (const k of [...mem.keys()]) if (ours(k)) mem.delete(k);
  current = null;
  stopThumb();
  changed();
  return true;
}

/**
 * 直接对浏览器存储删一遍、再看一遍还剩没剩。浏览器存储能不能用以这时直接看的为准(打开页面时探测不成功、
 * 后来出错退回内存的,浏览器里都可能还存着);看不了 = false。这个页面存在内存里、浏览器里却还存着的 = false,不删
 * (页面没看到它们,不知道同步过没有)。没删干净:删掉了的按删之前的样子放回去
 */
function wipeBrowser(ours: (k: string) => boolean): boolean {
  let s: Storage | undefined;
  try {
    s = (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return false;
  }
  // 没有浏览器存储(不在网页里):世界只在内存里
  if (!s) return true;
  const st = s;
  // 这个页面存在内存里(打开时探测不成功、后来出错退回内存):浏览器里还存着的这个页面没列出来、也就没同步过,删了就没了
  if (local === undefined) store();
  const fallback = local === null;
  const left = () => {
    const out: string[] = [];
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (k !== null && ours(k)) out.push(k);
    }
    return out;
  };
  const before = new Map<string, string>();
  try {
    for (const k of left()) {
      const v = st.getItem(k);
      if (v !== null) before.set(k, v);
    }
  } catch {
    return false;
  }
  if (fallback && before.size) return false;
  let ok = true;
  for (const k of before.keys()) {
    try {
      st.removeItem(k);
    } catch {
      ok = false;
    }
  }
  try {
    if (ok && left().length) ok = false;
  } catch {
    ok = false;
  }
  if (ok) return true;
  for (const [k, v] of before) {
    try {
      if (st.getItem(k) === null) st.setItem(k, v);
    } catch {
      /* 放不回去的:正在看的那份由上面再存一次 */
    }
  }
  return false;
}

/** 测试用:清空内存里的状态(不动浏览器存储) */
export function _resetForTest() {
  current = null;
  notice = null;
  local = undefined;
  migrated = false;
  storageFull = false;
  fullWhy = 'quota';
  memoryWarned = false;
  mem.clear();
  stopThumb();
  thumbOld = null;
  thumbEditing = false;
  quietUntil = 0;
}

/** title 没有 = 那个世界删掉了;不是地图留着的世界 = null */
export function keptFrom(edits: Pick<WorldEdits, 'map'>): { title?: string } | null {
  if (!keptMapOf(edits)) return null;
  const w = edits.map?.from ? loadWorld(edits.map.from) : null;
  return w ? { title: w.save.title || '未命名世界' } : {};
}

/**
 * 旧版本建的世界原来的样子(看原样用):留过底的是留的那份;没留过、存着的还是旧版本存的,就是存着的这份;
 * 都不是 = null(新版建的、读不出来的)。给的是存档原文(存档格式、各项都是当时写的,旧网站按它自己的读法读),
 * 只把生成器版本换成读出来的(老存档没写版本的)
 */
export function originalOf(id: string): SaveFile | null {
  const kv = store();
  for (const text of [kv.get(ORIG + id), kv.get(PREFIX + id)]) {
    if (text === null) continue;
    const r = parseSave(text);
    if (r.ok && r.save.generator < GENERATOR_VERSION) return { ...(JSON.parse(text.replace(/^\uFEFF/, '')) as SaveFile), generator: r.save.generator };
  }
  return null;
}

/** 正在看的世界原来的样子(存着的按 originalOf;还没存着的是打开时带的那一份);不是旧版本的 = null */
export function currentOriginal(): SaveFile | null {
  const c = current;
  if (!c) return null;
  return originalOf(c.id) ?? c.original ?? null;
}
