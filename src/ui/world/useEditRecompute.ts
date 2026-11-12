/**
 * 改了地形、干预以后在后台重算(App 用):
 *   - 地形修改、草图一变:带着新地形重新生成世界(连同当时的干预重推文明;州、历史整个重来,改名和干预按稳定键尽量套上)
 *   - 编辑地形时不起名:收起编辑地形以后补推历史、起地名(startNames / releaseNames / namesDone)
 *   - 干预列表、地形大事、地名风格、推演年数、拓荒起源、逐年推演的进度一变:带着新的重推文明(地形不动)
 *   - 线程交回按新地形生成好的世界(terrainDoneRef);检查脚本读的历史摘要和两种测时
 * 界面的状态还在 App 里,要读、要改的 ref 和 setter 由 App 按块传进来(ref 分块见 ./worldRefs.ts);
 * 每次渲染照原来那样新建函数、填 ref 的 .current,交回给 App 的是线程回调要用的 namesDoneRef、terrainDoneRef 和收起编辑地形时调的 releaseNames
 */
import { systemOpt } from '../../gen/systemState';
import { useEffect, useRef } from 'react';
import type { WorkerRequest } from '../../worker';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import { END_YEAR_DEFAULT, cleanPlay, endParamOf, keptMapOf, resolveKey, sameInterventions, type TerrainOp, type WorldEdits } from '../../gen/edits';
import { sameSketch, type SketchEdit } from '../../gen/sketch';
import { sameTerrain, sameUpheavals } from '../../gen/terrainEdits';
import { sameMix } from '../../gen/names/mix';
import { multisetDiff } from '../../gen/util';
import { worldCheck } from '../../gen/savefile';
import { interventionOutcome } from '../../gen/civ/story/chronicle';
import { clearChroniclePick, clearSelection, getChronicle, setChronicle } from '../civView';
import { getEdits } from '../editsStore';
import { getPeople, setPeople } from '../overviewStore';
import { getStage } from '../stageStore';
import { getTerrainTool, type TerrainStatus } from '../TerrainTools';
import { noteExtendSpeed } from '../extendStore';
import { setPolityPick } from '../Interventions';
import { setThumbEditing, updateCheck } from '../saveStore';
import { showToast } from '../Toast';
import { takeCrownResim } from '../crownInfo';
import { takePendingBatch } from '../pendingStore';
import { takeRewriteNote, type RewriteNote } from '../rewriteStore';
import { namesOpt, sameSetup, setupFor, setupOpt, upsOpt, yearsFor, yearsOpt } from './worldTarget';
import type { CivRefs, GenRefs, MapRefs, Ref, ResimRefs, Setter } from './worldRefs';
import { noteStuck } from '../stuckStore';

/** useEditRecompute 要的 App 状态 */
export interface EditRecomputeDeps {
  send: (req: WorkerRequest) => void;
  gen: Pick<GenRefs, 'reqId' | 'genParams' | 'genTerrain' | 'genSketch' | 'fresh' | 'regenRef' | 'baseKeyRef' | 'lastReady' | 'setProgress'>;
  civ: Pick<CivRefs, 'civEdits' | 'civUps' | 'genUps' | 'civNames' | 'civYears' | 'civSetup' | 'civPlay' | 'civLater' | 'civMsLast' | 'setRawCiv'>;
  map: Pick<MapRefs, 'baseRef' | 'eraPatches'>;
  resim: Pick<ResimRefs, 'resimSeq' | 'resimInfo' | 'setResim' | 'resimText' | 'restoredIv' | 'restoredUps'>;
  /** 编辑地形那边的:不起名的这一段、补推历史起地名、按新地形重新生成的结果 */
  terrain: {
    namesHold: Ref<{ tip: boolean } | null>;
    setNamesHeld: Setter<boolean>;
    naming: Ref<{ nid: number; t0: number } | null>;
    namingSeq: Ref<number>;
    setNamingPct: Setter<number | null>;
    setNamesIn: Setter<number>;
    holdTip: Ref<boolean>;
    regenNote: Ref<RewriteNote | null>;
    setShownTerrain: Setter<readonly TerrainOp[]>;
    setShownSketch: Setter<SketchEdit | undefined>;
    setTerrainStatus: Setter<TerrainStatus>;
  };
  /** 这次渲染的:修改、是不是新建中、地图上的世界(没套年代 / 套了年代的)、地图上这份历史、编辑地形开没开 */
  now: {
    edits: WorldEdits;
    draft: boolean;
    /** 新建中、不带整段历史(推演年数、拓荒起源一律按默认) */
    plainDraft: () => boolean;
    baseData: { world: World; raster: Raster } | null;
    data: object | null;
    rawCiv: Civ | null;
    terrainTool: { on: boolean };
  };
  /** 回放(按新地形重新生成时收起) */
  page: { setReplay: (r: null) => void; setReplayOn: Setter<boolean> };
}

