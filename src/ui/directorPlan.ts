/**
 * 导播的排期(纯计算):给一段年份、编年史、关注对象、节奏设置,排出导播放哪几件事、按什么顺序、
 * 每一段从第几秒开始、停多久、镜头去哪、地图上标在哪、字幕写什么;排不下的列进"略过的"。
 * 不碰 DOM,单测直接测(tests/director-plan.test.ts)。字幕的写法和回放视频一样(filmPlan.ts 的 filmEvents:
 * 编年史原句、中文标点、纪年照写,多年的战争刚开打时只写开头一句),事发地和地图上的事件标签一样(timelineLayout.ts 的 entrySpot)。
 *
 * - 排哪件:
 *   没有关注对象 = 全世界的大事(编年史"大事",重要度 3);
 *   关注一国 = 和这国有关的事(重要度 ≥ 2,可调)+ 别国的头等大事;
 *   关注一人 = 写到他的事 + 他那一国在他在台上(君主在位、将领领兵、名臣在朝)时的大事 + 别国的头等大事;
 *     接着跟(relay)= 他不在了以后接着跟下一位(followInfo.ts:君主跟继任的,将领、名臣回到他的国家),每一段照那一段跟的排。
 *   因为关注对象没排进来的别国大事进"略过的"(focus)。
 *   排进来的仗里据险断后的那几下(编年史挂在战争下的条目)各自再放一段,按"其余大事"停、分量同那场仗:
 *   镜头落在守的那处关上,名牌写关名(守的口子画在地图上的不和别的合成一段)。
 * - 停多久:头等大事(亡国、改朝换代、大战、分裂、大崩解、民变、民族消亡、干预、地形大事 —— 分量 ≥ 35)字幕停 3 秒,
 *   其余大事 2 秒,小事 1.2 秒,再乘"一件事停多久"的系数(短 0.5、标准 1、长 2)。每一段开头镜头先飞 0.6 秒(和选中东西时一样)。
 * - 合成一段:同一个地方(事发地相距不到 3 个州)接连的几件(和前一件相隔不到 10 年,一段最多 3 件)合成一段,
 *   镜头只飞一次,字幕一件接一件。
 * - 节奏:
 *   自动("事少快、事多慢")= 没事的年份按 rate 走(默认 4× 的速度),到一段事上停下讲,讲的时候年份从这段第一件走到最后一件,讲完接着走。
 *     任意十年里多于 3 件时只留分量重的(头等大事全留),其余进"略过的"(crowd)。
 *     给了可用时长(秒)= 最多放这么久:放不下先略过分量轻的(time),再加快没事的年份。
 *   固定速度 = 年份一直按 rate 走(默认 1× 的速度;给了可用时长 = 整段正好放这么久,按它定速度,讲不完的略过;
 *     没给 = 最后一段可以讲过头,年份停在最后一年等它讲完)。
 *     每段在那件事发生的那一刻出字幕(镜头提前 0.6 秒起飞),段和段不重叠,撞了最多往后挪 1 秒;
 *     分量重的先排,排不下的只留这段分量最重的那件再试,还不行进"略过的"(time)。
 * - 年份范围含头不含尾([from, to)),整段排到世界最后一年时最后一年也算:一步一步往下排时同一件事不会排两次。
 * - 照大纲放(给了 plots:照大纲推演推过的情节,做不到的不给):每条情节单独一段,大字是作者写的那句、小字是编年史里对上的那一条
 *   (对上的那条不再另放),停得和头等大事一样久,不略过、不和别的合成一段;情节之间只放头等大事,其余进"略过的"(crowd)。
 * - 同样的输入每次排得一样:不用随机数,排序都有确定的先后(分量、年份、编号)。
 */
import { systemOpt } from '../gen/systemState';
import { MAJOR, entryInvolves, type ChronicleEntry } from '../gen/civ/story/chronicle';
import type { Civ, Person } from '../gen/civ/types';
import { personSpan } from '../gen/civ/story/peopleInfo';
import { seatPolity } from '../gen/civ/story/peopleText';
import type { World } from '../gen/world';
import { capitalAt } from '../gen/readers/openQuery';
import { regionLabel } from '../gen/civ/story/display';
import { yearFull, type Era } from '../gen/era';
import { nearX } from '../render/common';
import type { EvType } from '../render/eventTypes';
import { eventOver, type FilmEvent } from '../render/filmFrames';
import { filmEvents } from './filmPlan';
import { entrySpot, entryWeight, evLabel, playRate, type EntrySpot } from './timelineLayout';
import type { Focus } from './flyTo';
import { followLegs } from './followInfo';

// ---------------------------------------------------------------------------
// 规则里的数

