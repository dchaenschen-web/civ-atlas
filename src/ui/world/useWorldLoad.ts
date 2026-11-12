/**
 * 生成新世界、打开世界(App 用;线程交回的生成、打开那几种消息见 ./worldMessages.ts):
 *   - generate      打开一个世界:存过内容的读存的(worldOpen.ts;世界记的版本比现在旧 = 照原样打开),读不了退回旧的路(旧版本的读原件,再不行按参数、地形修改生成);
 *                   世界比这个页面还新、地图留着的世界读不出:回我的世界说一声(failOpen),世界不动;
 *                   换世界时旧世界的修改、选中、回放……一起作废
 *   - readyRef      世界生成完(或要打开的就是正在看的这一个):套上它的修改,交给 saveStore 自动存;核对版本、地形、改名,有问题就提示
 *   - 打开网页时    分享链接、朋友的预设链接、邀请链接、网址里的世界、分享短链接、作品墙;页面开着时又贴了链接(hashchange);浏览器的后退、前进接到 nav.ts
 *   - enterStage    换到新建 / 世界 / 我的世界
 *   - openTarget    打开一个世界(要的就是正在看的这张图就不重新生成);openStored 我的世界里的、openText 文件、openShare 分享链接、openShortShare 分享短链接
 * App 的状态按块传进来(见 ./worldRefs.ts);这里的函数每次渲染新建(和原来写在 App 里一样),generate 只建一次。
 * App 里在这个 hook 后面才定义的几样(回我的世界、打开作品、作品墙、后退前进;前几样在 ./useWorldPages.ts)经 later 调
 */
import { systemOpt } from '../../gen/systemState';
import { useCallback, useEffect, useRef } from 'react';
import type { LoadRequest, WorkerRequest } from '../../worker';
import type { World, WorldParams } from '../../gen/world';
import type { Civ } from '../../gen/civ/types';
import { EMPTY_EDITS, GENERATOR_VERSION, YEAR_TICKS, cleanCivSeed, cleanPlay, endParamOf, keptMapOf, keySeats, playAt, playFromOf, sameInterventions, upgradeLegacyKeys, type TerrainOp, type WorldEdits } from '../../gen/edits';
import { sameTerrain, sameUpheavals } from '../../gen/terrainEdits';
import { sameMix } from '../../gen/names/mix';
import { sameSketch, type SketchEdit } from '../../gen/sketch';
import {
  checkWarning,
  cleanMoment,
  cleanSignature,
  decodeShare,
  editCount,
  editedWorld,
  isMomentHash,
  isShareHash,
  momentYearMax,
  parseSave,
  VERSION_NOTE_HEAD,
  versionNote,
  worldCheck,
  worldKey,
  type ParseResult,
  type SaveFile,
  type SaveMoment,
  type SaveOrigin,
  type SaveView,
} from '../../gen/savefile';
import { wrapLon } from '../../render/projection';
import type { SurfaceLook } from '../../render/surface';
import { SHARE_CODE_RE, openShareCode, shortLink } from '../../account/cloud';
import { ServerError, accountServer } from '../../account/server';
import { getSession, takeInviteFromUrl } from '../../account/session';
import { galleryOfUrl } from '../../account/gallery';
import { closeTrash, openLogin } from '../AccountDialogs';
import { openBundleText } from '../bundle';
import { takeFileTrouble, takeOpenNote } from '../openNote';
import { withFileFlow } from '../worldFileLazy';
import { resetCharacterUi } from '../characterStore';
import { clearSelection, pausePlayback, setCivTime, takeAutoplay } from '../civView';
import { clearEdits, getEdits, setEdits, setMapSum } from '../editsStore';
import { resetExtend } from '../extendStore';
import { askSaveAsNew, closeSaveAsNew } from '../FrozenWorld';
import { setPolityPick } from '../Interventions';
import { layerParts } from '../mapLayers';
import { publishMapCenter, requestMapCenter } from '../mapWrap';
import { resetMarkUi } from '../markStore';
import { showMapInWorlds } from '../MyWorlds';
import { getNav, isNavState, navAdopt, navReplace, navTo, navUrl, startNav, type NavHooks, type NavInfo } from '../nav';
import { getNewView } from '../newViewStore';
import { OLD_SITE, OWN_KEY, oldSiteFor, oldSiteNote, openInLatest, openOriginal, plainSave } from '../oldSite';
import { KEPT_DEVICE, KEPT_DEVICE_FULL, KEPT_FILE, KEPT_LINK, READ_BACK, READ_TROUBLE, fileTrouble, newerNotice, openFailed } from '../openTrouble';
import { closeOverview, getPeople, setPeople } from '../overviewStore';
import { setWorldSheet } from '../panelStore';
import { decodePresetHash, isPresetHash, type PresetLinkResult } from '../presetLink';
import { openRulesHash, openRulesText } from '../rules/sheetStore';
import { pickSharedPreset } from '../presetStore';
import { GLOBE_READY, isCurved, isGraticuleStep, isMapProjection, setContourKind, setGraticule, setGraticuleStep, setProjection, type MapProjection } from '../projection';
import { recipeChanges, recipeKey, recipeOfSave } from '../../gen/snapshot';
import { endLoadWatch, noteOpenTrouble, openGuardReady, openingClear, openingShown, openingStart, vaultAllowed, watchLoad } from '../openGuard';
import { frozenResult, resultHeads } from '../resultStore';
import { keptMapHere, settleKeptWorld } from '../worldStore';
import { fullOverview } from '../fullWorldView';
import { sizeText } from '../sizeWords';
import { attachWorld, briefError, briefWarning, currentOriginal, currentWorld, deleteWorld, detachWorld, dropPendingEdits, flushThumb, importSave, isStored, loadWorld, markFromFile, markOpened, newWorldId, notify, persistent, sameOrigin, setWorldStats, storageFullWhy, storedCount } from '../saveStore';
import { getStage, setStage, type DraftBase, type Stage } from '../stageStore';
import { enterStepwise, leaveStepwise, stepStuck } from '../stepwiseStore';
import { setTerrainTool, type TerrainStatus } from '../TerrainTools';
import { clearToast, showToast } from '../Toast';
import { OK_TTL, type ToastAction } from '../toastStore';
import { closeUpheaval, openUpheaval } from '../upheavalStore';
import { lostRenames, lostRenamesNote } from '../sim/useSimResults';
import { setSharedView } from '../shareReport';
import type { CivRefs, GenRefs, LoadBack, OpenRefs, Ref, ResimRefs, Setter, WorldViewRefs } from './worldRefs';
import {
  aliveAtEnd,
  goneToast,
  namesOpt,
  presetDialog,
  sameScreen,
  sameSetup,
  setupFor,
  setupOpt,
  storedTarget,
  terrainDiffers,
  upsOpt,
  writeGalleryUrl,
  writeHomeUrl,
  writeWorldUrl,
  yearsFor,
  yearsOpt,
  type FirstRoute,
  type Landing,
  type NewDlg,
  type SharedFor,
  type Target,
  type WallView,
} from './worldTarget';

/**
 * 新建中的世界让生成线程顺手画好的写实像素层(见 worker.ts 的 paint):新建界面的星球贴的是卫星画法 sat 那一种
 * (studioBase 的「实景」);地图现在的底图(key,baseKeyOf 的键)是写实的另一种画法的,那一种也画
 */
