/**
 * 界面上要交给后台线程算的几种操作,接到线程上(App 用;线程客户端见 ./simClient.ts,算完交回的结果怎么换上界面见 ./useSimResults.ts):
 *   - useSimRunners:助手的试推演、逐年推演(算一步、从某一年开始、存回推演模式、重新演绎、切支线)、地形大事的"会怎么样"
 *   - useExtendOutlineRunners:「再推」「照大纲推演」
 * 都是把处理函数登记到各自的 store(setTrialRunner、setStepwiseActions、setUpRunner、setExtendRunner、setOutlineRunner),卸下时撤掉。
 * 分成两个 hook,App 里各自在原来的位置调(useSimResults 的前、后),effect 的先后和原来一样。
 * 登记只在 send 换了时重做(send 跟着线程客户端,一直不换):处理函数里读的是 ref、store 和第一次渲染时传进来的函数,和原来写在 App 里一样。
 * 界面的状态还在 App 里,要读、要改的 ref 由 App 按块传进来(ref 分块见 ../world/worldRefs.ts)
 */
import { systemOpt } from '../../gen/systemState';
import { useEffect } from 'react';
import type { WorkerRequest } from '../../worker';
import type { Civ } from '../../gen/civ/types';
import { YEAR_TICKS, cleanAdvance, cleanPlay, commandsNow, endFields, extendedEndYear, issueCommands, momentAt, ownInterventions, playAt, playFromOf, writtenEndAt, type WorldEdits } from '../../gen/edits';
import { branchList, rewindBranch, startStepwise, switchBranch } from '../../gen/stepwise';
import { sameUpheavals } from '../../gen/terrainEdits';
import { spaced, yearAt } from '../../gen/era';
import { SAVE_SUFFIX } from '../StepwiseDialogs';
import { branchNote, branchRef } from '../StepBranches';
import { branchSwitching, enterStepwise, getStepwise, rewoundTo, saveBackEdits, setStepwiseActions, stepStuck, subscribeStepwise } from '../stepwiseStore';
import { currentWorld, isStored, listWorlds, nextTitle, notify, overwriteWorld, saveCurrentAs, stepOrigin, storageFullWhy } from '../saveStore';
import { askHistory, getEdits, putEditsQuiet } from '../editsStore';
import { getPending, removePending } from '../pendingStore';
import { reuseRegions } from '../eras';
import { getCivTime, setCivTime } from '../civView';
import { setTrialRunner } from '../assistantStore';
import { setUpRunner } from '../upheavalStore';
import { getExtend, setExtendBusy, setExtendFresh, setExtendRunner } from '../extendStore';
import { setOutlineRunner } from '../outlineStore';
import { clearToast, showToast } from '../Toast';
import { namesOpt, setupOpt, upsOpt, yearsOpt } from '../world/worldTarget';
import type { CivRefs, GenRefs, MapRefs, Ref, ResimRefs } from '../world/worldRefs';
import type { SimClient } from './simClient';
import { switchedToast, type OutlineJob, type SwitchNote, type useSimResults } from './useSimResults';

type SimResults = ReturnType<typeof useSimResults>;

/** useSimRunners 要的 App 状态 */
export interface SimRunnersDeps {
  sim: SimClient;
  send: (req: WorkerRequest) => void;
  gen: Pick<GenRefs, 'reqId' | 'genParams' | 'genTerrain' | 'genSketch' | 'fresh' | 'regenRef' | 'rawRef'>;
  civ: Pick<CivRefs, 'civEdits' | 'civUps' | 'rawUps' | 'civNames' | 'civYears' | 'civSetup' | 'civPlay'>;
  resim: Pick<ResimRefs, 'resimInfo' | 'resimText' | 'switchNote' | 'stepAuto'> & {
    /** 重新演绎回到的那一年(换上历史以后停在那里) */
    rewindNote: Ref<{ year: number } | null>;
  };
  /** App 后面才有的(打开存着的世界在 ../world/useWorldPages.ts):调的时候才取 */
  later: { openStored: (id: string) => void };
}