export function useEditRecompute(deps: EditRecomputeDeps) {
  const { send } = deps;
  const { reqId, genParams, genTerrain, genSketch, fresh, regenRef, baseKeyRef, lastReady, setProgress } = deps.gen;
  const { civEdits, civUps, genUps, civNames, civYears, civSetup, civPlay, civLater, civMsLast, setRawCiv } = deps.civ;
  const { baseRef, eraPatches } = deps.map;
  const { resimSeq, resimInfo, setResim, resimText, restoredIv, restoredUps } = deps.resim;
  const { namesHold, setNamesHeld, naming, namingSeq, setNamingPct, setNamesIn, holdTip, regenNote, setShownTerrain, setShownSketch, setTerrainStatus } = deps.terrain;
  const { edits, draft, plainDraft, baseData, data, rawCiv, terrainTool } = deps.now;
  const { setReplay, setReplayOn } = deps.page;
  // 改地形(阶段 4):地形修改、草图一变,就在后台带着新地形重新生成世界(连同当时的干预重推文明;
  // 州、历史整个重来,改名和干预按稳定键尽量套上)。写在干预的前面:同时变了的话,干预跟着这次生成一起推
  useEffect(() => {
    const t = edits.terrain;
    const sk = edits.sketch;
    if (!baseData || !genParams.current || fresh.current || (sameTerrain(t, genTerrain.current) && sameSketch(sk, genSketch.current))) return;
    // 地图留着的世界不重新长(修改到不了这里,editsStore 的 historyGate 已经拦下;这里再防一道)
    if (keptMapOf(edits)) return;
    const id = ++reqId.current;
    const interventions = getEdits().interventions;
    const ups = getEdits().upheavals;
    // 编辑地形时不起名(namesHold):新建世界里开着编辑地形涂了一笔,就进这一段,地图上的地名先收起来;
    // 这一段里只换地形、不推历史(照手绘图新建换了张图长出星球不算一笔)
    const img = (s?: SketchEdit) => (s?.image ? `${s.image.name}
${s.image.cells}` : null);
    if (!namesHold.current && getTerrainTool().on && getStage().stage === 'draft' && img(sk) === img(genSketch.current)) {
      namesHold.current = { tip: false };
      setNamesHeld(true);
    }
    const skipCiv = !!namesHold.current;
    // 正在补推的历史是上一个地形的:作废(线程那边被新的生成顶掉)
    if (naming.current) {
      naming.current = null;
      setNamingPct(null);
    }
    genTerrain.current = t;
    genSketch.current = sk;
    civEdits.current = interventions;
    civUps.current = genUps.current = ups;
    civNames.current = getEdits().nameMix;
    civYears.current = yearsFor(plainDraft(), getEdits());
    civSetup.current = setupFor(plainDraft(), getEdits());
    resimSeq.current++;
    resimInfo.current = null;
    setResim(null);
    regenRef.current = { id, t0: performance.now(), terrain: t, sketch: sk };
    regenNote.current = takeRewriteNote(getEdits());
    setTerrainStatus((s) => ({ ...s, busy: true }));
    setProgress({ stage: '准备', pct: 0, regen: true });
    // 回放、选中、编年史和人物页的国家筛选都属于旧地形上的历史
    setReplay(null);
    setReplayOn(false);
    clearSelection();
    setPolityPick(null);
    clearChroniclePick();
    if (getChronicle().polity !== null) setChronicle({ polity: null });
    if (getPeople().polity !== null) setPeople({ polity: null });
    // 线程还留着地图上那张整图(baseKeyRef):只重铺、只交回变了的那块
    send({ type: 'generate', id, params: genParams.current, scale: 1, terrain: [...t], sketch: sk, ...systemOpt(), interventions: [...interventions], ...upsOpt(ups), ...namesOpt(civNames.current), ...yearsOpt(civYears.current), ...setupOpt(civSetup.current), keep: getStage().stage === 'draft', ...(baseKeyRef.current ? { from: baseKeyRef.current } : {}), ...(skipCiv ? { skipCiv: true as const } : {}) });
  }, [edits.terrain, edits.sketch, baseData, send]);

  /** 补推地图上这个世界的历史、起地名(编辑地形时生成的没推历史):带着和生成时一样的干预、地形大事、地名风格、推演年数、拓荒、起源 */
  const startNames = () => {
    const p = genParams.current;
    if (!civLater.current || naming.current || fresh.current || !p) return;
    const nid = ++namingSeq.current;
    naming.current = { nid, t0: performance.now() };
    setNamingPct(0);
    send({ type: 'civOnly', id: reqId.current, nid, params: p, ...systemOpt(), terrain: [...genTerrain.current], sketch: genSketch.current, interventions: [...civEdits.current], ...upsOpt(civUps.current), ...namesOpt(civNames.current), ...yearsOpt(civYears.current), ...setupOpt(civSetup.current) });
  };
  const startNamesRef = useRef(startNames);
  startNamesRef.current = startNames;
  /** 收起编辑地形(点「完成」……):不起名的这一段结束,地图上的世界没推历史就补推、起地名 */
  const releaseNames = () => {
    if (!namesHold.current) return;
    namesHold.current = null;
    // 还在按新地形重新生成:换上以后接着补推(terrainDoneRef);这期间地图上还是涂之前的历史,照旧不标地名
    const rg = regenRef.current;
    if (rg && rg.arrived === undefined) return;
    setNamesHeld(false);
    startNames();
  };
  const releaseNamesRef = useRef(releaseNames);
  releaseNamesRef.current = releaseNames;
  useEffect(() => {
    // 存档缩略图:编辑地形开着时连着涂不截,收起时等着的那一张不再等
    setThumbEditing(terrainTool.on);
    if (!terrainTool.on) releaseNamesRef.current();
  }, [terrainTool.on]);
  /** 补推好了:换上(地名淡入);对不上的改名、没生效的干预(以别的世界为底稿新建时带着的)照旧说一句 */
  const namesDone = (nid: number, civ: Civ, civMs: number) => {
    if (naming.current?.nid !== nid) return;
    naming.current = null;
    civLater.current = false;
    civMsLast.current = civMs;
    noteExtendSpeed(0, civ.endYear, civMs);
    const b = baseRef.current;
    lastReady.current = b ? { world: b.world, civ } : null;
    setRawCiv(civ);
    noteStuck(!!civ.stuck, { kind: 'new' });
    setNamingPct(null);
    setNamesIn(nid);
    const e = getEdits();
    const lostNames = Object.keys(e.names).filter((k) => !resolveKey(civ, k)).length;
    const lostInterventions = (civ.interventions ?? []).filter((_, i) => !interventionOutcome(civ, i).ok).length;
    const lost = [lostNames ? `${lostNames} 处改名` : '', lostInterventions ? `${lostInterventions} 条干预` : ''].filter(Boolean);
    if (lost.length) showToast({ id: 'terrain', kind: 'warn', text: '已按新地形重新生成', more: [`${lost.join('、')}暂未生效`] });
  };
  const namesDoneRef = useRef(namesDone);
  namesDoneRef.current = namesDone;

  // 干预(阶段 4)、地形大事:干预列表或地形大事一变,就在后台带着新的重推文明(地形不动;变了的那一年以前和原来一样)
  useEffect(() => {
    const list = edits.interventions;
    const ups = edits.upheavals;
    const names = edits.nameMix;
    // 地名风格:生成新世界时已经带着(修改先清空、生成完再套上,这期间不算变了);新建时换了风格,只重推、重新起名
    const sameNames = fresh.current || sameMix(names, civNames.current);
    // 推演年数:新建中的世界一律先推 3000 年(不因为调了年数重推);创建以后按世界自己的年数,和推好的不一样就接着推
    // (照故事找世界选中的结果:新建中也按自己的推演年数、拓荒、起源、天灾推,和搜的时候一样)
    const plain = plainDraft();
    const endYear = plain ? civYears.current : endParamOf(edits);
    const sameYears = fresh.current || endYear === civYears.current;
    // 拓荒、起源、天灾、规则:同推演年数,新建中的世界一律按默认推;创建以后按世界自己的,整段历史从第 0 年重推(文明种子新建中就照它推)
    const setup = setupFor(plain, edits);
    const sameSet = fresh.current || sameSetup(setup, civSetup.current);
    // 逐年推演的进度:打开逐年推演的世界、开始逐年推演时按它推到"现在";一步步走的时候进度和推好的那份一样,不重推
    const play = draft ? undefined : cleanPlay(edits.play);
    const samePlay = fresh.current || JSON.stringify(play ?? null) === JSON.stringify(civPlay.current ?? null);
    if (!baseData || !genParams.current || (sameInterventions(list, civEdits.current) && sameUpheavals(ups, civUps.current) && sameNames && sameYears && sameSet && samePlay)) return;
    if (!sameTerrain(getEdits().terrain, genTerrain.current) || !sameSketch(getEdits().sketch, genSketch.current)) return; // 等改地形那次生成一起推
    // 从哪一年起变:新加的 / 删掉的干预、地形大事里最早的那一年(重推完时间轴停在这里)
    const before = civEdits.current;
    const d = multisetDiff(list, before);
    const changed = [...d.added, ...d.removed];
    const upBefore = civUps.current ?? [];
    const upNow = ups ?? [];
    const ud = multisetDiff(upNow, upBefore);
    const upChanged = [...ud.added, ...ud.removed];
    const years = [...(changed.length || upChanged.length ? changed : list).map((v) => Math.floor(v.from)), ...upChanged.map((u) => u.year)].filter((y) => Number.isFinite(y));
    // 只换了推演年数:从原来和现在的结束年份里早的那一年起变(之前的历史不变)
    const oldEnd = civYears.current ?? END_YEAR_DEFAULT;
    const newEnd = endYear ?? END_YEAR_DEFAULT;
    const yearsOnly = !sameYears && sameSet && !changed.length && !upChanged.length && sameInterventions(list, before) && sameUpheavals(ups, civUps.current);
    // 只换了拓荒、起源(创建世界那一刻):从第 0 年起都变了
    const setupOnly = !sameSet && !changed.length && !upChanged.length && sameInterventions(list, before) && sameUpheavals(ups, civUps.current);
    const year = !sameSet ? 0 : yearsOnly ? Math.min(oldEnd, newEnd) : years.length ? Math.max(0, Math.min(...years)) : 0;
    // 只换了地名风格(或推演年数):历史不变,不提示、不跳时间
    const namesOnly = !changed.length && !upChanged.length && sameInterventions(list, before) && sameUpheavals(ups, civUps.current);
    civEdits.current = list;
    civUps.current = ups;
    if (!fresh.current) civNames.current = names;
    if (!fresh.current) civYears.current = endYear;
    if (!fresh.current) civSetup.current = setup;
    if (!fresh.current) civPlay.current = play;
    // 地图上这个世界还没推历史(编辑地形时生成的):不重推,补推时带着新的一起推(正在补推的这就按新的重来)
    if (civLater.current) {
      const rg = regenRef.current;
      if (namesHold.current || (rg && rg.arrived === undefined)) return;
      naming.current = null;
      startNamesRef.current();
      return;
    }
    const seq = ++resimSeq.current;
    // 只多了一条 = 新下的干预 / 新加的大事;只少了一条 = 撤销(读档、自动恢复套上的不算,不提示)
    const quiet = namesOnly || (list === restoredIv.current && ups === restoredUps.current);
    const one = changed.length + upChanged.length === 1;
    const added = !quiet && one && list.length === before.length + 1 ? changed[0] : undefined;
    const removed = !quiet && one && list.length === before.length - 1 ? changed[0] : undefined;
    const upAdded = !quiet && one && upNow.length === upBefore.length + 1 ? upChanged[0] : undefined;
    const upRemoved = !quiet && one && upNow.length === upBefore.length - 1 ? upChanged[0] : undefined;
    const note = takeRewriteNote(getEdits()) ?? undefined;
    const crown = takeCrownResim(getEdits()) ?? undefined;
    // 待推演的单子一次加了几条(pendingStore 记着真加上了的那几条)
    const pushed = takePendingBatch(getEdits());
    const batch = !quiet && !note && pushed && pushed.ivs.length + pushed.ups.length > 1 ? pushed : undefined;
    // 逐年推演:推到"现在"就停(提示条上写推到哪一年);别的照旧
    const stepOnly = !!play && !samePlay && sameInterventions(list, before) && sameUpheavals(ups, civUps.current);
    resimInfo.current = {
      seq,
      year: stepOnly ? 0 : year,
      t0: performance.now(),
      ...(crown ? { crown } : { added, removed, upAdded, upRemoved, batch }),
      left: list.length + upNow.length,
      quiet: quiet || stepOnly,
      note,
      years: yearsOnly || setupOnly,
    };
    // 切支线:提示条写切到哪一支(只用这一次)
    const text = stepOnly && resimText.current ? resimText.current : undefined;
    resimText.current = null;
    setResim({ year: stepOnly ? 0 : year, end: play ? play.year : newEnd, ...(text ? { text } : {}) });
    send({
      type: 'resim',
      ...systemOpt(),
      id: reqId.current,
      seq,
      params: genParams.current,
      terrain: [...genTerrain.current],
      sketch: genSketch.current,
      interventions: list,
      ...upsOpt(ups),
      ...namesOpt(civNames.current),
      ...yearsOpt(civYears.current),
      ...setupOpt(civSetup.current),
      ...(play ? { play } : {}),
      have: [...eraPatches.current.keys()],
    });
  }, [edits.interventions, edits.upheavals, edits.nameMix, edits.endYear, edits.endTick, edits.frontier, edits.origins, edits.civSeed, edits.calamity, edits.rules, edits.play, draft, baseData, send]);
  // 地图上这份历史的摘要(检查脚本对比逐年推演、存回推演模式以后是不是同一段历史用):before 年以前的史事条数和指纹、立过几国
  useEffect(() => {
    const c = rawCiv;
    (window as unknown as { __wfCivSum: unknown }).__wfCivSum = (before: number) => {
      if (!c) return null;
      const a = c.annals.filter((x) => x.year < before);
      const s = JSON.stringify(a);
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return { endYear: c.endYear, annals: a.length, hash: h, polities: c.polities.filter((p) => p.founded < before).length };
    };
  }, [rawCiv]);
  // 重推的文明画到地图上以后,记下"从下命令到地图更新"用了多久(冒烟检查用)
  useEffect(() => {
    const info = resimInfo.current;
    if (!info || info.arrived === undefined || !rawCiv) return;
    const drawn = performance.now() - info.t0;
    requestAnimationFrame(() => {
      (window as unknown as { __wfResim: unknown }).__wfResim = {
        seq: info.seq,
        year: info.year,
        workerMs: info.workerMs,
        arrivedMs: info.arrived,
        drawnMs: drawn,
        paintedMs: performance.now() - info.t0,
      };
    });
    resimInfo.current = null;
  }, [rawCiv]);

  /**
   * 按新地形重新生成完(阶段 4 改地形):记下新的地形校验(自动存的存档跟着改);
   * 数一数改名、干预有几处在新历史里对不上(面板里提示"暂未生效")
   */
  const terrainDoneRef = useRef<(world: World, civ: Civ | null, ms: number) => void>(() => {});
  terrainDoneRef.current = (world: World, rc: Civ | null, ms: number) => {
    const rg = regenRef.current;
    if (!rg) return;
    rg.workerMs = ms;
    rg.arrived = performance.now() - rg.t0;
    // 没推历史的(编辑地形时不起名):补推完再记
    lastReady.current = rc ? { world, civ: rc } : null;
    setShownTerrain(rg.terrain);
    setShownSketch(rg.sketch);
    const e = getEdits();
    if (sameTerrain(e.terrain, rg.terrain) && sameSketch(e.sketch, rg.sketch)) updateCheck(worldCheck(world));
    const lostNames = rc ? Object.keys(e.names).filter((k) => !resolveKey(rc, k)).length : 0;
    // 干预:和世界概览"我的干预"页一个口径(这份历史带着哪些干预推的、哪几条没生效,见 chronicle.ts 的 interventionOutcome)
    const lostInterventions = rc ? (rc.interventions ?? []).filter((_, i) => !interventionOutcome(rc, i).ok).length : 0;
    // 不起名的这一段里第一笔换上:提示条多一行"地名等点「完成」以后再起"
    const hold = namesHold.current;
    holdTip.current = !rc && !!hold && !hold.tip;
    if (hold && !rc) hold.tip = true;
    setTerrainStatus({ busy: false, last: { ms: rg.arrived, lostNames, lostInterventions } });
    // 编辑地形已经收起了(还没换上就点了「完成」):地图上可以标地名了;没推历史的接着补推
    if (!hold) {
      setNamesHeld(false);
      if (!rc) startNamesRef.current();
    }
  };
  // 重新生成的世界画到地图上以后,记下"从改地形到地图更新"用了多久(冒烟检查用)
  useEffect(() => {
    const rg = regenRef.current;
    if (!rg || rg.arrived === undefined || !data) return;
    const drawn = performance.now() - rg.t0;
    requestAnimationFrame(() => {
      (window as unknown as { __wfTerrain: unknown }).__wfTerrain = {
        id: rg.id,
        ops: rg.terrain.length,
        workerMs: rg.workerMs,
        arrivedMs: rg.arrived,
        drawnMs: drawn,
        paintedMs: performance.now() - rg.t0,
        gotMs: rg.got,
        rasterMs: rg.rasterMs,
        shownMs: rg.shown,
        patch: rg.patch,
      };
    });
    regenRef.current = null;
  }, [data]);
  return { releaseNames, namesDoneRef, terrainDoneRef };
}