/** 头等大事的分量门槛(timelineLayout.ts 的 entryWeight:重要度 3、种类分量 ≥ 5) */
export const BIG_WEIGHT = 35;
/** 字幕停几秒(系数 1 时):头等大事 / 其余大事 / 小事 */
export const DIRECTOR_HOLD: Readonly<Record<DirectorTier, number>> = { big: 3, major: 2, minor: 1.2 };
/** 仗里据险断后的那一下(编年史挂在战争下的一条)单独一段时按哪一档停 */
const STAND_TIER: DirectorTier = 'major';
/** "一件事停多久"的系数夹在这里面 */
export const HOLD_FACTOR_MIN = 0.25;
export const HOLD_FACTOR_MAX = 4;
/** 每一段开头镜头飞几秒(和 flyTo.ts 的 FLY_MS 一样) */
export const DIRECTOR_FLY = 0.6;
/** 合成一段:和前一件相隔不到几年、事发地相距不到几个州(州的平均大小)、一段最多几件 */
export const MERGE_YEARS = 10;
export const MERGE_REACH = 3;
export const MERGE_MAX = 3;
/** 自动节奏里"事太多":前后 CROWD_YEARS / 2 年里已经有 CROWD_MAX 件,这一件(不是头等大事)就略过 */
export const CROWD_YEARS = 10;
export const CROWD_MAX = 3;
/** 固定速度:一段和别的段撞了,最多往后挪几秒 */
export const FIXED_SHIFT = 1;
/** 自动节奏给了可用时长:至少留这么多成给没事的年份(没事的年份本来用不了这么久的,按本来的) */
export const IDLE_SHARE = 0.2;
/** 镜头看的范围:至少几个州宽(看得见事发地周围几个州);事发的州离事发地超过几个州的不算进范围 */
export const SHOT_SPAN = 5;
export const SHOT_REACH = 6;
/** 镜头大致放大几倍:范围占画面八成,1–3 倍(和 flyTo.ts 看全疆域一样) */
export const SHOT_FILL = 0.8;
export const SHOT_ZOOM_MAX = 3;

// ---------------------------------------------------------------------------
// 输入

/** 头等大事 / 其余大事 / 小事 */
export type DirectorTier = 'big' | 'major' | 'minor';

/** 照大纲放的一条情节 */
export interface DirectorPlot {
  /** 情节编号、第几条(1 起)、一共几条 */
  id: number;
  n: number;
  total: number;
  /** 落在哪一年(推过的落定那年;只讲故事 = 情节的年份) */
  year: number;
  /** 作者写的那句(没写 = 发生什么) */
  text: string;
  /** 编年史里对上的那一条(照着发生了的那件事 / 硬改的那一条;只讲故事、对不上 = null):小字写它,镜头去它的事发地 */
  entry: ChronicleEntry | null;
  /** 对不上编年史时镜头去哪个地块(说不出地方 = −1:镜头不动) */
  cell: number;
}

/** 情节的分量:比哪件大事都重(自动节奏给了时长时最后才略过,固定速度先排) */
export const PLOT_WEIGHT = 1000;

export interface DirectorFocus {
  /** 关注一国(Polity.id)/ 一人(Person.id) */
  kind: 'polity' | 'person';
  id: number;
  /** 和关注对象有关的事从哪个重要度起排:关注一国默认 2;关注一人默认 3(写到他本人的事都排,不看这个) */
  min?: 1 | 2 | 3;
  /** 别国的事:'big' = 头等大事照放(默认);'none' = 只放和关注对象有关的,别国的大事都进"略过的" */
  others?: 'big' | 'none';
  /** 关注一人:他去世 / 下台以后接着跟下一位(君主跟继任的,将领、名臣回到他的国家;见 followInfo.ts 的 followLegs) */
  relay?: boolean;
}

export interface DirectorPace {
  /** auto = 事少快、事多慢;fixed = 固定速度 */
  mode: 'auto' | 'fixed';
  /** 每秒走多少年(auto:没事的年份;fixed:一直这个速度)。不给 = 时间轴 4×(auto)/ 1×(fixed)的速度(playRate,推得久的世界跟着放大) */
  rate?: number;
  /** 一件事停多久的系数:0.5 短 / 1 标准(默认)/ 2 长 */
  hold?: number;
  /** 可用时长(秒):auto = 最多放这么久;fixed = 整段正好放这么久(按它定速度,不看 rate;最后讲不完的略过)。不给 = 不限 */
  seconds?: number;
}

export interface DirectorInput {
  /** 年份范围 [from, to) */
  from: number;
  to: number;
  /**
   * 编年史条目(fullChronicle 那一份,"全部",不用先挑大事;顺序不要紧)。
   * 关注一人时并上君主继位(chronicle.ts 的 reignEntries / mergeChronicle),写到他继位的那一条才排得进来
   */
  entries: readonly ChronicleEntry[];
  /** 关注对象;没有 = 看全世界的大事。对不上(国家、人物不存在)也按没有算 */
  focus?: DirectorFocus | null;
  pace: DirectorPace;
  /** 纪年(字幕的年份、正文里的"第 N 年"照它写) */
  era?: Era | null;
  /** 照大纲放:情节(按大纲的先后;没有 / 空 = 不照大纲) */
  plots?: readonly DirectorPlot[];
}

// ---------------------------------------------------------------------------
// 输出

/**
 * 镜头去哪:中心、经纬度、要看得见的范围(世界坐标,和 flyTo.ts 的 Focus 一样,可以直接当 FlyGoal 的 focus,
 * 按"看全范围"飞:kind 'polity');zoom = 大致放大几倍(按整张图估的,界面按窗口大小再算);
 * target = 事发地是哪座城 / 哪一州 / 哪一国(合成的一段 = 分量最重那件的;要只飞到那一处,交给 flyTo.ts 的 selectionFocus)
 */
export interface DirectorShot extends Focus {
  box: [number, number, number, number];
  zoom: number;
  target: { kind: EntrySpot['kind']; id: number } | null;
}