/** 助手的试推演、逐年推演、地形大事的"会怎么样":接到后台线程上 */
export function useSimRunners(deps: SimRunnersDeps): void {
  const { sim, send } = deps;
  const { reqId, genParams, genTerrain, genSketch, fresh, regenRef, rawRef } = deps.gen;
  const { civEdits, civUps, rawUps, civNames, civYears, civSetup, civPlay } = deps.civ;
  const { resimInfo, resimText, switchNote, stepAuto, rewindNote } = deps.resim;
  const { openStored } = deps.later;
  // 助手的试推演:和重推一样交给线程(排在别的活后面),结果单独交回、不换上去;州和宜居度沿用现在这份
  useEffect(() => {
    setTrialRunner(
      (interventions, signal) =>
        new Promise<Civ>((resolve, reject) => {
          const p = genParams.current;
          if (!p || !rawRef.current) return reject(new Error('世界还没生成好'));
          // 逐年推演只看得到"现在"以前:不在后台试推演以后会怎样
          if (getStepwise().on || cleanPlay(getEdits().play)) return reject(new Error('逐年推演里不试推演：以后的事还没发生。想试，先存回推演模式'));
          const ups = civUps.current;
          // 登记了等交回来(signal 停下、线程被换掉都会 reject);signal 已经停了的不发
          const tid = sim.trial(
            signal,
            (next) => {
              const old = rawRef.current;
              resolve(old ? reuseRegions(old, next, sameUpheavals(ups, rawUps.current)) : next);
            },
            reject,
          );
          if (tid === null) return;
          send({ type: 'trial', id: reqId.current, tid, params: p, terrain: [...genTerrain.current], sketch: genSketch.current, interventions: [...interventions], ...upsOpt(ups), ...namesOpt(civNames.current), ...yearsOpt(civYears.current), ...setupOpt(civSetup.current) });
        }),
    );
    return () => setTrialRunner(null);
  }, [send, sim]);
  // 逐年推演:算一步(worker 的 turn)、从推演模式某一年开始、存回推演模式、重新演绎、切支线
  useEffect(() => {
    /**
     * 重新演绎、切支线:正在算的那一步先等它算完、换上(或者没算成),再做 fn。这样原来那一支照它真走到的样子留下,
     * 交回来的那一步也不会落到另一支上;单子里还没交出去的干预本来就在下一步开头生效,正好是那时的"现在"。
     * 没在算 = 马上做;等的时候换了世界、不在逐年推演了 = 不做。一次只等一件(waiting 的时候两个动作都先不接)
     */
    let waiting = false;
    const afterStep = (fn: () => void) => {
      if (!getStepwise().busy) return fn();
      if (waiting) return;
      waiting = true;
      const off = subscribeStepwise(() => {
        const t = getStepwise();
        if (t.on && t.busy) return;
        off();
        waiting = false;
        if (t.on) fn();
      });
    };
    /**
     * 原来那一支要留下的样子(重新演绎、切走时):单子里还没交出去的干预(和万一还在算的那一步带走的)
     * 都当作在"现在"下的(在进度那一刻生效:那一年年初,停在年中的是那一格;同存回推演模式)。没在逐年推演 = null
     */
    const keptBranch = (): WorldEdits | null => {
      const e0 = getEdits();
      const play = cleanPlay(e0.play);
      if (!play) return null;
      const later = [...(getStepwise().busy?.commands ?? []), ...getPending().flatMap((x) => (x.kind === 'iv' ? [x.v] : []))];
      const now = commandsNow(play, later);
      return now.length ? { ...e0, play: issueCommands(play, now).play } : e0;
    };
    /** 单子里还没交出去的干预已经记进原来那一支:从单子里拿掉 */
    const dropPending = () => {
      for (const x of getPending()) if (x.kind === 'iv') removePending(x.id);
    };
    setStepwiseActions({
      turn: (ticks, commands) => {
        const p = genParams.current;
        const play = cleanPlay(getEdits().play);
        // 地图上这份历史得正是按现在这份进度推的(不在重推、不在生成)
        if (!p || !play || !rawRef.current || fresh.current || regenRef.current || resimInfo.current || JSON.stringify(play) !== JSON.stringify(civPlay.current ?? null)) return false;
        send({
          type: 'turn',
          id: reqId.current,
          play,
          commands,
          years: Math.max(1, Math.round(ticks / YEAR_TICKS)),
          ticks,
          params: p,
          terrain: [...genTerrain.current],
          sketch: genSketch.current,
          interventions: [...civEdits.current],
          ...upsOpt(civUps.current),
          ...namesOpt(civNames.current),
          ...setupOpt(civSetup.current),
        });
        return true;
      },
      start: (year, drop, adv) => {
        const cur = currentWorld();
        if (!cur || !rawRef.current) return;
        // 推进设置只写进新的那个(原来的世界不动)
        const { advance: _old, ...rest } = getEdits();
        void _old;
        const a = cleanAdvance(adv);
        const e = startStepwise(a ? { ...rest, advance: a } : rest, year, drop);
        // 原来的世界不动:另存一个从这一年开始演绎的(名字照旧;存回推演模式时能选覆盖原来那个)
        const id = saveCurrentAs(e, cur.title || '', isStored(cur.id) ? cur.id : undefined);
        if (!id) return notify({ kind: 'error', text: '没能开始演绎', more: [storageFullWhy()] });
        stepAuto.current = true;
        openStored(id);
      },
      saveBack: (asNew, open) => {
        const cur = currentWorld();
        const e0 = getEdits();
        const play = cleanPlay(e0.play);
        if (!cur || !play) return;
        // 正在算的那一步带走的干预、单子里还没交出去的:都当作在"现在"下的,一起存进去(在那一年年初生效;
        // 正在算的那一步还没换上来,修改里的进度还是"现在")
        const inflight = getStepwise().busy?.commands ?? [];
        const normal = saveBackEdits(e0, [...inflight, ...getPending().flatMap((x) => (x.kind === 'iv' ? [x.v] : []))]);
        if (!normal) return notify({ kind: 'error', text: '没能存回推演模式', more: ['推得太远了，普通世界最多推到第 60000 年'] });
        const origin = stepOrigin(cur.id);
        let id: string | null;
        let title: string;
        if (!asNew && origin) {
          id = overwriteWorld(origin.id, normal) ? origin.id : null;
          title = origin.title;
        } else {
          const want = `${cur.title || '未命名世界'}${SAVE_SUFFIX}`;
          title = listWorlds().some((w) => w.save.title === want) ? nextTitle(want) : want;
          id = saveCurrentAs(normal, title);
        }
        if (!id) return notify({ kind: 'error', text: '没能存回推演模式', more: [storageFullWhy()] });
        if (open) return openStored(id);
        showToast({ id: 'step-saved', kind: 'ok', dot: true, text: `已存回推演模式「${title}」`, more: ['这个故事照样留着，在「我的世界」里随时能打开那一个'], ttl: 6000 });
      },
      rewind: (year, name) => {
        // 正在切支线:地图、时间轴上还是原来那支,修改里已经是切到的那一支,这时另开会从切到的那一支分出去
        // (切的时候问重新演绎的窗口本来就不开,见 openStepDialog);已经在等着做别的:这次不做
        if (getStepwise().switching || waiting) return;
        setCivTime({ playing: false });
        afterStep(() => {
          const e0 = keptBranch();
          const play = e0 && cleanPlay(e0.play);
          // 原来那条原样留成一支(记下它的最后一件大事),从那一年另开一支、切过去
          // year 带小数(停在年中、一步短于一年的回到那一格)
          const r = e0 && play && rewindBranch(e0, momentAt(Math.round(year * YEAR_TICKS)), name, branchNote(rawRef.current, play.year));
          if (!play || !r || !r.edits.play) return notify({ kind: 'error', text: '没能从这一年重新演绎', more: ['另开的支太多了'] });
          const T = playAt(r.edits.play) / YEAR_TICKS;
          rewindNote.current = { year: T };
          dropPending();
          // 进度换成那一年年初(App 照它从第 0 年推到那一年)
          putEditsQuiet(r.edits);
          rewoundTo(playFromOf(r.edits), T);
          setCivTime({ year: T, playing: false, scrubbing: false, story: false });
        });
      },
      switchBranch: (id) => {
        const s = getStepwise();
        const all = branchList(getEdits());
        const cur = all.find((b) => b.current);
        const to = all.find((b) => b.id === id && !b.current);
        // 正在切、等着重新演绎、正在重推 / 生成(地图上的历史还不是这一支的)时不切
        if (!s.on || s.switching || waiting || resimInfo.current || regenRef.current || !cur || !to) return;
        // 那一行先转起圈来(别的行、下令先不能点),停下;正在算的那一步算完再切
        branchSwitching({ to: id, from: cur.id, ...(to.last ? { last: to.last } : {}) });
        stepAuto.current = false;
        rewindNote.current = null;
        setCivTime({ playing: false });
        afterStep(() => {
          const e0 = keptBranch();
          const play = e0 && cleanPlay(e0.play);
          const next = e0 && play && !resimInfo.current && !regenRef.current ? switchBranch(e0, id, branchNote(rawRef.current, play.year)) : null;
          if (!e0 || !next?.play) return branchSwitching(null);
          dropPending();
          const note: SwitchNote = { from: cur.id, fromRef: branchRef(cur), toRef: branchRef(to), year: next.play.year };
          // 两支走到的一模一样(另开以后原样走回了同一年):地图上这份历史就是它的,不用重推,直接换上
          if (JSON.stringify(next.play) === JSON.stringify(civPlay.current ?? null)) {
            putEditsQuiet(next);
            enterStepwise(playFromOf(next), playAt(next.play) / YEAR_TICKS);
            const stuck = rawRef.current?.stuck;
            if (stuck) stepStuck(playAt(next.play) / YEAR_TICKS, stuck.at);
            setCivTime({ year: playAt(next.play) / YEAR_TICKS, playing: false, scrubbing: false, story: false });
            return switchedToast(note);
          }
          // 地图先留着原来那支(照样能拖),在后台照那一支从第 0 年推到它走到的那一年,推完换上、停在那一年
          switchNote.current = note;
          resimText.current = `正在切到${branchRef(to)}：从头推到${spaced(yearAt(next.play.year, e0.era))}`;
          putEditsQuiet(next);
        });
      },
    });
    return () => setStepwiseActions(null);
  }, [send]);
  // 地形大事的"会怎么样":交给线程照"那一年的地形 + 这几笔"生成一遍。那一年的地形按卡片给的大事算(修改里现在的,和预览的键同一份):
  // 刚加了一件、重推还没完时,线程先推完那一次才轮到这次预览,结果回来时地图上已经是新的历史
  useEffect(() => {
    setUpRunner((pid, year, ops, ups) => {
      const p = genParams.current;
      if (!p) return;
      send({ type: 'upPreview', id: reqId.current, pid, params: p, terrain: [...genTerrain.current], sketch: genSketch.current, ...upsOpt(ups), ...(civSetup.current?.civSeed !== undefined ? { civSeed: civSetup.current.civSeed } : {}), year, ops: [...ops] });
    });
    return () => setUpRunner(null);
  }, [send]);
}