function paintLooks(key: string, sat: SurfaceLook): SurfaceLook[] {
  const look = key === 'realistic' ? 'classic' : key.startsWith('realistic:') ? (key.slice(10) as SurfaceLook) : null;
  return look && look !== sat ? [sat, look] : [sat];
}

/**
 * 读档提示条上的按钮:最新版里打开旧版本的世界 =「看原样」(到那一版的旧网站里看,新页面;没有那一版的旧网站就不放);
 * 旧网站里打开更新的版本存的 =「到最新版打开」。orig:这个世界原来那一份
 */
function versionAction(orig: SaveFile | null): ToastAction | undefined {
  if (!orig) return undefined;
  if (OLD_SITE !== null) {
    if (!(orig.generator > GENERATOR_VERSION)) return undefined;
    return { label: '到最新版打开', act: 'open-latest', onClick: () => void openInLatest(orig).then((ok) => ok || openFailed(undefined, orig)) };
  }
  const site = oldSiteFor(orig.generator);
  if (!site) return undefined;
  return { label: '看原样', act: 'see-original', onClick: () => void openOriginal(orig).then((ok) => ok || openFailed(site.href, orig)) };
}

/** 从文件(.json)打开的世界存进「我的世界」了没有;warn = 没存住,文件先别删 */
function fileKept(id: string): { line: string; warn: boolean } {
  if (!isStored(id)) return { line: `${storageFullWhy()}，没存进「我的世界」，这个文件先别删`, warn: true };
  if (!persistent()) return { line: '浏览器不让网页存数据，世界只留在这个页面里，这个文件先别删', warn: true };
  return { line: '已存进「我的世界」，下次不用再选文件', warn: false };
}

/**
 * 存在"我的世界"里的建好的世界(打开时先读存下的内容):存着的那份存档;别的 = null。
 * 从文件打开、和存着的一模一样的(读档时认成了同一个)也算
 */
function storedSave(t: Target): SaveFile | null {
  if (t.kind !== 'created') return null;
  const w = loadWorld(t.id);
  if (!w || w.draft || w.map) return null;
  // 从文件打开、认成存着的这一个:文件也得是那一版的(更新版本的文件照文件里的版本打开)
  if (t.save && t.save.generator !== w.save.generator) return null;
  return worldKey(w.save.params) === worldKey(t.params) && JSON.stringify(w.save.edits) === JSON.stringify(t.edits) ? w.save : null;
}

/** 同 storedSave,只算旧版本建的(打开时读不到仓库就找它那一版的原件,照原样打开) */
function oldStored(t: Target): SaveFile | null {
  const save = storedSave(t);
  return save && save.generator < GENERATOR_VERSION ? save : null;
}

/** 提示条的来源:上次有改动没推完、世界打不开。换世界时收起(提示条上的按钮是冲着那个世界的) */
const PENDING_TOAST = 'pending-edit';
const TROUBLE_TOAST = 'open-trouble';

/** 这件事最多等这么久(毫秒),等不到 = fallback:读新路之前的几步卡住了也不能挡着打开世界 */
function atMost<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** 存档原文里记的生成器版本(读不出 = null) */
function genOfText(text: string): number | null {
  const r = parseSave(text);
  return r.ok ? r.save.generator : null;
}

/** 浏览器后退记的这一步是哪个画面(nav.ts):我的世界 / 新建(哪颗星球)/ 某个世界 */
function navInfo(stage: Stage, t: Target | null | undefined): NavInfo {
  if (stage === 'home' || !t) return { page: 'home' };
  return stage === 'draft' ? { page: 'draft', id: t.id, seed: t.params.seed, title: t.title } : { page: 'world', id: t.id, title: t.title };
}

/** 网址里的看法(画风、图层、投影、中央经线、经纬网、等值线):不算一步,按后退 / 前进时照现在的(nav.ts 的 url) */
const VIEW_KEYS = ['style', 'layer', 'map', 'fill', 'sat', 'civ', 'proj', 'view', 'lon', 'grat', 'iso'];
function keepView(from: string, to: string): string {
  const a = new URL(from);
  const b = new URL(to);
  for (const k of VIEW_KEYS) {
    const v = a.searchParams.get(k);
    if (v === null) b.searchParams.delete(k);
    else b.searchParams.set(k, v);
  }
  return b.href;
}

/** App 里在 useWorldLoad 后面才定义的:直接调的传成函数(调的时候已经有了),经 ref 调的传 ref(App 填 .current) */
export interface LoadLater {
  /** 回我的世界 */
  showHome: () => void;
  /** 打开作品墙上的一个作品(打开网页时,网址是作品的) */
  openWork: (id: string) => void;
  /** 分享链接带着"这一刻":App 记下要停到的那一刻(画面出来、重推完以后停过去) */
  holdMoment: (id: string, moment: SaveMoment) => void;
  showHomeRef: Ref<() => void>;
  wallRef: Ref<{ open: (id: string) => void; list: () => void }>;
  navRef: Ref<NavHooks>;
}

/** useWorldLoad 要的 App 状态(按块) */
export interface WorldLoadDeps {
  gen: GenRefs;
  civ: CivRefs;
  open: OpenRefs;
  resim: ResimRefs;
  /** 改地形那边的(换世界时收起) */
  terrain: {
    endNamesHold: () => void;
    setTerrainStatus: Setter<TerrainStatus>;
    setShownTerrain: Setter<readonly TerrainOp[]>;
    setShownSketch: Setter<SketchEdit | undefined>;
  };
  view: WorldViewRefs;
  /** 网址、打开网页时去哪,页面上的弹窗、说明、回放 */
  page: {
    init: { share: string | null; preset: string | null; shortShare: string | null; moment: SaveMoment | null };
    route: FirstRoute;
    wall: WallView | null;
    landing: Landing;
    presetLink: PresetLinkResult | null;
    setLanding: Setter<Landing>;
    setNewDlg: Setter<NewDlg | null>;
    setSharedFor: Setter<SharedFor | null>;
    setDraftTitle: Setter<string>;
    setReplay: (r: null) => void;
    setReplayOn: Setter<boolean>;
  };
  send: (req: WorkerRequest) => void;
  later: LoadLater;
}