/** 一件事的字幕和标注 */
export interface DirectorCaption {
  entry: ChronicleEntry;
  /** 事件类型(配色)和类型名("改朝""战争"……;照大纲放的情节 = 'outline'、"大纲") */
  type: EvType | 'outline';
  typeName: string;
  /** 字幕上的年份("第 2655 年";多年的战争刚开打 "第 2562 年起")和正文(编年史原句;多年的战争只写开头一句) */
  label: string;
  text: string;
  tier: DirectorTier;
  /** 分量(timelineLayout.ts 的 entryWeight) */
  weight: number;
  /** 事发地(世界坐标,地图上的圆环画在这)和地名(城名 / 州名 / 那一国的国都名);找不到 = null / '' */
  pin: [number, number] | null;
  place: string;
  /** 照大纲放的情节:第几条、一共几条;sub = 小字(编年史里对上的那一条,没有 = '') */
  plot?: { id: number; n: number; total: number; sub: string };
}

/** 一段里的一件:字幕从第 at 秒出现,停 hold 秒 */
export interface DirectorItem extends DirectorCaption {
  at: number;
  hold: number;
}

/** 一段:第 at 秒镜头起飞,飞 DIRECTOR_FLY 秒,然后字幕一件接一件;一共停 hold 秒 */
export interface DirectorSegment {
  at: number;
  hold: number;
  /** 合进来的第一件、最后一件的年份(引擎精度的原值) */
  year: number;
  yearEnd: number;
  /** 镜头去哪(包住合进来的每一件);都没有事发地 = null(镜头不动) */
  shot: DirectorShot | null;
  items: DirectorItem[];
  /** 分量最重的那件在 items 里的下标(一样重取先发生的)和它的分量 */
  lead: number;
  weight: number;
}

/** 略过的一件:为什么略过(focus 不是关注对象的事;crowd 事太多,只留分量重的;time 来不及讲),点了镜头去哪 */
export interface DirectorSkip extends DirectorCaption {
  why: 'focus' | 'crowd' | 'time';
  shot: DirectorShot | null;
}

/** 时钟的一个关键点:第 t 秒放到第 year 年(两个关键点之间匀速) */
export interface DirectorKey {
  t: number;
  year: number;
}

export interface DirectorPlan {
  from: number;
  to: number;
  mode: 'auto' | 'fixed';
  /** 实际用的速度:每秒走多少年(auto = 没事的年份) */
  rate: number;
  /** 实际用的"停多久"系数 */
  hold: number;
  /** 一共放几秒 */
  duration: number;
  /** 按出现的先后 */
  segments: DirectorSegment[];
  /** 按年份(一样的按编号) */
  skipped: DirectorSkip[];
  /** 时钟:第一个 t = 0、year = from;最后一个 year = to;t、year 都不减 */
  clock: DirectorKey[];
}

// ---------------------------------------------------------------------------
// 排期

interface Cand extends DirectorCaption {
  hold: number;
  spot: EntrySpot | null;
  box: [number, number, number, number] | null;
}

const ALL_YEARS = { from: -Infinity, to: Infinity };
const NO_ENTRIES: readonly ChronicleEntry[] = [];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 先后:年份、编号 */
const byTime = (a: { entry: ChronicleEntry }, b: { entry: ChronicleEntry }) => a.entry.year - b.entry.year || a.entry.id - b.entry.id;
/** 分量重的在前,一样重的先发生的在前 */
const byWeight = (a: Cand, b: Cand) => b.weight - a.weight || byTime(a, b);