/** useExtendOutlineRunners 要的 App 状态 */
export interface ExtendOutlineRunnersDeps {
  sim: SimClient;
  send: (req: WorkerRequest) => void;
  gen: Pick<GenRefs, 'reqId' | 'genParams' | 'genTerrain' | 'genSketch' | 'fresh' | 'regenRef' | 'rawRef'>;
  civ: Pick<CivRefs, 'civEdits' | 'civUps' | 'civNames' | 'civYears' | 'civSetup' | 'civLater'>;
  map: Pick<MapRefs, 'eraPatches'>;
  resim: Pick<ResimRefs, 'resimInfo' | 'extendRef' | 'dropExtendUndo'>;
  /** 再推、照大纲推演自己的:在不在看试推演、编号、正在照大纲推演的那一次,和 useSimResults 给的进度、叫停 */
  runs: {
    previewOn: Ref<boolean>;
    extendSeq: Ref<number>;
    outlineRef: Ref<OutlineJob | null>;
    outlineSeq: Ref<number>;
    outlineProgress: SimResults['outlineProgress'];
    stopOutlineRun: SimResults['stopOutlineRun'];
  };
}

/** 「再推」「照大纲推演」:接到后台线程上 */
export function useExtendOutlineRunners(deps: ExtendOutlineRunnersDeps): void {
  const { sim, send } = deps;
  const { reqId, genParams, genTerrain, genSketch, fresh, regenRef, rawRef } = deps.gen;
  const { civEdits, civUps, civNames, civYears, civSetup, civLater } = deps.civ;
  const { eraPatches } = deps.map;
  const { resimInfo, extendRef, dropExtendUndo } = deps.resim;
  const { previewOn, extendSeq, outlineRef, outlineSeq, outlineProgress, stopOutlineRun } = deps.runs;
  // 「再推」:接到后台线程上(ExtendYears.tsx 调 extendStart / extendStop)
  useEffect(() => {
    setExtendRunner({
      start: (years) => {
        const p = genParams.current;
        const raw = rawRef.current;
        if (!p || !raw || fresh.current || extendRef.current || previewOn.current || getStepwise().on || cleanPlay(getEdits().play)) return;
        const from = raw.endYear;
        const to = extendedEndYear(from, years);
        if (!(to > from)) return;
        // 照原样打开的旧世界:推演要用新版的规则,先问要不要另存一份(在那一份上推)
        if (askHistory({ ...getEdits(), endTick: undefined, ...endFields(to) })) return;
        const xid = ++extendSeq.current;
        extendRef.current = { xid, from, to, t0: performance.now(), endYear: writtenEndAt(getEdits()) };
        clearToast('extend-done');
        dropExtendUndo();
        // 停在"现在"(结束年份)的播放头钉在这一年:时间轴变长以后还停在原处
        if (getCivTime().year === null) setCivTime({ year: from });
        setExtendFresh(null);
        setExtendBusy({ xid, from, to, year: null, pct: 0, slow: !!civUps.current?.length });
        send({
          type: 'extend',
          ...systemOpt(),
          id: reqId.current,
          xid,
          to,
          params: p,
          terrain: [...genTerrain.current],
          sketch: genSketch.current,
          interventions: [...civEdits.current],
          ...upsOpt(civUps.current),
          ...namesOpt(civNames.current),
          ...setupOpt(civSetup.current),
          have: [...eraPatches.current.keys()],
        });
      },
      stop: () => {
        const x = extendRef.current;
        if (!x) return;
        const b = getExtend().busy;
        extendRef.current = null;
        setExtendBusy(null);
        // 从第 0 年整段推的(有地形大事、线程被重开过:一直没有分段进度)中途停不下来:线程手上只剩这一件活时换一个新的线程
        // (手上的世界下次用到时按参数重算),不然要等它整段推完才空出来
        if (b?.xid === x.xid && b.year === null && sim.busy === 1) {
          sim.ensure(true);
          return;
        }
        // 叫停不算一件活(线程不回音):直接发
        sim.tell({ type: 'extendStop', id: reqId.current, xid: x.xid } satisfies WorkerRequest);
      },
    });
    return () => setExtendRunner(null);
  }, [send]);

  // 「照大纲推演」:接到后台线程上(大纲页、侧栏先问多认真地试(OutlineRunAsk),再调 startOutline / stopOutline)
  useEffect(() => {
    setOutlineRunner({
      start: (tries) => {
        const p = genParams.current;
        const raw = rawRef.current;
        const e = getEdits();
        const plots = e.outline?.plots;
        if (!p || !raw || !plots?.length || outlineRef.current || previewOn.current || getStepwise().on || cleanPlay(e.play)) return;
        // 世界还在生成、在重推、在再推:等它推完
        if (fresh.current || regenRef.current || civLater.current || resimInfo.current || extendRef.current) {
          showToast({ id: 'outline', kind: 'info', text: '世界还在推演，推完再照大纲推演', ttl: 4000 });
          return;
        }
        // 照原样打开的旧世界:推演要用新版的规则,先问要不要另存一份(在那一份上推)
        if (askHistory(e)) return;
        const oid = ++outlineSeq.current;
        const own = ownInterventions(e.interventions);
        outlineRef.current = { oid, plots, own, marks: JSON.stringify(e.marks ?? null), characters: JSON.stringify(e.characters ?? null), t0: performance.now() };
        clearToast('outline-done');
        outlineProgress(oid, 0, plots.length, [], undefined);
        send({
          type: 'outline',
          ...systemOpt(),
          id: reqId.current,
          oid,
          plots,
          tries,
          params: p,
          terrain: [...genTerrain.current],
          sketch: genSketch.current,
          interventions: [...e.interventions],
          ...(e.characters?.length ? { characters: e.characters } : {}),
          ...(e.marks?.length ? { marks: e.marks } : {}),
          ...upsOpt(civUps.current),
          ...namesOpt(civNames.current),
          ...yearsOpt(civYears.current),
          ...setupOpt(civSetup.current),
          have: [...eraPatches.current.keys()],
        });
      },
      stop: stopOutlineRun,
    });
    return () => setOutlineRunner(null);
  }, [send]);
}