export function useWorldLoad(deps: WorldLoadDeps) {
  const { send } = deps;
  const { reqId, targetRef, genParams, genTerrain, genSketch, fresh, regenRef, mapFirst, setMapEarly, lastReady, rawRef, setParams, setProgress } = deps.gen;
  const { civEdits, civUps, genUps, civNames, civYears, civSetup, civPlay } = deps.civ;
  const { frozenLoad, frozenBroken, loadedFrozen, genReq, loadBack, loadMapSum, savedCopy, shareErr, readyRef } = deps.open;
  const { resimSeq, resimInfo, setResim, resimText, switchNote, storyAfterYears, restoredIv, restoredUps, renameCheck, extendRef, extendDone, dropExtendUndo } = deps.resim;
  const { endNamesHold, setTerrainStatus, setShownTerrain, setShownSketch } = deps.terrain;
  const { mapViewRef, draftViewRef, drawKey, applyMapView, setHover } = deps.view;
  const { init, route, wall, landing, presetLink, setLanding, setNewDlg, setSharedFor, setDraftTitle, setReplay, setReplayOn } = deps.page;
  const { showHome, openWork, holdMoment, showHomeRef, wallRef, navRef } = deps.later;

  /** 按 t 的参数、地形修改生成世界;生成完(readyRef)套上 t 的修改 */
  const generate = useCallback(
    (t: Target) => {
      // 原来那个世界等着截的缩略图(编辑地形停笔没多久)先截下来,换走以后就截不到了
      flushThumb();
      targetRef.current = t;
      const p = t.params;
      const id = ++reqId.current;
      genParams.current = p;
      setParams(p);
      setProgress({ stage: '准备', pct: 0, seed: p.seed });
      // 手机:新世界、打开存档都要看地图 —— 拉到顶的世界卡片先收起来
      setWorldSheet('peek');
      // 改过地形、画过草图的世界直接带着它们生成,不用先生成原样再重新生成一遍
      const terrain = t.edits.terrain;
      genTerrain.current = terrain;
      genSketch.current = t.edits.sketch;
      fresh.current = true;
      regenRef.current = null;
      // 换了世界:编辑地形时不起名的那一段、要补推的历史都不算了(新世界带着历史生成)
      endNamesHold();
      setTerrainStatus({ busy: false });
      setShownTerrain(terrain);
      setShownSketch(t.edits.sketch);
      setTerrainTool({ on: false });
      closeUpheaval();
      closeSaveAsNew();
      // 地名风格也直接带着(只管起名,和改名、干预不同:生成完不用再重推一遍)
      civNames.current = t.edits.nameMix;
      // 推演年数同样直接带着(新建中的世界先推 3000 年)
      civYears.current = yearsFor(t.kind === 'draft' && !t.fullCiv, t.edits);
      civSetup.current = setupFor(t.kind === 'draft' && !t.fullCiv, t.edits);
      storyAfterYears.current = null;
      // 新建的世界能编辑地形:线程留着整张主图,第一笔就能只重铺变了的那块。
      // 新建界面先看的是地图(星球),推几千年的历史比生成地形、铺像素慢:地图先交、先换上,历史随后(mapFirst);
      // 写实画风的整张像素层也让线程画好随地图交来(paint),换上之前主线程不用自己再分小步画
      const req: WorkerRequest = { type: 'generate', id, params: p, scale: 1, terrain: [...terrain], sketch: t.edits.sketch, ...systemOpt(), ...namesOpt(t.edits.nameMix), ...yearsOpt(civYears.current), ...setupOpt(civSetup.current), ...(t.kind === 'draft' ? { keep: true, mapFirst: true as const, paint: paintLooks(drawKey.current, mapViewRef.current.sat) } : {}), renames: t.edits.names, characters: t.edits.characters };
      mapFirst.current = null;
      setMapEarly(false);
      frozenLoad.current = null;
      frozenBroken.current = null;
      genReq.current = null;
      loadBack.current = null;
      loadMapSum.current = null;
      endLoadWatch();
      openingClear();
      clearToast(PENDING_TOAST);
      clearToast(TROUBLE_TOAST);
      /** 读存下的内容打开。这份内容就是带着 edits 里的干预、地形大事(逐年推演的:推到"现在")推出来的:套上以后不用重推 */
      const sendLoad = (src: Pick<LoadRequest, 'parts' | 'vault' | 'original'>, gen: number, back: LoadBack) => {
        frozenLoad.current = { id: t.id, gen };
        // 地图留着的世界不管哪一版算的都算:按参数重新生成的不是它
        loadedFrozen.current = gen < GENERATOR_VERSION || !!keptMapOf(t.edits);
        civEdits.current = t.edits.interventions;
        civUps.current = genUps.current = t.edits.upheavals;
        const play = cleanPlay(t.edits.play);
        civPlay.current = play;
        const giveUp: LoadBack = (why, recipe) => {
          openingClear();
          frozenLoad.current = genReq.current = null;
          loadedFrozen.current = false;
          civEdits.current = EMPTY_EDITS.interventions;
          civUps.current = genUps.current = undefined;
          civPlay.current = undefined;
          back(why, recipe);
        };
        loadBack.current = giveUp;
        // 线程一段时间没动静:当它卡住了,记一次事。下一个请求发出去时线程被关掉
        watchLoad(() => {
          if (src.vault) noteOpenTrouble(t.id);
          loadBack.current = null;
          giveUp('broken');
        });
        if (src.vault) openingStart(t.id);
        // 带上进度:线程按它记下这份历史,下一步从这里接着推(不从第 0 年重推)
        send({ type: 'load', id, params: p, scale: 1, ...src, terrain: [...terrain], sketch: t.edits.sketch, ...upsOpt(t.edits.upheavals), interventions: [...t.edits.interventions], ...namesOpt(t.edits.nameMix), ...yearsOpt(civYears.current), ...setupOpt(civSetup.current), ...(play ? { play } : {}), renames: t.edits.names, characters: t.edits.characters });
      };
      const name = () => t.title || `种子 ${p.seed}`;
      /** 打不开:不生成、世界不动,回我的世界说一声 */
      const failOpen = (n: { text: string; more: string[]; action?: ToastAction }) => {
        genReq.current = null;
        // 下次再点开它要重新走一遍,不算"正在生成的就是它"
        genParams.current = null;
        fresh.current = false;
        setProgress(null);
        targetRef.current = null;
        showHomeRef.current();
        showToast({ id: TROUBLE_TOAST, kind: 'error', ...n });
      };
      /** 世界比这个页面还新 */
      const newerBack = () => failOpen({ text: `打不开「${name()}」`, ...newerNotice('world', storedSave(t)) });
      /**
       * 地图留着的世界(gen/edits.ts 文件头"地图留着的世界")读不到和存档对得上的内容:按种子长的不是它,绝不走生成。
       * 存在「我的世界」里的先按存下的地图算一份再打开(刚另存出来的、改了还没推完的),这台设备上真没有那张地图(别的设备同步来的)就不打开,
       * 有地图还不行就是读的时候出错了(存着的都还在);分享链接、配方文件带不上地图,也不打开
       */
      const keptOpen = () => {
        genReq.current = null;
        void (async () => {
          // 等 generate 收完尾再往下走(它后面还要写网址、换世界):不然回了我的世界,网址又写回这个世界
          await null;
          if (id !== reqId.current) return;
          const mine = !!storedSave(t);
          const ok = !t.keptTried && mine && (await settleKeptWorld(t.id));
          if (id !== reqId.current) return;
          if (ok) return generate({ ...t, keptTried: true, noVault: undefined });
          const text = `打不开「${name()}」`;
          const here = mine && (await keptMapHere(t.id));
          if (id !== reqId.current) return;
          // 刷新回来的(没走卡片):这张地图在账号里的话取回来再开一次
          if (mine && !here && !t.keptPulled && fullOverview()?.worlds.some((w) => w.id === t.id)) {
            const pulled = await import('../fullWorldPull').then((m) => m.pullKept(t.id)).catch(() => false);
            clearToast(TROUBLE_TOAST);
            if (id !== reqId.current) return;
            if (pulled) return generate({ ...t, keptPulled: true, keptTried: undefined, noVault: undefined });
            return failOpen({ text, more: ['它的地图在账号里，现在连不上服务器。联网后再打开'], action: { label: '再试一次', act: 'open-again', onClick: () => openStoredRef.current(t.id) } });
          }
          // 这台设备上有那张地图:是这次没算成、没存下,存档留着,能再试
          if (here) return failOpen({ text, more: [READ_TROUBLE], action: { label: '再试一次', act: 'open-again', onClick: () => openStoredRef.current(t.id) } });
          if (t.from === 'file') {
            // 这次打开才放进我的世界的配方:不留一张点不开的卡片
            if (t.fileNew) deleteWorld(t.id);
            return failOpen({ text, more: [KEPT_FILE] });
          }
          failOpen({ text, more: [mine ? (fullOverview() ? KEPT_DEVICE_FULL : KEPT_DEVICE) : KEPT_LINK] });
        })();
      };
      /** 按现在的规则生成 */
      const byRecipe = () => {
        if (keptMapOf(t.edits)) return keptOpen();
        genReq.current = null;
        send(req);
      };
      /** 旧路:旧版本建的世界,浏览器里有它那一版的原件就照原样打开(不重新生成);没有才按现在的规则生成。vaultBad = 新路是读坏了才退回来的 */
      const byOriginal = (vaultBad: boolean) => {
        const save = oldStored(t);
        if (!save) return byRecipe();
        genReq.current = req;
        void frozenResult(t.id, save).then((r) => {
          if (id !== reqId.current) return;
          if (!r || r === 'broken') {
            if (r || vaultBad) frozenBroken.current = t.id;
            return byRecipe();
          }
          sendLoad({ parts: r.parts }, save.generator, () => {
            frozenBroken.current = t.id;
            byRecipe();
          });
        });
      };
      /** 新路读不了:只读打开那一份,要更新软件的说一声,别的退回旧路 */
      const vaultBack: LoadBack = (why, recipe) => {
        if (why === 'newer') return newerBack();
        if (why === 'readonly') {
          const r = parseSave(JSON.stringify(recipe));
          if (r.ok) return generate({ ...t, edits: r.save.edits, saved: r.save.edits, save: r.save, readonly: { save: r.save, draft: t } });
        }
        byOriginal(why === 'broken');
      };
      const stored = t.readonly ? t.readonly.save : t.noVault ? null : t.fullFile ? (t.save ?? null) : storedSave(t);
      if (stored && stored.generator > GENERATOR_VERSION && (t.from === 'stored' || t.from === 'restore')) {
        // 我的世界里的世界是新版存的:这一页按旧规则算出来不是它,存回去还会把它盖掉。等 generate 收完尾再回我的世界
        queueMicrotask(() => {
          if (id === reqId.current) newerBack();
        });
      } else if (stored && stored.generator <= GENERATOR_VERSION) {
        // 新路:读世界仓库。前面几步出什么错、卡住了都退回旧路
        genReq.current = req;
        const rd = t.readonly;
        const fail: LoadBack = rd ? (why) => (why === 'newer' ? newerBack() : generate({ ...rd.draft, noVault: true, vaultBad: true })) : vaultBack;
        void (async () => {
          await openGuardReady();
          if (!vaultAllowed(t.id)) throw new Error('这个世界这一版不走新路');
          const recipe = await recipeKey(recipeOfSave(stored));
          // 这一版还没有原件的:读完存一份(旧路还留着)
          const heads = stored.generator === GENERATOR_VERSION && !t.fullFile ? await atMost(resultHeads(t.id), 2000, null) : null;
          const original = !!heads && !heads.some((h) => h.generator === stored.generator && h.recipe === recipe);
          if (id !== reqId.current) return;
          sendLoad({ vault: { id: t.id, recipe, generator: stored.generator }, ...(original ? { original } : {}) }, stored.generator, fail);
        })().catch(() => {
          if (id === reqId.current) fail('none');
        });
      } else byOriginal(!!t.vaultBad);
      loadedFrozen.current = false;
      // 换世界:改名、干预、选中都属于旧世界,一起作废(先停掉旧世界的自动存,清空不算"改回默认";新世界先按"没有干预、没有地形大事"生成)
      detachWorld();
      leaveStepwise();
      switchNote.current = null;
      resimText.current = null;
      civEdits.current = EMPTY_EDITS.interventions;
      civUps.current = genUps.current = undefined;
      civPlay.current = undefined;
      resimSeq.current++;
      resimInfo.current = null;
      setResim(null);
      // 再推:正在推的不要了,弹层收起,刚推的那段不标,旧世界的「撤销」作废
      extendRef.current = null;
      extendDone.current = null;
      resetExtend();
      dropExtendUndo();
      clearToast('extend-done');
      setPolityPick(null);
      clearEdits();
      clearSelection();
      if (getPeople().polity !== null) setPeople({ polity: null });
      // 正在进行 / 已算好的回放都属于旧世界,一起作废
      setReplay(null);
      setReplayOn(false);
      // 种子、参数写进网址(分享链接时对方看到的是同一个世界);存着的世界带上编号
      writeWorldUrl(t);
    },
    [send],
  );

  useEffect(() => {
    // 邀请链接(invite=):记下邀请码,从网址里去掉(在记第一步之前去掉,按后退时不会再带回来)
    const invited = takeInviteFromUrl();
    // 浏览器的后退、前进:这一页记成第一步,之后每换一个画面记一步(nav.ts)
    const stopNav = startNav(wall ? { page: 'gallery', ...(wall.kind === 'work' ? { id: wall.id } : {}) } : navInfo(route.stage, route.target), {
      route: (to, from, dir) => navRef.current.route(to, from, dir),
      describe: () => navRef.current.describe(),
      settled: () => navRef.current.settled(),
      apply: (l) => navRef.current.apply(l),
      url: keepView,
    });
    // 分享链接:先把 # 那段从地址栏去掉(刷新不会重复导入),解开以后走读档流程;
    // 链接里的种子、参数和网址上的一样,所以照常先按网址生成,不用等
    if (init.share) {
      // own=1:最新版和旧网站之间交过来的自己的世界(看原样、到最新版打开),不说成别人分享的;标记用过就从地址栏去掉
      const q = new URLSearchParams(location.search);
      const own = q.get(OWN_KEY) === '1';
      q.delete(OWN_KEY);
      const rest = `${q}`;
      navUrl(location.pathname + (rest ? `?${rest}` : ''));
      const at = getNav();
      // 解开之前按了后退 / 前进(到了别的画面):不打开
      decodeShare(init.share).then((r) => {
        if (sameScreen(getNav(), at)) openShareRef.current(r, undefined, own);
      });
    }
    // 朋友的预设链接:先把 # 那段从地址栏去掉(刷新不会再来一遍)。短链接后面的"打开时看哪"等取到存档再去掉(没取到、刷新重来时还在)
    if (init.preset) navUrl(location.pathname + location.search);
    if (presetLink) presetOpened(presetLink);
    // 别人分享的规则链接(#rules=…;调规则的入口开着时):在我的世界上面打开调规则的大卡,# 那段从地址栏去掉
    if (openRulesHash(location.hash)) navUrl(location.pathname + location.search);
    // 邀请链接:弹出登录窗(已经登录了就算了)
    if (invited && accountServer() && !getSession()) openLogin();
    if (route.target) generate(route.target);
    else if (landing === 'loading') openShortShare(init.shortShare ?? '');
    // 作品墙:网址换成 ?gallery(=编号)的写法(# 后面写的也换过来);带编号的去取那个作品
    else if (wall) {
      if (wall.kind === 'work') openWork(wall.id);
      else writeGalleryUrl('');
    }
    // 刷新回来的照图新建(new=image)留着,弹窗点了「开始」或「取消」才换掉,再刷新还能回到弹窗
    else if (!route.dialog) writeHomeUrl();
    if (route.gone !== undefined) goneToast(route.gone);
    // 页面开着时又粘贴了一个只有 # 不同的分享链接(浏览器不刷新页面)
    const onHash = () => {
      const h = location.hash;
      // 页面开着时又粘贴了规则链接:就在这一页上面打开调规则的大卡
      if (openRulesHash(h)) {
        navAdopt(navInfo(getStage().stage, targetRef.current));
        navUrl(location.pathname + location.search);
        return;
      }
      // 页面开着时又粘贴了朋友的预设链接:回到我的世界,打开填好参数的新建弹窗
      if (isPresetHash(h)) {
        navAdopt(navInfo(getStage().stage, targetRef.current));
        navUrl(location.pathname + location.search);
        const r = decodePresetHash(h);
        if (r.ok) {
          if (getStage().stage !== 'home') showHomeRef.current();
          // 新开一个弹窗(开着的那个里填的东西不留)
          setNewDlg({ ...presetDialog(r.preset), stamp: performance.now() });
        }
        presetOpened(r);
        return;
      }
      // 页面开着时又贴了作品墙的地址(#gallery、#gallery=<编号>):到作品墙那一页 / 打开那个作品。
      // 浏览器为这个 # 记的那一步直接记成作品墙的,下面换过去时只改这一步(不再多记一步,按一次后退就回到原来的画面)
      const gid = galleryOfUrl(new URLSearchParams(), h);
      if (gid !== null) {
        navAdopt({ page: 'gallery', ...(gid ? { id: gid } : {}) });
        navUrl(location.pathname + location.search);
        if (gid) wallRef.current.open(gid);
        else wallRef.current.list();
        return;
      }
      if (!isShareHash(h)) {
        // 地址栏里自己加了别的 #:浏览器记了一步、这个网站没记过,也记成一步(不然收起卡片退回去时会落到它上面)
        if (!isNavState(history.state)) navAdopt(navInfo(getStage().stage, targetRef.current));
        return;
      }
      // 浏览器为这个 # 记了一步:当成新的一步(打开分享的世界时换成它)
      navAdopt(navInfo(getStage().stage, targetRef.current));
      navUrl(location.pathname + location.search);
      const at = getNav();
      decodeShare(h).then((r) => {
        if (sameScreen(getNav(), at)) openShareRef.current(r);
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      stopNav();
      window.removeEventListener('hashchange', onHash);
    };
    // 只在首次挂载时自动生成;之后由操作触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 地图上这份历史推的时候带的(干预、地形大事、地名风格、推演年数、拓荒起源、逐年推演的进度)和这份修改不一样 = App 里重推的那段要在后台重推。
   * 和那段开头的判断一样(新建中的世界不看年数、拓荒起源、进度);读档时用:要重推的,改名等推完再核对
   */
  const historyBehind = (e: WorldEdits, isDraft: boolean) =>
    !sameInterventions(e.interventions, civEdits.current) ||
    !sameUpheavals(e.upheavals, civUps.current) ||
    !sameMix(e.nameMix, civNames.current) ||
    (!(isDraft && !targetRef.current?.fullCiv) && endParamOf(e) !== civYears.current) ||
    !sameSetup(setupFor(isDraft && !targetRef.current?.fullCiv, e), civSetup.current) ||
    JSON.stringify((isDraft ? undefined : cleanPlay(e.play)) ?? null) !== JSON.stringify(civPlay.current ?? null);
  /**
   * 世界生成完(或要打开的就是正在看的这一个):套上 targetRef 的修改,交给 saveStore 自动存;
   * 核对版本和地形,有问题就提示
   */
  readyRef.current = (world: World, rc: Civ) => {
    lastReady.current = { world, civ: rc };
    const t = targetRef.current;
    if (!t || currentWorld()?.id === t.id) return;
    renameCheck.current = null;
    // 打不开的分享链接(世界还在生成时解开的):现在提示(单独一条,"已恢复"之类的排在它下面,关掉它再露出来)
    const err = shareErr.current;
    shareErr.current = null;
    if (err) showToast({ id: 'share', kind: 'error', text: '打不开这个分享链接', more: [err] });
    /** 提示条上的「看原样」/「到最新版打开」(世界变了样才有,见下面) */
    let act: ToastAction | undefined;
    const say = (n: Parameters<typeof notify>[0]) => n && notify({ ...n, more: n.more?.map((w) => briefWarning(oldSiteNote(w))), action: n.action ?? act });
    const check = worldCheck(world);
    // 投影和中央经线跟着世界存:换成存档里的(旧存档没有 = 等距圆柱、0°)
    if (t.view !== undefined) applyView(t.view ?? undefined);
    // 旧格式的键(r + 州号:GENERATOR_VERSION 2 以前的存档、链接)就地换成按地块的 c 格式,按这一刻的世界解析;
    // 换过的话自动存会写回去(套上的修改和存下的不是同一个对象就会重写)
    const sameT = sameTerrain(t.edits.terrain, genTerrain.current) && sameSketch(t.edits.sketch, genSketch.current);
    const edits = sameT ? upgradeLegacyKeys(t.edits, keySeats(rc.regions)) : t.edits;
    restoredIv.current = edits.interventions;
    restoredUps.current = edits.upheavals;
    // 同一张图换一份修改(打开同种子的另一份存档、分享链接)也算换了世界:正在填的标记、选中的标记作废
    resetMarkUi();
    resetCharacterUi();
    setEdits(edits);
    // 还没存着的旧版本世界(分享链接、旧网址、存不进浏览器的文件):原来那一份跟着(看原样;改了存进来时原样留着)
    const original = t.from === 'url' ? (t.gen !== undefined ? plainSave(world.params, t.gen) : null) : t.from === 'link' || t.from === 'file' ? (t.save ?? null) : null;
    // 读存下的内容打开的:算它的那一版。比现在旧的是照原样打开的旧世界,存档照旧记建它的那一版
    const loadedGen = frozenLoad.current?.id === t.id ? frozenLoad.current.gen : undefined;
    const frozen = loadedGen !== undefined && loadedGen < GENERATOR_VERSION ? loadedGen : undefined;
    frozenLoad.current = null;
    // 旧世界存的内容读不出,这一份是按现在的规则算的:不自动存,存着的内容不动,下次打开再读一次
    const guessed = frozenBroken.current === t.id;
    frozenBroken.current = null;
    // 读存下的内容打开的逐年推演的世界:存的就推到了"现在",不重推,直接停在"现在"
    const fp = civPlay.current;
    if (loadedGen !== undefined && fp && cleanPlay(edits.play)?.year === fp.year) {
      enterStepwise(playFromOf(edits), playAt(fp) / YEAR_TICKS);
      // 存下的就停在推不下去的那一年:不再往下算(点播放再看那张卡)
      if (rc.stuck) stepStuck(playAt(fp) / YEAR_TICKS, rc.stuck.at);
      setCivTime({ year: playAt(fp) / YEAR_TICKS, playing: false, scrubbing: false, story: false });
    }
    // 在旧版本建的世界的地图上打造文明:现在算出来的地图和它不一样,不让打造(这一份还没存,回到我的世界)
    if (t.kind === 'draft' && t.mapCheck && t.mapCheck !== check) {
      targetRef.current = null;
      showHomeRef.current();
      notify({ kind: 'error', text: '没法在这张地图上打造文明', more: [t.mapKept ? '这张地图是旧世界留下的，现在长不出一样的，没法新开' : '这个世界是旧版本做的，地图现在算出来不一样了，没法新开'] });
      return;
    }
    attachWorld({ id: t.id, params: world.params, check, kind: t.kind, title: t.title, saved: t.saved ?? edits, view: t.view ?? undefined, pristine: t.pristine, base: t.base, origin: t.origin, original, frozen, readonly: !!t.readonly || guessed });
    // 新路读的世界换上了:再过一会儿没事就算打开成了(openGuard.ts)。新开的历史还没记地图的,记上
    if (loadedGen !== undefined) openingShown();
    else openingClear();
    if (loadMapSum.current && edits.map && !edits.map.sum && t.kind !== 'visit' && !t.readonly) setMapSum(loadMapSum.current);
    loadMapSum.current = null;
    if (t.kind !== 'draft' && !guessed) setWorldStats(aliveAtEnd(rc));
    // 分享链接带着"这一刻":画面出来、带着的干预和逐年推演的进度重推完以后,停到那一年、选中、镜头飞过去(App 的 pendingMoment);
    // 停在某一年就不再自动播放
    if (t.from === 'link' && t.moment) {
      if (t.moment.year !== undefined) takeAutoplay();
      holdMoment(t.id, t.moment);
    }
    const save = t.save;
    // 刚另存的新版:说一声另存好了(原来那一份照原样留着)
    const copy = savedCopy.current?.id === t.id ? savedCopy.current : null;
    savedCopy.current = null;
    if (copy) {
      // 另存的那份带着要推演的命令时,接着就是"正在重新推演"那条:这条不自动收,推完露出来(右边可以关)
      showToast({ id: 'save', kind: copy.more.length ? 'warn' : 'ok', dot: true, ttl: 0, dismissible: true, text: `已另存为「${t.title ?? ''}」`, more: [copy.line, ...copy.more] });
      if (copy.upheaval) openUpheaval();
      return;
    }
    // 带种子的网址(别人发的普通链接):是旧版本画的就说清现在变了什么
    // 只读打开(上次有改动没推完,网站又更新了):关掉提示条不算放弃,下次打开再说
    if (t.readonly) return pendingToast(t, t.readonly.save, t.readonly.draft.edits);
    if (t.from === 'url') {
      const note = t.gen !== undefined ? versionNote(t.gen, false) : null;
      act = versionAction(t.gen !== undefined ? plainSave(world.params, t.gen) : null);
      if (note) say({ kind: 'warn', text: `已打开「种子 ${world.params.seed}」`, more: [note] });
      return;
    }
    if (!save || !t.from) return;
    // 照原样打开的:读档时"按新版算的…"那句不对了(看到的就是原样)
    const more: string[] = (t.warnings ?? []).filter((w) => frozen === undefined || !w.startsWith(VERSION_NOTE_HEAD));
    // 存的内容读不出、先算了一遍的:明说可能不同。「看原样」不放提示条,手机上放不下这句;「存档」菜单里还有
    if (guessed) more.push(READ_BACK);
    // 照原样打开的:看到的就是原来的样子,不说"变了什么"、不放「看原样」
    const note = frozen !== undefined || guessed ? null : versionNote(save.generator, editedWorld(save.edits));
    // 从文件、分享链接打开的,这句已经在读档的警告里
    if (note && (t.from === 'stored' || t.from === 'restore')) more.push(note);
    // 世界变了样(有"按新版算的"这一句)才放「看原样」;旧网站里来自更新版本的放「到最新版打开」
    if (note && more.includes(note)) act = versionAction(OLD_SITE !== null ? save : currentOriginal());
    // 地形校验只在"生成时带的地形修改就是存档里的"时才核对
    const cw = sameT ? checkWarning(save, check) : null;
    if (cw) more.push(cw);
    // 改名对不上的:这份历史还要按存档里的干预、地形大事、逐年推演的进度等在后台重推时(地图上先出来的是没带它们的),
    // 改名的人物(和别的重推以后才有的)这会儿还没长出来,不在这里数,重推完按推好的历史再核对(renameCheck)
    const later = sameT && Object.keys(edits.names).length > 0 && historyBehind(edits, getStage().stage === 'draft');
    const lost = later ? 0 : lostRenames(rc, edits.names);
    if (lost) more.push(lostRenamesNote(lost));
    // 文明种子是打造文明时定的,不算"修改"
    const n = editCount(save.edits) - (cleanCivSeed(save.edits.civSeed) !== undefined ? 1 : 0);
    const name = save.title || `种子 ${world.params.seed}`;
    // 从 .civworld 打开的世界:文件核对完就想好了要说什么(worldFileFlow.ts),世界画好才说
    const held = takeOpenNote(t.id);
    // 提示条第一行。没有要说的就不提示的:没建完的世界接着建、分享的世界(地图下面那条说明已经讲了)、
    // 从我的世界点开的(看到的就是它)、没改过的;从文件打开的、恢复了上次修改的照样说一声
    const text = held
      ? held.text
      : t.kind === 'draft'
        ? `已打开「${name}」`
        : t.from === 'file'
          ? `已打开存档「${name}」${n ? `(改了 ${n} 处)` : ''}`
          : t.from === 'link'
            ? `已打开分享的世界「${name}」`
            : t.from === 'stored' || guessed || !n
              ? `已打开「${name}」`
              : `已恢复上次的修改(${n} 处)`;
    const always = !!held || (t.kind !== 'draft' && (t.from === 'file' || (t.from !== 'link' && t.from !== 'stored' && n > 0)));
    // 第二行开头那句:从文件打开的说存进「我的世界」了没有
    const kept = t.from === 'file' && !held ? (t.fileKept ??= fileKept(t.id)) : null;
    const lead = held?.more ?? (kept ? [kept.line] : []);
    const warn = more.length > 0 || held?.kind === 'warn' || !!kept?.warn;
    // 重推完核对出对不上的:同一条提示补上那一句(打开时没提示的,这时提示)
    if (later) renameCheck.current = { id: t.id, terrain: genTerrain.current, show: (line) => say({ kind: 'warn', text, more: [...lead, ...more, line], action: held?.action }) };
    // 别的警告要留着等人关,只有这一句才自己收
    const brief = !!note && more.length === 1 && more[0] === note && (t.from === 'stored' || t.from === 'restore') && !lead.length;
    if (more.length || always) say({ kind: warn ? 'warn' : 'ok', text, more: [...lead, ...more], action: held?.action, ...(brief ? { ttl: OK_TTL } : {}) });
  };
  /** 上次有改动没推完的提示条。shown = 现在看到的那一份,draft = 存档里没推完的修改;点「接着推演」问另存还是放弃 */
  const pendingToast = (t: Target, shown: SaveFile, draft: WorldEdits) => {
    const n = recipeChanges(recipeOfSave({ ...shown, edits: draft }), recipeOfSave(shown));
    const title = t.title || `种子 ${t.params.seed}`;
    const drop = () => {
      const r = dropPendingEdits();
      if (r === 'ok') notify({ kind: 'ok', text: `已放弃上次的 ${n} 处改动` });
      else if (r === 'full') notify({ kind: 'error', text: '没能放弃这些改动', more: [storageFullWhy()] });
    };
    const show = () =>
      showToast({
        id: PENDING_TOAST,
        kind: 'warn',
        text: `上次有 ${n} 处改动没推完`,
        more: [`现在看到的是存好的样子，那 ${n} 处还留着`],
        action: {
          label: '接着推演',
          act: 'pending-go',
          // 窗口开着时提示条先收起,取消了再回来
          onClick: () => {
            clearToast(PENDING_TOAST);
            askSaveAsNew({ next: draft, title, count: n, drop, back: show, ...(terrainDiffers(shown.edits, draft) ? { map: 'terrain' as const } : {}) });
          },
        },
      });
    show();
  };
  /** 换成存档里的投影和中央经线(没有 = 等距圆柱、0°;认不出的投影、还没做好的地球仪 = 等距圆柱);存档记了经纬网就换成它的 */
  const applyView = (v: SaveView | undefined) => {
    const want = v?.projection;
    const p: MapProjection = isMapProjection(want) && (want !== 'globe' || GLOBE_READY) ? want : 'equirect';
    const lon = v && Number.isFinite(v.center) ? wrapLon(v.center) : 0;
    if (v?.graticule !== undefined) {
      setGraticule(v.graticule > 0);
      if (isGraticuleStep(v.graticule)) setGraticuleStep(v.graticule);
    }
    if (v?.contours !== undefined) setContourKind(v.contours || null);
    // 先放中心(换投影时按它摆视图),再换投影;等距圆柱再把视图转过去
    publishMapCenter(lon);
    setProjection(p);
    if (!isCurved(p)) requestMapCenter(lon);
  };
  /** 现在这张图(或正在生成的)就是这组参数 + 草图 + 地形修改 */
  const sameGen = (p: WorldParams, terrain: readonly TerrainOp[], sketch: SketchEdit | undefined) =>
    !!genParams.current && worldKey(genParams.current) === worldKey(p) && sameTerrain(terrain, genTerrain.current) && sameSketch(sketch, genSketch.current);
  /**
   * 换到哪一步:新建 / 世界 / 我的世界。进新建时政区、民族换成地形(还没有历史),
   * 离开新建时换回来;选中、概览、改地形属于上一步的,一起收起
   */
  const enterStage = (next: Stage, base: DraftBase | null = null) => {
    const was = getStage().stage;
    if (next !== 'home') closeTrash();
    if (next !== was) {
      clearToast(PENDING_TOAST);
      clearSelection();
      setPolityPick(null);
      closeOverview();
      setTerrainTool({ on: false });
      closeUpheaval();
      setHover(null);
      clearToast('created');
    }
    // 进新建:默认实景(新建界面的开场就是实景;设过「新建时的默认」就是那个样式);原来的图层记下,不建就离开时换回来
    if (next === 'draft' && was !== 'draft') {
      pausePlayback();
      const { base, fill } = mapViewRef.current;
      // 原来就是卫星也记下:新建里换了别的样式、没建就离开,也换回卫星
      draftViewRef.current ??= { base, fill };
      const first = layerParts(getNewView()?.style ?? 'realistic');
      if (base !== first.base || fill !== 'none') applyMapView({ base: first.base, fill: 'none' });
    }
    if (next !== 'draft' && draftViewRef.current) {
      applyMapView(draftViewRef.current);
      draftViewRef.current = null;
    }
    setStage(next, base);
  };
  /**
   * 打开一个世界:要的就是正在看的这一张图(参数、地形都一样,比如从我的世界打开同一个种子的另一份、以它为底稿新建)就不重新生成,
   * 直接换上它的修改;正在生成的就是它:等生成完;否则按它的参数生成
   */
  const openTarget = (t: Target, step: 'push' | 'replace' = 'push') => {
    // 原来那个世界等着截的缩略图先截下来(同 generate)
    flushThumb();
    const info = navInfo(t.kind === 'draft' ? 'draft' : 'world', t);
    if (step === 'push') navTo(info);
    else navReplace(info);
    setWorldSheet('peek');
    enterStage(t.kind === 'draft' ? 'draft' : 'world', t.kind === 'draft' ? (t.base ?? null) : null);
    if (t.kind === 'draft') setDraftTitle(t.title ?? '');
    setParams(t.params);
    // 照原样打开的旧世界和按新版生成的世界参数一样也不是同一个:都重新打开(旧的读原件;正在找原件、读原件的也不接着用)
    if (sameGen(t.params, t.edits.terrain, t.edits.sketch) && !loadedFrozen.current && !genReq.current && !oldStored(t) && !keptMapOf(t.edits)) {
      if (fresh.current) {
        targetRef.current = t;
        writeWorldUrl(t);
        return;
      }
      const last = lastReady.current;
      if (!regenRef.current && last && rawRef.current) {
        detachWorld();
        leaveStepwise();
        targetRef.current = t;
        readyRef.current(last.world, rawRef.current);
        writeWorldUrl(t);
        return;
      }
    }
    generate(t);
  };
  /** 打开"我的世界"里的一个(没建完的回到新建) */
  const openStored = (id: string) => {
    const w = loadWorld(id);
    if (!w) {
      if (!isStored(id)) return notify({ kind: 'error', text: '打不开这个存档', more: ['可能已在别的页面里删掉了'] });
      // 存着,这次读不出来:不是删掉了
      showToast({ id: TROUBLE_TOAST, kind: 'error', text: '打不开这个世界', more: [READ_TROUBLE], action: { label: '再试一次', act: 'open-again', onClick: () => openStoredRef.current(id) } });
      return;
    }
    // 只存了地图的:不当世界打开,在我的世界的「地图」页签里选中它
    if (w.map) {
      showMapInWorlds(id);
      if (getStage().stage !== 'home') showHome();
      return;
    }
    navTo({ page: w.draft ? 'draft' : 'world', id, seed: w.draft ? w.save.params.seed : undefined, title: w.save.title });
    // 下面一直开着的就是它、存的和开着的一样(没在别的页面里改过):不用重新打开
    const cur = currentWorld();
    const same =
      !!cur &&
      (cur.kind === 'draft') === w.draft &&
      worldKey(cur.params) === worldKey(w.save.params) &&
      (cur.title ?? '') === (w.save.title ?? '') &&
      sameOrigin(cur.origin, w.save.origin) &&
      JSON.stringify(getEdits()) === JSON.stringify(w.save.edits) &&
      // 只读打开的(看的不是存档里的那份)再点开要重新读一次
      !cur.readonly &&
      // 版本也得一样:开着的是照原样读的旧世界,存着的也得还是那一版;别的页面里换成了别的版本的存档(新版的、旧版的)= 重新打开
      (cur.frozen === undefined || cur.frozen === w.save.generator) &&
      (cur.wrote == null || genOfText(cur.wrote) === w.save.generator);
    if (cur?.id === id && targetRef.current?.id === id && same) {
      markOpened(id);
      // 打开的文件就是正开着的这个世界:没有"画好"那一步,这时就说
      const held = takeOpenNote(id);
      if (held) notify(held);
      enterStage(w.draft ? 'draft' : 'world', w.draft ? (w.base ?? null) : null);
      if (w.draft) setDraftTitle(w.save.title ?? '');
      writeWorldUrl(targetRef.current);
      return;
    }
    openTarget(storedTarget(w, 'stored'));
  };
  /** 从文件打开:存进"我的世界"(算建好的),再打开它;存不下就只打开、不存。「全部存成文件」存的:全部放回我的世界,不打开 */
  const openText = (text: string, fileName?: string) => {
    if (openBundleText(text, fileName)) return;
    // 一套规则的文件(调规则的入口开着时):打开调规则的大卡(只能看),不当世界的存档
    if (openRulesText(text, fileName)) return;
    const r = parseSave(text);
    if (!r.ok) {
      notify({ kind: 'error', text: fileName ? `打不开 ${fileName}` : '打不开这个存档', ...fileTrouble(r.error) });
      return;
    }
    // 世界文件存不进浏览器才走到这里的:只打开、不存。importSave 认出同一个世界时会改写本机那一份,这种文件不能让它碰
    const trouble = takeFileTrouble();
    const before = storedCount();
    const id = trouble ? null : importSave(r.save);
    const added = !!id && storedCount() > before;
    if (id && added) markFromFile(id);
    const w = id ? loadWorld(id) : null;
    const t: Target = w
      ? { ...storedTarget(w, 'stored'), view: r.save.view ?? null }
      : { id: newWorldId(), kind: 'visit', params: r.save.params, edits: r.save.edits, title: r.save.title, view: r.save.view ?? null, save: r.save, origin: r.save.origin ?? null };
    openTarget({ ...t, from: 'file', save: r.save, warnings: r.warnings, ...(added ? { fileNew: true as const } : {}), ...(trouble ? { fileKept: { line: trouble, warn: true } } : {}) });
  };
  /**
   * 打开分享链接(解开以后):别人的世界,先不存;改了(或起了名)才存进"我的世界"。
   * 短链接(short):改了另存时写明底稿出处(署名、这时的世界名、这个链接);长链接里没有分享人,不写。
   * own:最新版和旧网站之间交过来的自己的世界:最新版里不出"别人分享给你的世界"那条说明(旧网站上那条换成旧网站的说法,照常出)
   */
  const openShare = (r: ParseResult, short?: { code: string; by?: string; moment?: SaveMoment | null; fullId?: string }, own = false) => {
    if (!r.ok) {
      const msg = briefError(r.error);
      // 世界还在生成:等生成完再说(生成时提示条上是进度)
      if (currentWorld()) showToast({ id: 'share', kind: 'error', text: '打不开这个分享链接', more: [msg] });
      else shareErr.current = msg;
      return;
    }
    const sv = r.save;
    const id = short?.fullId ?? newWorldId();
    const by = short ? cleanSignature(short.by) : '';
    setSharedFor(own && OLD_SITE === null ? null : { id, short: !!short, by, own });
    setSharedView(short ? { worldId: id, code: short.code, by, title: sv.title ?? '' } : null);
    const origin: SaveOrigin | null = short ? { ...(by ? { by } : {}), title: sv.title ?? '', url: shortLink(short.code) } : null;
    // 打开网页时、地址栏里贴的分享链接:浏览器已经记了这一步,换成这个世界
    // 打开时看哪:长链接在存档里(读档时清理过);短链接在链接的 # 后面,按取到的存档再清理一次(年份超出这个世界的历史就不要)
    const moment = sv.moment ?? (short?.moment ? cleanMoment(short.moment, momentYearMax(sv.edits)) : null);
    openTarget({ id, kind: 'visit', params: sv.params, edits: sv.edits, saved: sv.edits, title: sv.title, view: sv.view ?? null, from: 'link', save: sv, warnings: r.warnings, shareCode: short?.code, origin, moment, ...(short?.fullId ? { fullFile: true as const } : {}) }, 'replace');
  };
  /** 分享短链接:去服务器取存档(不用登录);停了、打不开就显示那一页 */
  const openShortShare = (code: string, still?: () => boolean) => {
    if (!accountServer() || !SHARE_CODE_RE.test(code)) return setLanding('gone');
    showToast({ id: 'share', kind: 'progress', text: '正在打开分享的世界' });
    openShareCode(code)
      .then(async (r) => {
        // 按后退 / 前进取的:取回来之前又换到了别的画面,不打开(提示条那边换画面时已经收掉了)
        if (still && !still()) return;
        // 传过整个世界的:取那一份,配方也用文件里的(作者之后又改过时,对方看到的、另存的都是传上去那份)
        const got = r.full ? await import('../fullWorldPull').then((m) => m.pullShared(code, r.full!.bytes, (done, total) => {
          if (!still || still()) showToast({ id: 'share', kind: 'progress', text: '正在打开分享的世界', more: [`有 ${sizeText(total)}，已经取到 ${sizeText(done)}`], ...(total ? { progress: done / total } : {}) });
        })) : null;
        if (still && !still()) return;
        clearToast('share');
        const p = parseSave(JSON.stringify(got ? got.save : r.save));
        if (!p.ok) return setLanding({ error: briefError(p.error) });
        setLanding(null);
        // 短链接后面带的"打开时看哪"只在打开网页时那一次用(按后退、前进再取的照平常打开);用了就从地址栏去掉
        const moment = shortMoment.current;
        shortMoment.current = null;
        if (moment && isMomentHash(location.hash)) navUrl(location.pathname + location.search);
        openShareRef.current(p, { code, by: r.by, moment, ...(got ? { fullId: got.id } : {}) });
      })
      .catch((e) => {
        if (still && !still()) return;
        clearToast('share');
        if (e instanceof ServerError && e.code === 'share-paused') setLanding('paused');
        else if (e instanceof ServerError && (e.code === 'share-gone' || e.code === 'not-found')) setLanding(e.data.stoppedBy === 'site' ? 'site' : 'gone');
        else setLanding({ error: e instanceof ServerError && e.code === 'network' ? '连不上服务器，请检查网络后刷新再试。' : e instanceof Error ? e.message : String(e) });
      });
  };
  const openShareRef = useRef(openShare);
  openShareRef.current = openShare;
  const openStoredRef = useRef(openStored);
  openStoredRef.current = openStored;
  /** 打开网页时短链接后面带的"打开时看哪"(取到存档时用掉) */
  const shortMoment = useRef<SaveMoment | null>(init.moment);
  /** 朋友的预设链接解开以后:选上分享来的那一套(不存);打不开的说一声(照常停在我的世界),有个别参数不对的也说一声 */
  const presetOpened = (r: PresetLinkResult) => {
    if (!r.ok) return notify({ kind: 'error', text: '打不开这个预设链接', more: [r.error] });
    pickSharedPreset(r.preset);
    if (r.warnings.length) notify({ kind: 'warn', text: `已打开朋友分享的预设「${r.preset.name}」`, more: r.warnings });
  };

  return { generate, enterStage, openTarget, openStored, openText, openShortShare };
}