export function directorPlan(world: World, civ: Civ, input: DirectorInput): DirectorPlan {
  const end = civ.endYear;
  const from = finite(input.from) ? input.from : 0;
  const to = finite(input.to) ? Math.max(from, input.to) : Math.max(from, end);
  const span = to - from;
  const mode = input.pace.mode === 'fixed' ? 'fixed' : 'auto';
  const factor = finite(input.pace.hold) ? Math.min(HOLD_FACTOR_MAX, Math.max(HOLD_FACTOR_MIN, input.pace.hold)) : 1;
  const seconds = finite(input.pace.seconds) && input.pace.seconds > 0 ? input.pace.seconds : null;
  let rate = finite(input.pace.rate) && input.pace.rate > 0 ? input.pace.rate : playRate(mode === 'auto' ? 4 : 1, end);
  if (mode === 'fixed' && seconds && span > 0) rate = span / seconds;
  const era = input.era ?? null;
  const ctx = shotCtx(world, civ);

  // 1. 年份范围里的事,按关注对象挑
  const focus = focuser(civ, input.focus ?? null, to);
  const last = to >= end;
  const inRange = (y: number) => y >= from && (y < to || (last && y <= to));
  const plots = (input.plots ?? []).filter((p) => inRange(p.year));
  const outline = !!input.plots?.length;
  // 照大纲放:对上情节的那几条不另放
  const told = new Set(plots.flatMap((p) => (p.entry ? [p.entry.id] : [])));
  const take: { e: ChronicleEntry; tier: DirectorTier; skip: boolean; weight?: number }[] = [];
  for (const e of input.entries) {
    if (told.has(e.id)) continue;
    const here = inRange(e.year);
    // 仗里据险断后的那几下(仗开打在这段年份以前的也算)
    const stands = e.kind === 'war' && e.children?.some((c) => c.kind === 'stand') ? e.children.filter((c) => c.kind === 'stand' && inRange(c.year)) : NO_ENTRIES;
    if (!here && !stands.length) continue;
    const major = e.importance >= MAJOR;
    let pick: { tier: DirectorTier; skip: boolean } | null = null;
    if (!focus) pick = major ? { tier: tierOf(e), skip: false } : null;
    else if (focus.related(e)) pick = { tier: tierOf(e), skip: false };
    else if (major) pick = { tier: tierOf(e), skip: !(focus.others === 'big' && tierOf(e) === 'big') };
    if (!pick) continue;
    if (here) take.push({ e, ...pick });
    // 排得进来的仗:据险断后的那几下各自单独一段(镜头落在守的那处关上,见 timelineLayout.ts 的 entrySpot);
    // 分量同那场仗(不然事多的年份总被别的大事挤掉)
    if (!pick.skip) for (const c of stands) take.push({ e: c, tier: STAND_TIER, skip: false, weight: Math.max(entryWeight(c), entryWeight(e)) });
  }
  const texts = new Map<number, FilmEvent>();
  for (const f of filmEvents(take.map((x) => x.e), ALL_YEARS, undefined, era)) texts.set(f.id, f);
  const skipped: DirectorSkip[] = [];
  const skip = (c: Cand, why: DirectorSkip['why']) => skipped.push({ ...captionOf(c), why, shot: c.box ? shotOf(ctx, c.box, c.spot) : null });
  let items: Cand[] = [];
  for (const x of take) {
    const c = candOf(ctx, x.e, texts.get(x.e.id)!, x.tier, factor, era);
    if (x.weight !== undefined) c.weight = x.weight;
    if (x.skip) skip(c, 'focus');
    // 照大纲放:情节之间只放头等大事
    else if (outline && x.tier !== 'big') skip(c, 'crowd');
    else items.push(c);
  }
  for (const p of plots) items.push(plotCand(ctx, p, factor, era));
  items.sort(byTime);

  // 2. 自动节奏:事太多时只留分量重的;给了可用时长,放不下的先略过分量轻的
  if (mode === 'auto') {
    items = uncrowd(items, (c) => skip(c, 'crowd'));
    if (seconds) {
      // 按合成以后的段算(合成的一段镜头只飞一次)
      const limit = seconds - Math.min(span / rate, seconds * IDLE_SHARE);
      const cost = (list: readonly Cand[]) => mergeGroups(ctx, list).reduce((s, g) => s + DIRECTOR_FLY + g.reduce((h, c) => h + c.hold, 0), 0);
      if (cost(items) > limit) {
        const drop = new Set<Cand>();
        let left = items;
        for (const c of [...items].sort(byWeight).reverse()) {
          drop.add(c);
          left = items.filter((x) => !drop.has(x));
          if (cost(left) <= limit) break;
        }
        for (const c of items) if (drop.has(c)) skip(c, 'time');
        items = left;
      }
    }
  }

  // 3. 同一个地方接连几件合成一段
  const groups = mergeGroups(ctx, items);

  // 4. 排时间
  let segments: DirectorSegment[];
  let clock: DirectorKey[];
  let duration: number;
  if (mode === 'auto') {
    if (seconds) {
      // 没事的年份放不下了就加快
      let holds = 0;
      let busy = 0;
      for (const g of groups) {
        holds += DIRECTOR_FLY + g.reduce((s, c) => s + c.hold, 0);
        busy += g[g.length - 1].entry.year - g[0].entry.year;
      }
      const idle = Math.max(0, span - busy);
      const room = seconds - holds;
      if (idle > 0 && room > 0 && idle / rate > room) rate = idle / room;
    }
    ({ segments, clock, duration } = autoTimes(ctx, groups, from, to, rate));
  } else {
    ({ segments, clock, duration } = fixedTimes(ctx, groups, from, to, rate, seconds !== null && span > 0, (c) => skip(c, 'time')));
  }
  skipped.sort(byTime);
  return { from, to, mode, rate, hold: factor, duration, segments, skipped, clock };
}

/**
 * 给定的几件事各自的字幕、事发地和镜头(不挑、不排时间;逐年推演停一下时卡片里列的那几件用,见 stepwisePlan.ts 的 reviewItems)。
 * 写法和排期里的一样(编年史原句、中文标点;打到 civ.endYear 还没打完的仗只写开头一句,年份写"第 N 年起")
 */
export function directorCards(world: World, civ: Civ, entries: readonly ChronicleEntry[], era?: Era | null): { cap: DirectorCaption; shot: DirectorShot | null }[] {
  const ctx = shotCtx(world, civ);
  const texts = new Map<number, FilmEvent>();
  for (const f of filmEvents(entries, ALL_YEARS, undefined, era ?? null)) texts.set(f.id, f);
  return entries.flatMap((e) => {
    const f = texts.get(e.id);
    if (!f) return [];
    const c = candOf(ctx, e, f, tierOf(e), 1, era ?? null);
    return [{ cap: captionOf(c), shot: c.box ? shotOf(ctx, c.box, c.spot) : null }];
  });
}

/** 头等大事 / 其余大事 / 小事(逐年推演"出大事也停"也照它判断,见 stepwisePlan.ts) */
export function tierOf(e: ChronicleEntry): DirectorTier {
  if (e.importance < MAJOR) return 'minor';
  return entryWeight(e) >= BIG_WEIGHT ? 'big' : 'major';
}

/** 关注对象:哪些事和它有关、别国的事怎么办;对不上 = null(按没有关注对象排)。to = 排到哪年(接着跟的几段排到这年) */
function focuser(civ: Civ, f: DirectorFocus | null, to: number): { related: (e: ChronicleEntry) => boolean; others: 'big' | 'none' } | null {
  if (!f || !finite(f.id)) return null;
  const others = f.others === 'none' ? 'none' : 'big';
  if (f.kind === 'polity') {
    if (!civ.polities[f.id]) return null;
    return { others, related: polityRelated(f.id, f.min ?? 2) };
  }
  const p = civ.people?.[f.id];
  if (!p || p.id !== f.id) return null;
  const min = f.min ?? MAJOR;
  if (!f.relay) return { others, related: personRelated(civ, p, min) };
  // 接着跟:按年份落在哪一段,照那一段跟的排;写到这一路上哪一位的事(在他那一段前后一年里)也算
  const legs = followLegs(civ, { kind: 'person', id: p.id }, to).map((l) => {
    const t = l.target;
    const x = t?.kind === 'person' ? civ.people?.[t.id] : undefined;
    const related = x ? personRelated(civ, x, min) : t?.kind === 'polity' ? polityRelated(t.id, 2) : (e: ChronicleEntry) => e.importance >= MAJOR;
    return { from: l.from, to: l.to, x, related };
  });
  const mentionsAny = (e: ChronicleEntry) => legs.some((l) => l.x && e.year >= l.from - 1 && e.year <= l.to + 1 && mentions(e, l.x.id));
  return {
    others,
    related: (e) => {
      let i = legs.length - 1;
      while (i > 0 && e.year < legs[i].from) i--;
      return legs[i].related(e) || mentionsAny(e);
    },
  };
}

/** 写到这个人(正文或合进来的几条里) */
const mentions = (e: ChronicleEntry, id: number) => !!e.people?.includes(id) || !!e.children?.some((c) => !!c.people?.includes(id));

/** 关注一国:和这国有关、重要度不低于 min */
const polityRelated = (id: number, min: number) => (e: ChronicleEntry) => e.importance >= min && entryInvolves(e, id);

/** 关注一人:写到他的事 + 他在台上那些年(君主在位、将领领兵、名臣在朝、太后临朝)他那一国重要度不低于 min 的事 */
function personRelated(civ: Civ, p: Person, min: number): (e: ChronicleEntry) => boolean {
  const span = personSpan(p);
  const a = span.from;
  const b = span.until ?? p.died ?? Infinity;
  // 临朝的太后:她临朝的那一国(嫁来的不是她娘家)
  const pid = seatPolity(civ, p);
  return (e) => mentions(e, p.id) || (e.importance >= min && e.year >= a && e.year <= b && entryInvolves(e, pid));
}

// ---------------------------------------------------------------------------
// 字幕、事发地、镜头

interface ShotCtx {
  world: World;
  civ: Civ;
  W: number;
  H: number;
  /** 州的平均大小(世界单位,约是一州的边长) */
  unit: number;
}

const unitCache = new WeakMap<Civ, number>();

function shotCtx(world: World, civ: Civ): ShotCtx {
  const W = world.width;
  const H = world.height;
  let unit = unitCache.get(civ);
  if (unit === undefined) {
    const R = civ.regions;
    let sum = 0;
    for (let r = 0; r < R.count; r++) sum += R.area[r];
    unit = R.count > 0 && sum > 0 ? Math.sqrt(sum / R.count) : 0;
    unitCache.set(civ, unit);
  }
  return { world, civ, W, H, unit: Math.max(unit, W / 200) };
}

function candOf(ctx: ShotCtx, e: ChronicleEntry, f: FilmEvent, tier: DirectorTier, factor: number, era: Era | null): Cand {
  const { world, civ } = ctx;
  const over = eventOver(f, f.year);
  const spot = entrySpot(world, civ, e);
  const pin: [number, number] | null = spot ? [world.mesh.x[spot.cell], world.mesh.y[spot.cell]] : null;
  return {
    entry: e,
    type: f.type,
    typeName: evLabel(e),
    label: over ? yearFull(f.year, era) : `${yearFull(f.year, era)}起`,
    text: over ? f.text : f.head,
    tier,
    weight: f.weight,
    pin,
    place: spot ? placeName(civ, spot, e.year) : '',
    hold: DIRECTOR_HOLD[tier] * factor,
    spot,
    box: pin ? footprint(ctx, e, pin) : null,
  };
}

function captionOf(c: Cand): DirectorCaption {
  const cap: DirectorCaption = { entry: c.entry, type: c.type, typeName: c.typeName, label: c.label, text: c.text, tier: c.tier, weight: c.weight, pin: c.pin, place: c.place };
  if (c.plot) cap.plot = c.plot;
  return cap;
}

/**
 * 一条情节:字幕的大字是作者写的那句,小字是编年史里对上的那一条;镜头、事发地照对上的那一条(对不上 = 情节说的那个地块)。
 * 字幕挂在一条自己的条目上(编号是负的,不和编年史的撞,按大纲的先后从小到大:同一年的几条照大纲的先后放;年份是情节落定的那年)
 */
function plotCand(ctx: ShotCtx, p: DirectorPlot, factor: number, era: Era | null): Cand {
  const { world, civ } = ctx;
  const m = p.entry;
  const f = m ? filmEvents([m], ALL_YEARS, undefined, era)[0] : undefined;
  const entry: ChronicleEntry = {
    id: p.n - p.total - 1,
    kind: m?.kind ?? 'intervene',
    year: p.year,
    end: p.year,
    text: p.text,
    tag: '纲',
    importance: MAJOR,
    polities: m?.polities ?? [],
    regions: m?.regions ?? [],
    settlement: m?.settlement ?? -1,
  };
  const spot = m ? entrySpot(world, civ, m) : null;
  const cell = spot ? spot.cell : p.cell;
  const pin: [number, number] | null = cell >= 0 && cell < world.mesh.x.length ? [world.mesh.x[cell], world.mesh.y[cell]] : null;
  return {
    entry,
    type: 'outline',
      ...systemOpt(),
    typeName: '大纲',
    label: yearFull(Math.floor(p.year), era),
    text: p.text,
    tier: 'big',
    weight: PLOT_WEIGHT,
    pin,
    place: spot && m ? placeName(civ, spot, m.year) : '',
    hold: DIRECTOR_HOLD.big * factor,
    spot,
    box: pin ? (m ? footprint(ctx, m, pin) : grow([pin[0], pin[1], pin[0], pin[1]], SHOT_SPAN * ctx.unit)) : null,
    plot: { id: p.id, n: p.n, total: p.total, sub: f ? (eventOver(f, p.year) ? f.text : f.head) : '' },
  };
}

/** 地名:城名 / 州名 / 关名 / 那一国那一年的国都名 */
function placeName(civ: Civ, spot: EntrySpot, year: number): string {
  if (spot.kind === 'settlement') return civ.settlements[spot.id]?.name ?? '';
  if (spot.kind === 'region') return regionLabel(civ, spot.id);
  if (spot.kind === 'pass') return civ.places[spot.id]?.name ?? '';
  const p = civ.polities[spot.id];
  return p ? (civ.settlements[capitalAt(p, year)]?.name ?? '') : '';
}

/**
 * 一件事镜头要看的范围:事发地 + 事发各州的治所(离事发地 SHOT_REACH 个州以内的;打遍半个大陆的仗只看事发地附近),
 * 至少 SHOT_SPAN 个州见方。x 按事发地展开(跨左右接缝的不会变成横跨整张图)
 */
function footprint(ctx: ShotCtx, e: ChronicleEntry, pin: [number, number]): [number, number, number, number] {
  const { civ, W, unit } = ctx;
  const { x, y } = ctx.world.mesh;
  const R = civ.regions;
  const reach = SHOT_REACH * unit;
  let x0 = pin[0];
  let x1 = pin[0];
  let y0 = pin[1];
  let y1 = pin[1];
  for (const r of e.regions) {
    if (!(r >= 0 && r < R.count)) continue;
    const c = R.seat[r];
    if (!(c >= 0 && c < x.length)) continue;
    const vx = nearX(x[c], pin[0], W);
    if (Math.hypot(vx - pin[0], y[c] - pin[1]) > reach) continue;
    x0 = Math.min(x0, vx);
    x1 = Math.max(x1, vx);
    y0 = Math.min(y0, y[c]);
    y1 = Math.max(y1, y[c]);
  }
  return grow([x0, y0, x1, y1], SHOT_SPAN * unit);
}

/** 范围不到 min 宽 / 高的,按中心撑开 */
function grow(b: [number, number, number, number], min: number): [number, number, number, number] {
  let [x0, y0, x1, y1] = b;
  if (x1 - x0 < min) {
    const c = (x0 + x1) / 2;
    [x0, x1] = [c - min / 2, c + min / 2];
  }
  if (y1 - y0 < min) {
    const c = (y0 + y1) / 2;
    [y0, y1] = [c - min / 2, c + min / 2];
  }
  return [x0, y0, x1, y1];
}

function shotOf(ctx: ShotCtx, box: [number, number, number, number], spot: EntrySpot | null): DirectorShot {
  const { W, H } = ctx;
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const x = cx - W * Math.floor(cx / W);
  const fit = SHOT_FILL * Math.min(W / Math.max(1e-9, box[2] - box[0]), H / Math.max(1e-9, box[3] - box[1]));
  return {
    box,
    x,
    y: cy,
    lon: (x / W) * 360 - 180,
    lat: 90 - (cy / H) * 180,
    zoom: Math.min(SHOT_ZOOM_MAX, Math.max(1, fit)),
    target: spot ? { kind: spot.kind, id: spot.id } : null,
  };
}

// ---------------------------------------------------------------------------
// 挑、合

/**
 * 事太多时只留分量重的:头等大事全留;其余按分量从重到轻一件件看,把它放进来以后,含它的哪一个 CROWD_YEARS 年
 * (任意起点)里会超过 CROWD_MAX 件,就略过。所以略过的那件,总有一个含它的十年里已经留了三件不比它轻的。
 * 返回留下的(按先后)
 */
function uncrowd(items: Cand[], onSkip: (c: Cand) => void): Cand[] {
  const kept: number[] = [];
  const put = (y: number) => kept.splice(lowerBound(kept, y), 0, y);
  const keep = new Set<Cand>();
  for (const c of items)
    if (c.tier === 'big') {
      keep.add(c);
      put(c.entry.year);
    }
  for (const c of items.filter((c) => c.tier !== 'big').sort(byWeight)) {
    if (busiest(kept, c.entry.year) >= CROWD_MAX) continue;
    keep.add(c);
    put(c.entry.year);
  }
  return items.filter((c) => {
    if (!keep.has(c)) onSkip(c);
    return keep.has(c);
  });
}

/**
 * 含第 y 年的 CROWD_YEARS 年([s, s + CROWD_YEARS),s 任取)里最多已经有几件(kept 从小到大)。
 * 窗口往右挪到左端碰上第一件(或 y)不会少装,所以左端只用试 (y − CROWD_YEARS, y] 里的那几件和 y
 */
function busiest(kept: readonly number[], y: number): number {
  let best = 0;
  for (let i = lowerBound(kept, y - CROWD_YEARS, true); ; i++) {
    const a = i < kept.length && kept[i] <= y ? kept[i] : y;
    best = Math.max(best, lowerBound(kept, a + CROWD_YEARS) - lowerBound(kept, a));
    if (a === y) return best;
  }
}

/** 第一个不小于 v(after:大于 v)的下标(a 从小到大) */
function lowerBound(a: readonly number[], v: number, after = false): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < v || (after && a[m] === v)) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** 同一个地方接连几件合成一段:和这段第一件同一座城、或事发地相距不到 MERGE_REACH 个州,和前一件相隔不到 MERGE_YEARS 年,最多 MERGE_MAX 件 */
function mergeGroups(ctx: ShotCtx, items: readonly Cand[]): Cand[][] {
  const reach = MERGE_REACH * ctx.unit;
  const groups: Cand[][] = [];
  for (const c of items) {
    const g = groups[groups.length - 1];
    // 情节、守在关上的那一下(镜头要落在关口上)各自单独一段
    const alone = (x: Cand) => !!x.plot || x.spot?.kind === 'pass';
    if (g && g.length < MERGE_MAX && !alone(c) && !alone(g[0]) && c.entry.year - g[g.length - 1].entry.year <= MERGE_YEARS && samePlace(g[0], c, reach, ctx.W)) g.push(c);
    else groups.push([c]);
  }
  return groups;
}

function samePlace(a: Cand, b: Cand, reach: number, W: number): boolean {
  if (!a.pin || !b.pin) return false;
  if (a.spot && b.spot && a.spot.kind === 'settlement' && b.spot.kind === 'settlement' && a.spot.id === b.spot.id) return true;
  return Math.hypot(nearX(b.pin[0], a.pin[0], W) - a.pin[0], b.pin[1] - a.pin[1]) <= reach;
}

/** 一段:镜头包住每一件的范围(x 按第一件展开),target 取分量最重那件的 */
function segmentOf(ctx: ShotCtx, g: readonly Cand[], at: number, times: readonly number[]): DirectorSegment {
  let lead = 0;
  for (let i = 1; i < g.length; i++) if (g[i].weight > g[lead].weight) lead = i;
  let box: [number, number, number, number] | null = null;
  const ref = g.find((c) => c.box)?.pin?.[0] ?? 0;
  for (const c of g) {
    if (!c.box || !c.pin) continue;
    // 每件的范围按它自己的事发地展开过,整个挪到离第一件最近的那一份
    const d = nearX(c.pin[0], ref, ctx.W) - c.pin[0];
    const b: [number, number, number, number] = [c.box[0] + d, c.box[1], c.box[2] + d, c.box[3]];
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  const items = g.map((c, i) => ({ ...captionOf(c), at: times[i], hold: c.hold }));
  const endT = times[g.length - 1] + g[g.length - 1].hold;
  const spot = g[lead].box ? g[lead].spot : (g.find((c) => c.box)?.spot ?? null);
  return {
    at,
    hold: endT - at,
    year: g[0].entry.year,
    yearEnd: g[g.length - 1].entry.year,
    shot: box ? shotOf(ctx, box, spot) : null,
    items,
    lead,
    weight: g[lead].weight,
  };
}

// ---------------------------------------------------------------------------
// 排时间

/** 自动:没事的年份按 rate 走;到一段停下,镜头飞,字幕一件接一件,年份跟着从这一件走到下一件 */
function autoTimes(ctx: ShotCtx, groups: readonly Cand[][], from: number, to: number, rate: number) {
  const clock: DirectorKey[] = [{ t: 0, year: from }];
  const key = (t: number, year: number) => {
    const k = clock[clock.length - 1];
    if (k.t === t && k.year === year) return;
    clock.push({ t, year });
  };
  const segments: DirectorSegment[] = [];
  let t = 0;
  let y = from;
  for (const g of groups) {
    const y0 = Math.max(y, g[0].entry.year);
    t += (y0 - y) / rate;
    key(t, y0);
    const at = t;
    t += DIRECTOR_FLY;
    const times: number[] = [];
    for (const c of g) {
      times.push(t);
      key(t, Math.max(y0, c.entry.year));
      t += c.hold;
    }
    y = Math.max(y0, g[g.length - 1].entry.year);
    key(t, y);
    segments.push(segmentOf(ctx, g, at, times));
  }
  t += Math.max(0, to - y) / rate;
  key(t, to);
  return { segments, clock, duration: t };
}

/**
 * 固定速度:年份一直按 rate 走。每段想在第一件发生的那一刻出字幕(镜头提前 DIRECTOR_FLY 秒起飞),字幕一件接一件、
 * 每件不早于它发生的那一刻;段和段不重叠,撞了最多往后挪 FIXED_SHIFT 秒。分量重的段先排;排不下的只留它分量最重的那件再试一次。
 * exact(给了可用时长):讲不到最后一年放完那一刻的也算排不下;不然最后一段可以讲过头,年份停在最后一年等它讲完。
 * 大纲的情节一条不丢:撞了往后挪到放得下为止,讲过头也讲
 */
function fixedTimes(ctx: ShotCtx, groups: readonly Cand[][], from: number, to: number, rate: number, exact: boolean, onSkip: (c: Cand) => void) {
  const T = (to - from) / rate;
  const natural = (y: number) => Math.max(0, (y - from) / rate);
  const taken: { at: number; end: number }[] = [];
  const layout = (g: readonly Cand[], s: number) => {
    let t = s + DIRECTOR_FLY;
    const times: number[] = [];
    for (const c of g) {
      t = Math.max(t, natural(c.entry.year));
      times.push(t);
      t += c.hold;
    }
    return { times, end: t };
  };
  const free = (s: number, end: number) => taken.every((p) => end <= p.at || s >= p.end);
  const place = (g: readonly Cand[]): { at: number; times: number[] } | null => {
    const pref = Math.max(0, natural(g[0].entry.year) - DIRECTOR_FLY);
    const plot = g.some((c) => c.plot);
    const starts = [pref, ...taken.map((p) => p.end).filter((e) => e > pref && (plot || e <= pref + FIXED_SHIFT))].sort((a, b) => a - b);
    for (const s of starts) {
      const l = layout(g, s);
      if (exact && !plot && l.end > T + 1e-9) break;
      if (free(s, l.end)) {
        taken.push({ at: s, end: l.end });
        return { at: s, times: l.times };
      }
    }
    return null;
  };
  const leadOf = (g: readonly Cand[]) => g.reduce((a, c) => (c.weight > a.weight ? c : a), g[0]);
  const order = [...groups].sort((a, b) => byWeight(leadOf(a), leadOf(b)));
  const segments: DirectorSegment[] = [];
  for (const g of order) {
    let use: readonly Cand[] = g;
    let p = place(g);
    if (!p && g.length > 1) {
      use = [leadOf(g)];
      p = place(use);
    }
    if (!p) {
      g.forEach(onSkip);
      continue;
    }
    for (const c of g) if (!use.includes(c)) onSkip(c);
    segments.push(segmentOf(ctx, use, p.at, p.times));
  }
  segments.sort((a, b) => a.at - b.at);
  const clock: DirectorKey[] = [{ t: 0, year: from }];
  if (T > 0) clock.push({ t: T, year: to });
  const tail = segments.reduce((m, s) => Math.max(m, s.at + s.hold), T);
  if (tail > T) clock.push({ t: tail, year: to });
  return { segments, clock, duration: tail };
}

// ---------------------------------------------------------------------------
// 放的时候用

/** 第 t 秒放到哪一年(两个关键点之间匀速;超出两头 = 第一年 / 最后一年) */
export function directorYear(plan: DirectorPlan, t: number): number {
  const k = plan.clock;
  if (!(t > k[0].t)) return k[0].year;
  const last = k[k.length - 1];
  if (t >= last.t) return last.year;
  let lo = 0;
  let hi = k.length - 1;
  // 找最后一个 k[i].t <= t
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (k[m].t <= t) lo = m;
    else hi = m - 1;
  }
  const a = k[lo];
  const b = k[lo + 1];
  return b.t > a.t ? a.year + ((b.year - a.year) * (t - a.t)) / (b.t - a.t) : b.year;
}

/** 第一次放到第 year 年是第几秒(从这一年接着放时用;早于第一年 = 0,晚于最后一年 = 最后那个关键点) */
export function directorTime(plan: DirectorPlan, year: number): number {
  const k = plan.clock;
  if (!(year > k[0].year)) return k[0].t;
  const last = k[k.length - 1];
  if (year > last.year) return last.t;
  let lo = 0;
  let hi = k.length - 1;
  // 找第一个 k[i].year >= year
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (k[m].year < year) lo = m + 1;
    else hi = m;
  }
  const b = k[lo];
  const a = k[lo - 1];
  return a.year < b.year ? a.t + ((b.t - a.t) * (year - a.year)) / (b.year - a.year) : b.t;
}

/** 第 t 秒在放哪一段、哪一件(item = −1:镜头还在飞,字幕没出来);没在放 = null */
export function directorAt(plan: DirectorPlan, t: number): { seg: number; item: number } | null {
  const s = plan.segments;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m].at <= t) lo = m + 1;
    else hi = m;
  }
  const i = lo - 1;
  if (i < 0 || t >= s[i].at + s[i].hold) return null;
  let item = -1;
  s[i].items.forEach((it, k) => {
    if (t >= it.at && t < it.at + it.hold) item = k;
  });
  return { seg: i, item };
}

/** "下一件":第 t 秒以后开始的第一段(没有 = −1) */
export function directorNext(plan: DirectorPlan, t: number): number {
  return plan.segments.findIndex((s) => s.at > t + 1e-9);
}
