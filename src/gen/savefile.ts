/**
 * 存档文件(阶段 4):一个世界 = 种子 + 参数 + 用户的修改(gen/edits.ts 的 WorldEdits)。
 * 同种子 + 参数 = 同一个世界,所以不存地形、历史,文件只有几 KB;读档时先按参数重新生成,再套上修改。
 *
 * 文件是普通的 JSON(开放格式,不锁定数据),浏览器里的自动存档(ui/saveStore.ts)也用同一个格式:
 *
 * ```json
 * {
 *   "app": "文明与地图", "format": 1, "generator": 5,
 *   "seed": 7, "params": { "seed": 7, "cells": 36000, ... },
 *   "edits": { "names": { "settlement:c4567#0": "饕餮城", "region:c8123": "九嶷州" }, "interventions": [],
 *              "terrain": [{ "kind": "volcano", "pts": [812, 403], "r": 28, "s": 1.05 }] },
 *   "check": "3f9a0c1d7b2e", "savedAt": "2026-09-27T08:00:00.000Z",
 *   "title": "九州大陆", "view": { "projection": "robinson", "center": 120 }
 * }
 * ```
 *
 * - format:存档格式的版本(字段有不兼容的变化时加一;读到比自己新的格式就不读,提示更新页面)。
 *   2 = 进度、命令、支线、干预、推到哪一刻(endTick)里有落在年中的时刻(年 + 年内第几格,edits.ts 文件头"时刻"):只认识年份的版本会把它当成年初,
 *   所以写成 2,让那些版本提示更新页面、不悄悄读错。只到年初的存档照旧写 1(和加年内第几格以前一模一样,旧版本照常打开)。
 *   3 = 用了非官方规则(edits.rules):不认得规则的版本会按官方规则推出另一段历史,所以写成 3,让那些版本提示更新页面;
 *   用官方规则的世界照旧写 1 / 2,一字不差。
 *   4 = 规则按第 2 版以后的换算推(edits.rules.calc,civ/ruleSet.ts):不认得换算版本的版本会按第 1 版换、推出另一段历史,所以写成 4,
 *   让那些版本提示更新页面;按第 1 版换的照旧写 3。认得格式 4 的版本读到比自己新的换算版本(calc 大于 tuning.ts 的 TUNING_CALC)也不读,
 *   提示更新页面。
 *   5 = 地图留着的世界(edits.map.grown,edits.ts 文件头"地图留着的世界"):地图是存下来的,按种子长的不是它。不认得这一项的版本会按种子长一颗别的星球,
 *   所以写成 5,让那些版本提示更新页面;别的世界照旧写 1–4,一字不差。1–5 都照读(saveFormatOf 定写哪一版)
 * - generator:生成器版本(edits.ts 的 GENERATOR_VERSION);和当前的不同 = 同样的参数可能生成不同的世界
 * - check:地形的短哈希(worldCheck);读档生成完再算一遍,对不上也说明地形变了。两种情况都照样打开,
 *   提示"改过的名字会尽量套上"(稳定键按州、地块定位,地形变化不大时大多还能对上)
 * - edits.aiNames(可选):哪些名字是从 AI 起名里挑的(edits.ts 文件头"改名"),`{ "polity:c4567#0": { "name": "青渊", "was": "渊" } }`;
 *   只存现在还用着的那几个,旧存档没有 = 一个也没有
 * - edits.flags(可选):改过的国旗(edits.ts 文件头"改旗"),`{ "polity:c4567#0": "b/plain/W/e=R/k=long" }`;
 *   读档时逐面核对写法(civ/flags.ts 的 decodeFlag),格式不对的跳过。旧存档没有 = 一面也没改
 * - edits.interventions:干预(具体种类见 edits.ts 文件头"干预");这里当成不透明的数组原样存、原样读回
 * - edits.terrain:地形修改(edits.ts 文件头"地形修改");读档时逐处过 cleanTerrainOp,格式不对的跳过。
 *   旧存档没有这个字段 = 没改地形。check 是**改过地形以后**的地形哈希(读档时带着地形修改生成,再核对)
 * - edits.sketch(可选):地形草图(edits.ts 文件头"地形草图"),`{ "rest": "auto", "strokes": [{ "kind": "land", "r": 32, "pts": [700, 300, 760, 310] }] }`,
 *   导入过图片的多一个 `"image": { "name": "地图.jpg", "cells": "<认出来的格子图>" }`,改过板块的多一个 `"plates": { "ops": [{ "kind": "cut", "pts": [600, 340, 640, 500] }] }`;
 *   没画时不写这个字段。读档时过 cleanSketch,格式不对的笔画、图片跳过。check 同样是照草图生成以后的地形哈希
 * - edits.upheavals(可选):地形大事(edits.ts 文件头"地形大事"),`[{ "year": 1600, "ops": [{ "kind": "sink", "pts": [1856, 574, 1936, 584], "r": 40, "s": 1.1 }] }]`;
 *   没有时不写这个字段。读档时过 cleanUpheaval,格式不对的跳过。check 只核对原来的地形(大事之后的地形由它和大事一起定)
 * - edits.marks(可选):作者标记(edits.ts 文件头"作者标记"),`[{ "id": 1, "title": "主角的故乡", "color": "red", "from": 2490, "at": [1852.4, 512] }]`;
 *   没有标记时不写这个字段。读档时过 cleanMarks,格式不对的跳过
 * - edits.characters(可选):作者的人物(characters.ts),`[{ "id": 1, "name": "林小满", "color": "red", "born": 2490, "died": 2561,
 *   "birthplace": "settlement:c4567#0", "life": [{ "year": 2506, "text": "随军西征", "where": "region:c8123" }] }]`;
 *   女的多一项 `"female": true`(以前的存档没有这一项,读出来都是男的)。没有人物时不写这个字段。读档时逐个过 cleanCharacter,格式不对的跳过
 * - edits.nameMix(可选):整个世界的地名风格,每种语感占几份(edits.ts 文件头"地名风格"),`{ "xianxia": 6, "central": 4 }`;自动时不写。
 *   读档时过 cleanMix:认不出的语感(比如以后的新语感)、不是正数的份数去掉,提示一句;一份都不剩就按自动
 * - edits.endYear(可选):历史推到第几年(edits.ts 文件头"推演年数"),`12000`;3000 年时不写。
 *   读档时过 cleanEndYear:取整到年、夹在 1–60000(逐年推演存回的普通世界可以不到 3000 年;以前只有 3000 起的整千年,照旧读出同一个数);不是数字的按 3000,提示一句
 * - edits.endTick(可选):推到那一年的第几格(同上,逐年推演停在年中时存回的普通世界才有),`192`(格式 2);年初的不写。
 *   读档时过 cleanEndTick:不是 1–255 的整数、推到 60000 年的去掉(按那一年年初推),提示一句
 * - edits.frontier(可选):拓荒(edits.ts 文件头"拓荒与起源"、civ/frontier.ts),`{ "spread": 1.5, "expand": 2, "terrain": { "desert": 6 } }`;
 *   都是默认时不写。读档时过 cleanFrontier:吸到最近的一档,认不出的项去掉,提示一句
 * - edits.origins(可选):自己选的文明起源(同上),`{ "pts": [976, 342, 544, 448], "only": true }`;自动时不写。
 *   读档时过 cleanOrigins:坐标取整、去重,最多 16 处;认不出的按自动,提示一句
 * - edits.calamity(可选):「天灾」(edits.ts 文件头"天灾"、civ/calamity.ts),`"more"` 多 / `"many"` 很多;平常时不写。
 *   读档时过 cleanCalamity:认不出的按平常,提示一句
 * - edits.rules(可选):这个世界用的一套规则(civ/ruleSet.ts),整套存下(名字、第几版、基于谁、署名、介绍、改过的规则项、地貌的叫法、本机编号),
 *   `{ "id": "rmh3k2x9a4f", "name": "战乱年代", "version": 2, "values": { "war.odds": 2, "war.length": [3, 20] }, "biomes": { "temperateDesert": "灰烬荒原" } }`;
 *   自包含:本机删了这一套、作者出了新版,世界照样一模一样。和官方一样(没改规则项、没改地貌的叫法)时不写;写了的存档是格式 3(见上)。
 *   建世界时盖上的换算版本(规则项按第几版换成推演的旋钮)记在 `"calc": 2`;第 1 版不写(加这一项以前的都是第 1 版),写了的是格式 4(见上):
 *   换算以后加强了,这个世界照样按它建成时的那一版推,历史不变。
 *   读档时过 cleanRuleSet(world):认不出的项丢掉、超出范围的拉回来、太长的字截断,几处提示并成一句;换算版本认不出的按第 1 版
 * - edits.civSeed(可选):文明种子(edits.ts 文件头"文明种子"),`52817`;等于地图种子时不写(加这一项以前的存档都没写)。
 *   读档时过 cleanCivSeed:不是整数的去掉(按地图种子推),提示一句
 * - edits.map(可选):在别的世界的地图上新开的历史,用的是哪张地图(edits.ts 文件头"文明种子"),
 *   `{ "sum": "<地图那块原件的 SHA-256>", "from": "<从哪个世界新开的>" }`;不是新开的不写。读档时过 cleanMapRef,认不出的项去掉(不提示:只是记录)。
 *   地图留着的世界多一项 `"grown": 57`(地图是第几版生成器长的,edits.ts 文件头"地图留着的世界"):这一项就不只是记录了,地图只从存下的内容读,写了的是格式 5(见上)
 * - edits.era(可选):纪年(edits.ts 文件头"纪年"、era.ts),`{ "name": "公元", "epoch": 2500 }`;按一件事定的
 *   `{ "name": "利希历", "epoch": 1610, "by": "event", "event": { "tag": "创", "text": "利希昂于菲内拉斯创立利希教" } }`;
 *   按第几年写时不写。读档时过 cleanEra:名字、元年不合格的按第几年写,提示一句
 * - edits.months(可选):一年几个月(edits.ts 文件头"月份"),`24`;只写年 `0`;一年 12 个月时不写。
 *   读档时过 cleanMonths:认不出的按 12 个月,提示一句
 * - edits.monthNames(可选):自己起的月份名字(edits.ts 文件头"月份"),`{ "names": ["端月", "杏月", "", "槐月"] }`,'' = 那个月没起名;
 *   换回「数字」时名字留着,记 `"off": true`;一个名字都没有时不写。读档时过 cleanMonthNames:认不出的名字当没起名(写数字),提示一句
 * - edits.play(可选):逐年推演的进度(edits.ts 文件头"逐年推演的进度"),`{ "year": 825, "commands": [{ "kind": "declare", "a": "polity:c4567#0", "b": "polity:c8123#0", "from": 825 }] }`;
 *   停在年中的多一个 tick(那一年的第几格),那时下的命令多一个 fromTick:`{ "year": 825, "tick": 192, "commands": [{ …, "from": 825, "fromTick": 192 }] }`(格式 2)。
 *   没在逐年推演时不写。读档时过 cleanPlay:年份、第几格不对的当没在逐年推演、不合格的命令丢掉,提示一句。
 *   读回来按"推到哪一刻 + 命令串"重新推出同一刻(civ/play.ts 的 playCiv);没有 tick 的(旧存档)就是那一年年初
 * - edits.playFrom(可选):这次逐年推演从第几年起(edits.ts 文件头"逐年推演的进度"),`2650`;没在逐年推演、从第 0 年起的不写。
 *   读档时过 cleanPlayFrom:取整、夹到 [0, play.year],没有 play 的去掉(不提示:只是记录)
 * - edits.branches(可选):逐年推演另开的几支(edits.ts 文件头"支线"),当前这一支照旧在 play、playFrom 里,
 *   `{ "id": 3, "name": "北伐", "list": [{ "id": 1, "from": 2660, "year": 2700, "commands": [{ "kind": "unity", "a": "polity:c4567#0", "from": 2660 }] }] }`;
 *   每支只记从哪年起和当前这一支不一样、那以后的命令;年中的时刻多一个 fromTick、tick、forkTick(同 play.tick,格式 2)。只有当前这一支时不写。读档时过 cleanBranches:没有 play 的去掉,
 *   不合格的那一支去掉,提示一句。只认识 play 的版本读到这一项会跳过,看到的是当前这一支
 * - edits.advance(可选):推进设置(edits.ts 文件头"推进设置"),`{ "step": 5, "every": 50, "big": true, "countdown": 0 }`;都是默认时不写。
 *   读档时过 cleanAdvance:认不出的项按默认,提示一句
 * - edits.follow(可选):导播跟着谁(edits.ts 文件头"导播跟着谁"),`{ "kind": "person", "key": "person:polity:c4567#0|general|燕鸾澈|1470" }`;
 *   全世界的大事时不写。读档时过 cleanFollow:认不出的当没有,提示一句。不算修改(改了几处、换成别处的存档丢了几处都不数它)
 * - edits.outline(可选):大纲(edits.ts 文件头"大纲"),`{ "plots": [{ "id": 1, "kind": "war", "year": 1520, "a": "polity:c4567#0", "b": "polity:c8123#0", "text": "北燕伐南梁" }],
 *   "review": [{ "id": 1, "status": "forced", "year": 1520 }] }`;没写大纲时不写。读档时过 cleanOutline:格式不对的情节跳过,提示一句。
 *   照大纲硬改出来的干预在 edits.interventions 里(带 plot),和别的干预一样存。从别的世界搬过来、对不上的几项记在情节的 redo 里
 *   (`"redo": { "b": "奥利亚王国" }`,原来叫什么;那几项不在情节里,edits.ts 文件头"要重新指")
 * - view:看这个世界用的投影和中央经线(`{ "projection": "robinson", "center": 120 }`,可选)。
 *   投影名原样存(render/projection.ts 的 ProjectionId,或 "globe"),认不出的由界面当成等距圆柱;
 *   旧存档没有这个字段 = 等距圆柱、中央经线 0°
 * - origin:底稿出处(可选)。打开别人的分享短链接、改了另存进自己的"我的世界"时记下:分享的人填的署名(可以没有)、
 *   那时的世界名、分享链接(`{ "by": "明月", "title": "苍澜界", "url": "https://…/s/k7Qm2xPa" }`)。
 *   来自作品墙的多一个作品编号,署名、名字是作品的,链接是那个作品的地址
 *   (`{ "by": "砚山", "title": "金阳洋两岸", "url": "https://…/?gallery=k7qm2xpa", "gallery": "k7qm2xpa" }`;旧存档没有这一项,照常打开)。
 *   跟着世界走(存成文件、同步、再分享都带着);别人再从这一份另存,记的是直接的来源,不往上追
 * - moment:打开时看哪(可选,只在分享里带;见下面 SaveMoment),
 *   `{ "year": 1500, "selected": "polity:c32577#0", "camera": { "lon": 112.4, "lat": 31.25, "zoom": 2.5 } }`:
 *   别人打开分享链接时,时间轴停在第 year 年、选中 selected(国家或州的稳定键,见 edits.ts 文件头"稳定键")、
 *   画面正中对着经纬度 (lon, lat)、放大 zoom 倍(平面地图按宽度算:1 = 整圈经线正好占满画面的宽,
 *   同一个倍数在电脑和手机上横着看到的一样宽;地球仪是它自己的倍数)。三样都可以没有,
 *   没有的那样照平常打开。不改变世界本身(和种子、参数、修改无关),所以不进"我的世界"的自动存档(makeSave 不写它)。
 *   读档时过 cleanMoment:年份不是 0 到这个世界推到的那年(逐年推演的是"现在"那年)、键的样子不对、经纬度和倍数不是数的,
 *   那一样去掉,不提示(只是打开时的位置);旧链接没有这个字段 = 照平常打开。键在这个世界里找不到(国家不存在)由
 *   resolveMoment 按生成好的历史再核对一次,找不到的不选
 *
 * 纯计算,不碰 DOM(Node 里可测)。
 */
import type { World } from './world';
import { DEFAULT_PARAMS, type BaseParamKey, type WorldParams } from './params';
import type { SystemOverrides } from './astroDesign';
import type { StoredLayers } from './systemLayers';
import { layersOfOverrides, overridesOfLayers } from './systemLayers';
import { setCurrentSystem } from './systemState';
import { cleanMix, sameMix } from './names/mix';
import { END_YEAR_DEFAULT, END_YEAR_MAX, GENERATOR_CHANGES, GENERATOR_VERSION, MARKS_MAX, MARK_REGIONS_TOTAL, NAME_MAX, YEAR_TICKS, aiNameKeys, cleanCivSeed, cleanEndTick, cleanEndYear, endAtOf, endParamOf, keptMapOf, playAt, cleanMapRef, cleanMark, cleanPlay, cleanPlayFrom, cleanBranches, branchPlay, playState, cleanAdvance, advanceOf, sameAdvance, cleanFollow, cleanOutline, endYearOf, freeMarkId, resolveKey, type AdvanceSettings, type AiNameMark, type AuthorMark, type GeneratorChange, type Intervention, type Outline, type PlayBranches, type PlayState, type TerrainOp, type Upheaval, type WorldEdits } from './edits';
import type { Civ } from './civ/types';
import { TERRAIN_MAX_OPS, UPHEAVALS_MAX, UPHEAVAL_KINDS, UPHEAVAL_OPS_MAX, cleanTerrainOp, cleanUpheaval } from './terrainOps';
import { SKETCH_MAX_STROKES, cleanSketch, cleanSketchStroke, type SketchEdit } from './sketch';
import type { PlateEdit } from './plateOps';
import { decodeFlag } from './civ/story/flagSpec';
import { CHARACTERS_MAX, cleanCharacters, type AuthorCharacter } from './characters';
import { MONTHS_MAX, cleanEra, cleanMonthName, cleanMonthNames, cleanMonths, sameEra, sameMonthNames } from './era';
import { cleanFrontier, cleanOrigins, sameFrontier, sameOrigins } from './civ/frontier';
import { cleanCalamity } from './civ/calamity';
import { SIGNATURE_MAX, cleanSignature } from './signature';
import { RULES_FILE_ERROR, cleanRuleSet, isOfficialRules, isRulesFileLike, ruleNotesLine, sameRuleSet, worldCalc, worldRules, worldTuning } from './civ/ruleSet';
import { TUNING_CALC } from './civ/tuning';

export { SIGNATURE_MAX, SIGNATURE_UNITS, cleanSignature } from './signature';

export const SAVE_APP = '文明与地图';
/**
 * 存档格式版本:读得了的最新一版(见文件头 format)。加一时注意:旧版网站读不了更新格式的存档,打开文件、分享链接读进来的存档已经换成了现在的格式
 * (saveFormatOf 按内容定:用得着新格式的才写新的),「看原样」(ui/oldSite.ts)交给旧版网站的是那一版自己存的那一份,格式是它认得的。
 * 带规则的世界(格式 3)只有认得格式 3 的版本才存得出来,交回那一版的旧网站照样认得;万一交给了不认得的版本,那边提示刷新、不读,
 * 不会把它当成官方规则的世界推出另一段历史(所以不能为了让旧版本打开而去掉规则、换回 1 或 2)。格式 4(换算第 2 版以后的规则)同理
 */
export const SAVE_FORMAT = 5;
/** 只到年初的存档写的格式(加年内第几格以前的那一版,旧版本照常打开) */
const SAVE_FORMAT_YEARS = 1;
/** 有落在年中的时刻的存档写的格式(加规则以前的那一版) */
const SAVE_FORMAT_TICKS = 2;
/** 用了非官方规则、按第 1 版换算的存档写的格式(加换算版本以前的那一版) */
const SAVE_FORMAT_RULES = 3;
/** 规则按第 2 版以后的换算推的存档写的格式(加地图留着的世界以前的那一版) */
const SAVE_FORMAT_CALC = 4;

/**
 * 存档该写哪一版格式:地图留着的世界 = 5;规则按第 2 版以后的换算推(改了规则项、记着 calc)= 4;用了非官方规则 = 3;
 * 修改里有落在年中的时刻(第几格不是 0)= 2;都没有 = 1(见文件头 format)
 */
export function saveFormatOf(edits: WorldEdits): 1 | 2 | 3 | 4 | 5 {
  if (keptMapOf(edits)) return SAVE_FORMAT;
  if (worldTuning(edits.rules) && worldCalc(edits.rules) > 1) return SAVE_FORMAT_CALC;
  if (!isOfficialRules(edits.rules)) return SAVE_FORMAT_RULES;
  const iv = (list: readonly Intervention[] | undefined) => !!list?.some((v) => v.fromTick);
  const b = edits.branches;
  const sub =
    !!edits.endTick ||
    !!edits.play?.tick ||
    iv(edits.play?.commands) ||
    iv(edits.interventions) ||
    !!b?.forkTick ||
    !!b?.list?.some((x) => x.fromTick || x.tick || x.forkTick || iv(x.commands));
  return sub ? SAVE_FORMAT_TICKS : SAVE_FORMAT_YEARS;
}

/** 每个天体自己那份:世界种子偏移 + 文明(最多 4 个);主天体仍用顶层 params/edits */
export interface SaveBody {
  /** 天体 id:`p0` 行星 0、`m0-1` 行星 0 的第 1 颗卫星(和树/覆盖表下标一致) */
  id: string;
  /** 这颗天体世界用的种子偏移(不写 = 由主种子 + id 派生) */
  seedShift?: number;
  /** 这颗天体上的文明(最多 4;结构由上层文明系统决定,这里只做形状校验) */
  civs?: unknown[];
}

export interface SaveFile {
  app: '文明与地图';
  format: 1 | 2 | 3 | 4 | 5;
  /** 生成器版本(GENERATOR_VERSION) */
  generator: number;
  seed: number;
  params: WorldParams;
  edits: WorldEdits;
  /** 地形的短哈希(worldCheck) */
  check: string;
  /** 用户给这个世界起的名字("九州大陆") */
  title?: string;
  /** 看这个世界用的投影和中央经线;没有 = 等距圆柱、0° */
  view?: SaveView;
  /** 逐行星/卫星覆盖表(星系结构编辑的结果);没有 = 单行星世界(和以前一样) */
  system?: SystemOverrides;
  /** 每天体的世界/文明(步 11;不写 = 只有主天体,和以前一样) */
  bodies?: SaveBody[];
  /** 星系分层存档(SystemSpec 的持久化形态;存在时优先于 system,读不懂回落到 system) */
  systemSpec?: StoredLayers;
  /** 底稿出处:从别人的分享链接另存来的 */
  origin?: SaveOrigin;
  /** 打开时看哪(只在分享里带;见文件头"moment") */
  moment?: SaveMoment;
  /** 存档时间(ISO 8601) */
  savedAt: string;
}

/** 打开时看哪:分享的人那一刻的年份、选中的东西、镜头;三样都可以没有 */
export interface SaveMoment {
  /** 时间轴停在第几年(可以带小数,存到千分之一年) */
  year?: number;
  /** 选中的国家或州:稳定键(`polity:c32577#0`、`region:c8123`) */
  selected?: string;
  /** 镜头 */
  camera?: SaveCamera;
}

/** 镜头:画面正中对着的经纬度(度)、放大倍数(平面地图 1 = 整圈经线正好占满画面的宽;地球仪是它自己的倍数) */
export interface SaveCamera {
  lon: number;
  lat: number;
  zoom: number;
}

/** 底稿出处 */
export interface SaveOrigin {
  /** 分享的人填的署名(来自作品墙的:作品的署名);没填 = 没有 */
  by?: string;
  /** 另存那时的世界名(没起名 = 空;来自作品墙的:作品名) */
  title: string;
  /** 分享链接(网站地址/s/<码>);来自作品墙的:那个作品的地址(网站地址/?gallery=<编号>) */
  url: string;
  /** 来自作品墙的哪个作品(作品编号);分享链接来的没有 */
  gallery?: string;
}

/** 投影 + 中央经线 + 经纬网 + 等值线(存进存档、分享链接) */
export interface SaveView {
  /** 投影名:"equirect" 等距圆柱、"robinson" 罗宾森、"naturalEarth"、"mollweide"、"mercator"、"globe" 地球仪…… */
  projection: string;
  /** 中央经线(度,−180 … 180) */
  center: number;
  /** 经纬网:每隔几度一条(10 / 15 / 30),0 = 不画;没有 = 旧存档没记(打开时不动当前的经纬网) */
  graticule?: number;
  /** 等值线:elev 等高线 / temp 等温线 / precip 等降水线,'' = 不画;没有 = 旧存档没记(打开时不动当前的) */
  contours?: ContourKind | '';
}

/** 等值线的种类(一次只叠一种) */
export const CONTOUR_KINDS = ['elev', 'temp', 'precip'] as const;
export type ContourKind = (typeof CONTOUR_KINDS)[number];
export function isContourKind(x: unknown): x is ContourKind {
  return CONTOUR_KINDS.includes(x as ContourKind);
}

/** 经纬网能选的间隔(度) */
export const GRATICULE_STEPS = [10, 15, 30] as const;

/** 没存投影的存档(旧存档)按这个看 */
export const DEFAULT_VIEW: SaveView = { projection: 'equirect', center: 0 };

/** 整理投影设置:投影名只收短的字母串,中央经线挪到 [−180, 180)、保留两位小数;不像样的 = null */
export function cleanView(raw: unknown): SaveView | null {
  if (!isObj(raw)) return null;
  const p = raw.projection;
  const c = raw.center;
  if (typeof p !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(p)) return null;
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  const t = (c + 180) / 360;
  const lon = (t - Math.floor(t)) * 360 - 180;
  const v: SaveView = { projection: p, center: Math.round(lon * 100) / 100 };
  // 经纬网:认得的间隔或 0;别的当没记
  const g = raw.graticule;
  if (g === 0 || GRATICULE_STEPS.includes(g as (typeof GRATICULE_STEPS)[number])) v.graticule = g as number;
  const iso = raw.contours;
  if (iso === '' || isContourKind(iso)) v.contours = iso;
  return v;
}

/** 来自作品墙的出处:作品名、署名最长几个字(和作品墙上一样长,见 account/gallery.ts;比世界名、分享的署名长) */
export const GALLERY_TITLE_MAX = 60;
export const GALLERY_BY_MAX = 40;

/** 分享短链接的样子:http(s)://网站地址/s/<码>(网站可以在子目录里) */
const ORIGIN_CHARS = /^https?:\/\/[^\s"'<>\\]+$/;
const ORIGIN_PATH = /\/s\/[A-Za-z0-9]{4,32}$/;

/** 是不是分享短链接:按网址解析,路径以 /s/<码> 结尾,不带账号密码、问号后的参数、# 后的部分,而且本来就是规范写法 */
function isShareLink(url: string): boolean {
  if (url.length > 300 || !ORIGIN_CHARS.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && !u.search && !u.hash && ORIGIN_PATH.test(u.pathname) && u.href === url;
}

/** 作品墙的作品编号:8 位小写字母和数字(去掉了容易看错的 i、l、o、0、1) */
const GALLERY_ID = /^[a-hjkmnp-z2-9]{8}$/;

/** 是不是作品墙上那个作品的地址:http(s)://网站地址/?gallery=<编号>(网站可以在子目录里),不带账号密码、别的参数、# 后的部分 */
function isGalleryLink(url: string, id: string): boolean {
  if (url.length > 300 || !ORIGIN_CHARS.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && !u.hash && u.search === `?gallery=${id}` && u.pathname.endsWith('/') && u.href === url;
}

/**
 * 整理底稿出处:链接不像分享短链接的不要(界面上它是一个能点的链接);
 * 来自作品墙的(带作品编号):链接得是那个作品的地址,作品名、署名按作品墙上的长度留(GALLERY_TITLE_MAX、GALLERY_BY_MAX)
 */
export function cleanOrigin(raw: unknown): SaveOrigin | null {
  if (!isObj(raw)) return null;
  const url = raw.url;
  const gallery = raw.gallery;
  if (typeof url !== 'string') return null;
  if (gallery !== undefined) {
    if (typeof gallery !== 'string' || !GALLERY_ID.test(gallery) || !isGalleryLink(url, gallery)) return null;
  } else if (!isShareLink(url)) return null;
  const wall = typeof gallery === 'string';
  const o: SaveOrigin = { title: cleanTitle(raw.title, wall ? GALLERY_TITLE_MAX : TITLE_MAX), url };
  const by = cleanSignature(raw.by, wall ? GALLERY_BY_MAX : SIGNATURE_MAX);
  if (by) o.by = by;
  if (wall) o.gallery = gallery;
  return o;
}

/** 打开时选中的东西:国家、州的稳定键(新旧两种写法都认,见 edits.ts 文件头"稳定键";以后要放开城、人物再加) */
const MOMENT_KEY = /^(?:polity:(?:r-?\d{1,7}|c\d{1,7})#\d{1,5}|region:[rc]\d{1,7})$/;
/**
 * 镜头放大倍数的范围:平面地图按宽度算,手机竖屏放到最大约 50 倍(电脑约 12 倍),地球仪 0.55–8 倍,都在里面;
 * 界面再按投影、屏幕夹一次
 */
export const CAMERA_ZOOM_RANGE: readonly [number, number] = [0.5, 64];
/** 留到千分之一(年份、经纬度、倍数);同一个数清理两次结果不变 */
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** 镜头清理:三个数都得是有限数;经度挪到 [−180, 180)、纬度夹在 ±90、倍数夹在 CAMERA_ZOOM_RANGE,都留到千分之一。不像样的 = null */
export function cleanCamera(raw: unknown): SaveCamera | null {
  if (!isObj(raw)) return null;
  const { lon, lat, zoom } = raw;
  if (typeof lon !== 'number' || typeof lat !== 'number' || typeof zoom !== 'number') return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return null;
  let x = round3(((((lon + 180) % 360) + 360) % 360) - 180);
  if (x >= 180) x -= 360;
  const [z0, z1] = CAMERA_ZOOM_RANGE;
  return { lon: x, lat: round3(Math.min(90, Math.max(-90, lat))), zoom: round3(Math.min(z1, Math.max(z0, zoom))) };
}

/**
 * 打开时看哪的清理(见文件头"moment"):年份要在 [0, maxYear](这个世界推到的那年)、选中的要像国家或州的稳定键、镜头过 cleanCamera,
 * 不合格的那一样去掉;一样都不剩 = null
 */
export function cleanMoment(raw: unknown, maxYear: number = END_YEAR_MAX): SaveMoment | null {
  if (!isObj(raw)) return null;
  const m: SaveMoment = {};
  const y = raw.year;
  if (typeof y === 'number' && Number.isFinite(y) && y >= 0 && y <= maxYear) m.year = round3(y);
  const s = raw.selected;
  if (typeof s === 'string' && MOMENT_KEY.test(s)) m.selected = s;
  const c = cleanCamera(raw.camera);
  if (c) m.camera = c;
  return Object.keys(m).length ? m : null;
}

/** 这个世界的历史推到哪一刻(带小数的年份;逐年推演的 = "现在"那一刻,年中的带那一格):打开时看的年份不能超过它 */
export function momentYearMax(edits: Pick<WorldEdits, 'endYear' | 'endTick' | 'play'>): number {
  const play = cleanPlay(edits.play);
  return play ? playAt(play) / YEAR_TICKS : endAtOf(edits);
}

/** 分享前给存档带上"打开时看哪"(清理过;null 或一样都不剩 = 去掉)。返回新的一份,原来的不动 */
export function withMoment(save: SaveFile, moment: SaveMoment | null | undefined): SaveFile {
  const { moment: _old, ...rest } = save;
  const m = moment ? cleanMoment(moment, momentYearMax(save.edits)) : null;
  return m ? { ...rest, moment: m } : rest;
}

/** 按生成好的历史核对过的"打开时看哪":年份夹在历史以内,选中的换成这个世界里的编号(找不到 = 不选) */
export interface ResolvedMoment {
  year?: number;
  selected?: { kind: 'polity' | 'region'; id: number };
  camera?: SaveCamera;
}

/**
 * 打开分享链接、世界生成好以后,把存档里的"打开时看哪"对到这个世界上:
 * 年份超出这段历史的不要(逐年推演推到"现在"差不到一年的,按"现在"那一刻);选中的键找不到(国家不存在、版本变了)的不选;镜头原样
 */
export function resolveMoment(civ: Civ, moment: SaveMoment | null | undefined): ResolvedMoment {
  const out: ResolvedMoment = {};
  if (!moment) return out;
  const y = moment.year;
  if (y !== undefined && y >= 0 && y <= Math.ceil(civ.endYear)) out.year = Math.min(y, civ.endYear);
  if (moment.selected) {
    const r = resolveKey(civ, moment.selected);
    if (r && (r.kind === 'polity' || r.kind === 'region')) out.selected = { kind: r.kind, id: r.id };
  }
  if (moment.camera) out.camera = { ...moment.camera };
  return out;
}

/**
 * 分享短链接(网站/s/<码>,存档在服务器上)后面带的"打开时看哪":和长链接一样放在 # 后面,浏览器不发给服务器,
 * 每次复制的链接各带各的那一刻。`#at=1500&p=c32577.0&cam=112.4,31.25,2.5`:
 * at = 年份(可以空着)、p = 选中的国家(稳定键去掉 "polity:",# 换成 .)、r = 选中的州(去掉 "region:")、cam = 经度,纬度,倍数
 */
export const MOMENT_HASH_KEY = 'at';

/** "打开时看哪" → 短链接后面的 # 那段(清理过;一样都不剩 = '') */
export function momentHash(moment: SaveMoment | null | undefined): string {
  const m = moment ? cleanMoment(moment) : null;
  if (!m) return '';
  const parts = [`${MOMENT_HASH_KEY}=${m.year ?? ''}`];
  if (m.selected) {
    const p = /^polity:(.+)#(\d+)$/.exec(m.selected);
    parts.push(p ? `p=${p[1]}.${p[2]}` : `r=${m.selected.slice('region:'.length)}`);
  }
  if (m.camera) parts.push(`cam=${m.camera.lon},${m.camera.lat},${m.camera.zoom}`);
  return `#${parts.join('&')}`;
}

/** 网址的 # 那段是不是短链接带的"打开时看哪"(#at=…) */
export function isMomentHash(hash: string): boolean {
  return typeof hash === 'string' && new RegExp(`^#?${MOMENT_HASH_KEY}=`).test(hash.trim());
}

/** 短链接后面的 # 那段 → "打开时看哪"(过 cleanMoment;不像样的那一样去掉;不是这种 # 或一样都不剩 = null) */
export function decodeMomentHash(hash: string, maxYear: number = END_YEAR_MAX): SaveMoment | null {
  if (!isMomentHash(hash)) return null;
  const q = new URLSearchParams(hash.trim().replace(/^#/, '').replace(/\s+/g, ''));
  const raw: Record<string, unknown> = {};
  const y = q.get(MOMENT_HASH_KEY);
  if (y) raw.year = Number(y);
  const p = q.get('p');
  const r = q.get('r');
  if (p) {
    const i = p.lastIndexOf('.');
    if (i > 0) raw.selected = `polity:${p.slice(0, i)}#${p.slice(i + 1)}`;
  } else if (r) raw.selected = `region:${r}`;
  const cam = q.get('cam')?.split(',');
  if (cam?.length === 3 && cam.every((s) => s.trim() !== '')) raw.camera = { lon: Number(cam[0]), lat: Number(cam[1]), zoom: Number(cam[2]) };
  return cleanMoment(raw, maxYear);
}

/** 两份投影设置是不是一样(中央经线差不到 0.01° 算一样;经纬网有一份没记就不比) */
export function sameView(a: SaveView | null | undefined, b: SaveView | null | undefined): boolean {
  const x = a ?? DEFAULT_VIEW;
  const y = b ?? DEFAULT_VIEW;
  if (x.graticule !== undefined && y.graticule !== undefined && x.graticule !== y.graticule) return false;
  if (x.contours !== undefined && y.contours !== undefined && x.contours !== y.contours) return false;
  return x.projection === y.projection && Math.abs(x.center - y.center) < 0.005;
}

export type ParseResult = { ok: true; save: SaveFile; warnings: string[] } | { ok: false; error: string };

export const VERSION_NOTE_HEAD = '按新版算的：';

/** 生成器每种改动对应的说法(versionNote 接在 VERSION_NOTE_HEAD 后面) */
const CHANGE_TEXT: Record<GeneratorChange, string> = {
  planet: '整颗星球重新生成了，地形和历史都和原来不同',
  terrain: '地形有局部变化，历史重新推演了',
  climate: '陆地和山没变，气候、河流和历史都重算了',
  history: '地形和气候没变，历史重新推演了',
  routes: '地形和历史没变，道路和航线有些改动',
  chronicle: '疆域和兴亡没变，编年史写得更细了',
  people: '地形和历史没变，人物有些改动，名字跟着换了',
  names: '地形和历史没变，默认的地名换了',
  ideology: '地形和历史没变，各地的思潮重算了',
};
const CHANGE_RANK: GeneratorChange[] = ['ideology', 'names', 'people', 'chronicle', 'routes', 'history', 'climate', 'terrain', 'planet'];

/** 来自更新的版本(页面是旧的):不知道新版改了什么,只说怎么换到最新版 */
export const NEWER_NOTE = '来自更新的版本，刷新页面换到最新版再看';

/**
 * 这个世界改过什么(看哪几版生成器动了它):terrain = 改过地形(地形修改、草图),upheavals = 带地形大事。
 * 只给一个布尔 = 改没改过地形(没有地形大事)
 */
export type EditedWorld = boolean | { terrain: boolean; upheavals: boolean };

/** 世界的修改里改过什么(versionNote 的第二个参数) */
export function editedWorld(edits: Partial<Pick<WorldEdits, 'terrain' | 'sketch' | 'upheavals'>>): { terrain: boolean; upheavals: boolean } {
  return { terrain: (edits.terrain?.length ?? 0) > 0 || !!edits.sketch, upheavals: (edits.upheavals?.length ?? 0) > 0 };
}

/**
 * 从第 from 版生成器到现在,同样的种子、参数(改没改过地形、有没有地形大事)生成出来的世界变了什么:跨过的几版里最大的那种改动。
 * 一样 = null(比如只动了改过地形的世界的那一版,这个世界没改地形);比现在新 = 'newer';
 * 认不出的旧版本(没记版本号、不是整数、表里没有的)按整颗星球重新生成算
 */
function changeSince(from: number, edited: EditedWorld): GeneratorChange | 'newer' | null {
  if (from === GENERATOR_VERSION) return null;
  // 不是整数的版本号(手改过、坏了的存档)认不出,不管比现在大还是小,都按整颗星球重新生成算
  if (!Number.isInteger(from)) return 'planet';
  if (from > GENERATOR_VERSION) return 'newer';
  const terrain = typeof edited === 'boolean' ? edited : edited.terrain;
  const upheavals = typeof edited === 'boolean' ? false : edited.upheavals;
  let top = -1;
  for (let v = Math.max(1, from) + 1; v <= GENERATOR_VERSION; v++) {
    const c = GENERATOR_CHANGES[v];
    let change: GeneratorChange | undefined = c?.change;
    // 只动了带地形大事的世界的那一版:这个世界没有地形大事就跳过
    if (c?.only === 'upheavals' && !upheavals) continue;
    // 只动了改过地形(或带地形大事)的世界的那一版:这个世界两样都不沾就跳过
    if (c?.edited && !terrain) {
      if (!(upheavals && c.upheavals)) continue;
      change = c.upheavals;
    }
    const rank = change ? CHANGE_RANK.indexOf(change) : CHANGE_RANK.length - 1;
    top = Math.max(top, rank);
  }
  return top < 0 ? null : CHANGE_RANK[top];
}

/** 打开旧存档、旧链接时说清变了什么(见 changeSince);一样 = null;比现在新 = NEWER_NOTE */
export function versionNote(from: number, edited: EditedWorld): string | null {
  const c = changeSince(from, edited);
  return c === null ? null : c === 'newer' ? NEWER_NOTE : `${VERSION_NOTE_HEAD}${CHANGE_TEXT[c]}`;
}

/** 生成器版本相同、地形却对不上时的提示 */
export const CHECK_WARNING = '地形和存档时对不上(可能来自别的版本),改过的名字会尽量套上';

/** 世界名最长几个字 */
export const TITLE_MAX = 24;
/** 存档文件最大多少字节(再大就不像存档了) */
export const SAVE_MAX_BYTES = 8 * 1024 * 1024;
/** 改名最多多少条、键最长多少字 */
const MAX_NAMES = 20000;
const KEY_MAX = 64;
/** 人物的键带着名字(最长 32 字),放宽一些 */
const PERSON_KEY_MAX = 96;
/** 最多读多少面改过的旗 */
const MAX_FLAGS = 5000;

/** 参数的合理范围:存档里超出的调回范围内(比界面滑条宽;再大生成会慢到卡死)。
 *  只覆盖 DEFAULT_PARAMS 里那批"老参数";后来加的可选字段见 EXTRA_PARAM_RANGE。 */
export const PARAM_RANGE: Record<BaseParamKey, [number, number]> = {
  seed: [-(2 ** 53), 2 ** 53],
  cells: [2000, 200000],
  landFraction: [0.02, 0.95],
  plates: [2, 64],
  mountains: [0, 5],
  temperature: [-40, 40],
  rainfall: [0, 5],
  continents: [0, 8],
  gather: [0, 1],
  rugged: [0.2, 2.5],
  hardness: [0.3, 3],
  north: [-1, 1],
  // ---- 星球系、地质、技术路线与多天体(默认值 = 老世界:不生成星球系、和以前逐字节一样) ----
  astro: [0, 1],
  // 恒星类型的上限 = gen/astroDesign.ts 里 STAR_TYPES 的长度(这里写死数字,免得存档代码拉进生成代码)
  system: [0, 5],
  planets: [0, 6],
  gas: [0, 4],
  moons: [0, 12],
  tilt: [0, 80],
  rotation: [4, 200],
  geo: [0.4, 3],
  mag: [0, 2],
  // 技术路线:上限 = gen/techPack.ts 的 TECH_PACK_MAX(这里写死数字,免得存档代码拉进推演代码)
  tech: [0, 2],
  // 星系构型:0 单星、1 双固态行星、2 双恒星、3 气态巨星的宜居卫星
  arch: [0, 3],
  // 生命:0 自动、1 有生物圈、2 无生命
  life: [0, 2],
  // 主行星取第几颗(0 = 自动)
  home: [0, 6],
  // 整系重掷
  salt: [0, 999],
  // 小行星带与陨击:0 关、1 自然、2 频繁
  impact: [0, 2],
};

/** 参数在提示里的叫法 */
export const PARAM_NAME: Record<BaseParamKey, string> = {
  seed: '种子',
  cells: '精细度',
  landFraction: '陆地比例',
  plates: '板块数量',
  mountains: '造山强度',
  temperature: '气温',
  rainfall: '降水',
  continents: '大陆数量',
  gather: '大陆分布',
  rugged: '破碎度',
  hardness: '板块软硬',
  north: '南北偏向',
  astro: '星球系',
  system: '恒星类型',
  planets: '固态行星数',
  gas: '气态行星数',
  moons: '卫星数',
  tilt: '自转倾角',
  rotation: '自转周期',
  geo: '地质活跃度',
  mag: '磁场强度',
  tech: '技术路线',
  arch: '星系构型',
  life: '主行星生命',
  home: '主行星',
  salt: '整系重掷',
  impact: '撞击频率',
};

/** 后来加的参数:等于默认值时世界身份里不写(见下面的 LATER_KEYS) */
const PARAM_KEYS = Object.keys(DEFAULT_PARAMS) as BaseParamKey[];

// ---- 后来加的可选参数(恒星 / 子星系细化):不写 = 老行为;写了才进存档与世界身份 ----
export type ExtraParamKey = 'starCount' | 'subSystem' | 'spectral' | 'sub' | 'lumClass' | 'homeMoon' | 'binaryTier';
export const EXTRA_PARAM_RANGE: Record<ExtraParamKey, [number, number]> = {
  starCount: [1, 2],
  subSystem: [0, 3],
  spectral: [0, 6],
  sub: [0, 9],
  lumClass: [0, 0],
  homeMoon: [0, 12],
  binaryTier: [0, 2],
};
export const EXTRA_PARAM_NAME: Record<ExtraParamKey, string> = {
  starCount: '恒星数量',
  subSystem: '子星系类型',
  spectral: '光谱型',
  sub: '子型',
  lumClass: '光度级',
  homeMoon: '主行星是哪颗卫星',
  binaryTier: '双恒星构型',
};
const EXTRA_KEYS = Object.keys(EXTRA_PARAM_RANGE) as ExtraParamKey[];
/** 后来加的参数(大陆参数):等于默认值时世界身份里不写,加之前存下的世界照样按身份找得到 */
const LATER_KEYS = new Set<keyof WorldParams>([
  'continents',
  'gather',
  'rugged',
  'hardness',
  'north',
  'astro',
  'system',
  'planets',
  'gas',
  'moons',
  'tilt',
  'rotation',
  'geo',
  'mag',
  'tech',
  'arch',
  'life',
  'home',
  'salt',
  'impact',
]);
const written = (params: Partial<WorldParams>, k: keyof WorldParams) => !LATER_KEYS.has(k) || (params[k] ?? DEFAULT_PARAMS[k]) !== DEFAULT_PARAMS[k];

/** 一个世界的身份(种子 + 全部参数,固定顺序;后来加的参数是默认值时不写):浏览器里按它存、按它找 */
export function worldKey(params: WorldParams): string {
  const base = PARAM_KEYS.filter((k) => written(params, k))
    .map((k) => `${k}=${params[k] ?? DEFAULT_PARAMS[k]}`)
    .join('&');
  // 后来加的可选参数:只有写了才进身份(不写 = 和以前一模一样)
  const extra = EXTRA_KEYS.filter((k) => params[k] !== undefined)
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return base + (extra ? `&${extra}` : '');
}

/** 改了几处:改名条数 + 干预条数 + 地形修改处数 + 草图(画了算一处)+ 地形大事件数 + 作者标记个数 + 改过的旗面数 + 作者的人物个数 + 地名风格、推演年数、拓荒、起源、天灾、规则、文明种子、纪年、月份、逐年推演进度(各算一处)+ 逐年推演另开的几支(每支一处)*/
export function editCount(edits: WorldEdits): number {
  return (
    Object.keys(edits.names).length +
    edits.interventions.length +
    (edits.terrain?.length ?? 0) +
    (edits.sketch ? 1 : 0) +
    (edits.upheavals?.length ?? 0) +
    (edits.marks?.length ?? 0) +
    Object.keys(edits.flags ?? {}).length +
    (edits.characters?.length ?? 0) +
    (edits.nameMix ? 1 : 0) +
    (endParamOf(edits) !== undefined ? 1 : 0) +
    (cleanFrontier(edits.frontier) ? 1 : 0) +
    (cleanOrigins(edits.origins) ? 1 : 0) +
    (cleanCalamity(edits.calamity) ? 1 : 0) +
    (isOfficialRules(edits.rules) ? 0 : 1) +
    (cleanCivSeed(edits.civSeed) !== undefined ? 1 : 0) +
    (cleanEra(edits.era) ? 1 : 0) +
    (cleanMonths(edits.months) !== undefined ? 1 : 0) +
    (cleanMonthNames(edits.monthNames) ? 1 : 0) +
    (cleanPlay(edits.play) ? 1 : 0) +
    (cleanBranches(edits.branches, edits.play)?.list.length ?? 0)
  );
}

/** 覆盖表里每一项的合理范围(和设计层一致;超出就丢,不硬塞) */
const SYS_LIM = { a: [0.01, 60], ecc: [0, 0.9], incDeg: [0, 90], nodeDeg: [0, 360], radius: [0.05, 20], mass: [0.001, 5000], periodDays: [0.01, 100000000], geo: [0, 1], mag: [0, 1.5], tilt: [0, 90], rotation: [0.5, 2000], life: [0, 2], reroll: [0, 999], moonCount: [0, 12], distance: [0.5, 2000] } as const;
/** 恒星质量覆盖的范围(M☉) */
const STAR_MASS_LIM = [0.05, 100] as const;
/** 每个天体最多几份文明(步 11) */
const SAVE_BODY_CIV_MAX = 4;
const SYS_TERRAIN_MAX = 3000;

/** 每天体存档:形状校验(id 白名单字符/长度、种子偏移范围、文明数组最多 4);重复 id 只留第一个 */
function cleanBodies(raw: unknown): SaveBody[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out: SaveBody[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!isObj(x)) continue;
    const id = typeof x.id === 'string' ? x.id : '';
    if (!/^[pm][0-9]+(-[0-9]+)?$/.test(id) || id.length > 16 || seen.has(id)) continue;
    const body: SaveBody = { id };
    const shift = x.seedShift;
    if (typeof shift === 'number' && Number.isFinite(shift) && Math.abs(shift) <= 1e6) body.seedShift = Math.round(shift);
    if (Array.isArray(x.civs)) body.civs = x.civs.slice(0, SAVE_BODY_CIV_MAX);
    seen.add(id);
    out.push(body);
  }
  return out.length ? out : undefined;
}

function cleanSystem(raw: unknown): SystemOverrides | undefined {
  if (!isObj(raw)) return undefined;
  const inRange = (k: keyof typeof SYS_LIM, v: unknown): number | undefined => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    const [lo, hi] = SYS_LIM[k];
    return v >= lo && v <= hi ? v : undefined;
  };
  /** 每颗天体的地表参数(陆地比例/气温/降水/精细度):越界的丢掉 */
  const cleanSurface = (v: unknown): Record<string, number> | undefined => {
    if (!isObj(v)) return undefined;
    const lim = { landFraction: [0.02, 0.98], temperature: [-40, 40], rainfall: [0, 5], cells: [200, 200000] } as const;
    const out: Record<string, number> = {};
    for (const k of Object.keys(lim) as (keyof typeof lim)[]) {
      const x = v[k];
      if (typeof x !== 'number' || !Number.isFinite(x)) continue;
      const [lo, hi] = lim[k];
      if (x < lo || x > hi) continue;
      out[k] = k === 'cells' ? Math.round(x) : Math.round(x * 1000) / 1000;
    }
    return Object.keys(out).length ? out : undefined;
  };
  /** 手动改的星体名(恒星 / 行星下标 / 「行星:卫星」):按 cleanTitle 清长度与控制字符,编号不合法或空名字丢掉 */
  const cleanBodyNames = (v: unknown): { star?: string; planets?: Record<string, string>; moons?: Record<string, string>; groups?: Record<string, string> } | undefined => {
    if (!isObj(v)) return undefined;
    const cleanMap = (raw: unknown, keyOk: (k: string) => boolean): Record<string, string> | undefined => {
      if (!isObj(raw)) return undefined;
      const out: Record<string, string> = {};
      for (const k of Object.keys(raw).slice(0, 64)) {
        if (!keyOk(k)) continue;
        const nm = cleanTitle(raw[k], 12);
        if (nm) out[k] = nm;
      }
      return Object.keys(out).length ? out : undefined;
    };
    const out: { star?: string; planets?: Record<string, string>; moons?: Record<string, string>; groups?: Record<string, string> } = {};
    const star = cleanTitle(v.star, 12);
    if (star) out.star = star;
    const planets = cleanMap(v.planets, (k) => Number.isInteger(Number(k)) && Number(k) >= 0 && Number(k) <= 64);
    if (planets) out.planets = planets;
    const moons = cleanMap(v.moons, (k) => {
      const parts = k.split(':');
      if (parts.length !== 2) return false;
      const p = Number(parts[0]);
      const m = Number(parts[1]);
      return Number.isInteger(p) && Number.isInteger(m) && p >= 0 && p <= 64 && m >= 0 && m <= 64;
    });
    if (moons) out.moons = moons;
    // N13:子星系组名(键 = 组主天体下标)
    const groups = cleanMap(v.groups, (k) => Number.isInteger(Number(k)) && Number(k) >= 0 && Number(k) <= 64);
    if (groups) out.groups = groups;
    return Object.keys(out).length ? out : undefined;
  };
  /** 每颗天体自己的生成参数(板块/造山/气候/精度/种子/生成方式):范围外或类型不对的丢掉 */
  const cleanGen = (v: unknown): Record<string, number | string> | undefined => {
    if (!isObj(v)) return undefined;
    const lim = { plates: [2, 64], mountains: [0, 5], landFraction: [0.02, 0.98], temperature: [-40, 40], rainfall: [0, 5], cells: [200, 200000] } as const;
    const out: Record<string, number | string> = {};
    if (v.mode === 'random' || v.mode === 'image') out.mode = v.mode;
    const seed = v.seed;
    if (typeof seed === 'number' && Number.isFinite(seed) && seed >= 1 && seed <= 4294967295) out.seed = Math.floor(seed);
    for (const k of Object.keys(lim) as (keyof typeof lim)[]) {
      const x = v[k];
      if (typeof x !== 'number' || !Number.isFinite(x)) continue;
      const [lo, hi] = lim[k];
      if (x < lo || x > hi) continue;
      out[k] = k === 'cells' || k === 'plates' ? Math.round(x) : Math.round(x * 1000) / 1000;
    }
    const sketch = v.sketchId;
    if (typeof sketch === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(sketch)) out.sketchId = sketch;
    return Object.keys(out).length ? out : undefined;
  };
  const cleanOne = (x: unknown, moon: boolean): Record<string, unknown> | null => {
    if (!isObj(x)) return null;
    const o: Record<string, unknown> = {};
    const pi = x.index ?? x.planet;
    const mi = x.moon;
    if (moon) {
      if (typeof x.planet !== 'number' || !Number.isInteger(x.planet) || x.planet < 0 || x.planet > 64) return null;
      if (typeof mi !== 'number' || !Number.isInteger(mi) || mi < 0 || mi > 64) return null;
      o.planet = x.planet;
      o.moon = mi;
    } else {
      if (typeof pi !== 'number' || !Number.isInteger(pi) || pi < 0 || pi > 64) return null;
      o.index = pi;
    }
    for (const k of Object.keys(SYS_LIM) as (keyof typeof SYS_LIM)[]) {
      const v = inRange(k, x[k]);
      if (v !== undefined) o[k] = v;
    }
    for (const k of ['locked', 'home'] as const) if (typeof x[k] === 'boolean') o[k] = x[k];
    // N2:行星在子星系里的角色(只认这四个)
    if (!moon && (x.role === 'planet' || x.role === 'binaryCompanion' || x.role === 'gasParent' || x.role === 'habitableMoon')) o.role = x.role;
    if (!moon && (x.type === 'rocky' || x.type === 'dwarf' || x.type === 'subNeptune' || x.type === 'gasGiant' || x.type === 'iceGiant')) o.type = x.type;
    if (moon && (x.type === 'rocky' || x.type === 'ice' || x.type === 'dwarf')) o.type = x.type;
    if (moon) delete o.moonCount;
    const surf = cleanSurface(x.surface);
    if (surf) o.surface = surf;
    const gen = cleanGen(x.gen);
    if (gen) o.gen = gen;
    if (Array.isArray(x.terrain)) {
      // 逐处过 cleanTerrainOp(和世界自己的地形修改同一套表),认不出的丢掉
      const ops = x.terrain.slice(0, SYS_TERRAIN_MAX).map((t) => cleanTerrainOp(t)).filter((t): t is TerrainOp => !!t);
      if (ops.length) o.terrain = ops;
    }
    return o;
  };
  const planets: Record<string, unknown>[] = [];
  const moons: Record<string, unknown>[] = [];
  const seenP = new Set<number>();
  const seenM = new Set<string>();
  if (Array.isArray(raw.planets)) {
    for (const x of raw.planets) {
      const o = cleanOne(x, false);
      if (!o) continue;
      const i = o.index as number;
      if (seenP.has(i)) continue;
      seenP.add(i);
      planets.push(o);
    }
  }
  if (Array.isArray(raw.moons)) {
    for (const x of raw.moons) {
      const o = cleanOne(x, true);
      if (!o) continue;
      const key = `${o.planet}.${o.moon}`;
      if (seenM.has(key)) continue;
      seenM.add(key);
      moons.push(o);
    }
  }
  // 手动改的星体名挂在星系这一层(不是某颗行星上);只有改名、没有覆盖表时也算有星系覆盖
  const names = cleanBodyNames(raw.bodyNames);
  // 恒星质量覆盖:越界的丢掉;只有质量、没有别的覆盖时也算有星系覆盖
  let star: { mass?: number; companionMass?: number; sepAU?: number; outerSepAU?: number } | undefined;
  if (isObj(raw.star)) {
    const out: { mass?: number; companionMass?: number; sepAU?: number; outerSepAU?: number } = {};
    for (const k of ['mass', 'companionMass'] as const) {
      const v = raw.star[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= STAR_MASS_LIM[0] && v <= STAR_MASS_LIM[1]) out[k] = v;
    }
    const sep = raw.star.sepAU;
    if (typeof sep === 'number' && Number.isFinite(sep) && sep >= 0.005 && sep <= 100) out.sepAU = sep;
    const osep = raw.star.outerSepAU;
    if (typeof osep === 'number' && Number.isFinite(osep) && osep >= 50 && osep <= 50000) out.outerSepAU = osep;
    if (Object.keys(out).length) star = out;
  }
  // R2:子星系显式成员(role 白名单 + 整数成员;成员乱掉的组丢掉)
  const groupsRaw = raw.groups;
  let groups: SystemOverrides['groups'];
  if (Array.isArray(groupsRaw)) {
    const ok: { id: number; role: 'planet' | 'binaryPair' | 'gasSystem' | 'habitableMoonSystem'; members: number[] }[] = [];
    for (const g of groupsRaw) {
      if (!isObj(g)) continue;
      const role = g.role;
      if (role !== 'planet' && role !== 'binaryPair' && role !== 'gasSystem' && role !== 'habitableMoonSystem') continue;
      const id = typeof g.id === 'number' && Number.isFinite(g.id) ? Math.round(g.id) : ok.length + 1;
      const members = Array.isArray(g.members)
        ? (g.members as unknown[]).filter((m): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 0 && m < 8)
        : [];
      if (!members.length) continue;
      ok.push({ id, role, members });
    }
    if (ok.length) groups = ok;
  }
  if (!planets.length && !moons.length && !groups && !names && !star) return undefined;
  return { planets, moons, ...(groups ? { groups } : {}), ...(names ? { bodyNames: names } : {}), ...(star ? { star } : {}) } as unknown as SystemOverrides;
}
/** 世界名:去掉控制字符、首尾空白,超长截断(max 个字,默认 TITLE_MAX);空 = 没起名 */
export function cleanTitle(raw: unknown, max: number = TITLE_MAX): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const cs = [...s];
  return cs.length > max ? cs.slice(0, max).join('') : s;
}

/** 生成一份存档(params 按固定顺序复制;修改复制一份,之后改原来的不影响存档)。view = 当前的投影和中央经线;origin = 底稿出处 */
export function makeSave(
  params: WorldParams,
  edits: WorldEdits,
  check: string,
  title?: string,
  savedAt = new Date().toISOString(),
  view?: SaveView | null,
  origin?: SaveOrigin | null,
  system?: SystemOverrides | null,
  bodiesIn?: readonly SaveBody[],
): SaveFile {
  const p = {} as WorldParams;
  for (const k of PARAM_KEYS) p[k] = params[k] ?? DEFAULT_PARAMS[k];
  // 后来加的可选参数:只有给了才写(不给 = 存档里连字段都没有,老版本照旧读)
  for (const k of EXTRA_KEYS) {
    const v = params[k];
    if (v !== undefined) p[k] = v;
  }
  const save: SaveFile = {
    app: SAVE_APP,
    format: SAVE_FORMAT_YEARS,
    generator: GENERATOR_VERSION,
    seed: p.seed,
    params: p,
    edits: {
      names: { ...edits.names },
      interventions: edits.interventions.map((x) => ({ ...x })),
      terrain: (edits.terrain ?? []).map((x) => ({ ...x, pts: x.pts.slice() })),
    },
    check,
    savedAt,
    ...(cleanBodies(bodiesIn) ? { bodies: cleanBodies(bodiesIn) } : {}),
  };
  // AI 起的名字:只存现在还用着的
  const ai = aiNameKeys(edits);
  if (ai.length) save.edits.aiNames = Object.fromEntries(ai.map((k) => [k, { ...edits.aiNames![k] }]));
  // 草图:画了才写
  if (edits.sketch) {
    const { rest, coast, fill, strokes, image, plates } = edits.sketch;
    save.edits.sketch = {
      rest,
      ...(coast !== undefined ? { coast } : {}),
      ...(fill ? { fill } : {}),
      strokes: strokes.map((x) => ({ ...x, pts: x.pts.slice() })),
      ...(image ? { image: { ...image } } : {}),
      ...(plates ? { plates: JSON.parse(JSON.stringify(plates)) as PlateEdit } : {}),
    };
  }
  // 地形大事:有才写
  if (edits.upheavals?.length) save.edits.upheavals = edits.upheavals.map((u) => ({ year: u.year, ops: u.ops.map((x) => ({ ...x, pts: x.pts.slice() })) }));
  // 作者标记:有才写
  if (edits.marks?.length) save.edits.marks = edits.marks.map(copyMark);
  if (edits.flags && Object.keys(edits.flags).length) save.edits.flags = { ...edits.flags };
  if (edits.characters?.length) save.edits.characters = edits.characters.map((c) => JSON.parse(JSON.stringify(c)) as AuthorCharacter);
  const mix = cleanMix(edits.nameMix);
  if (mix) save.edits.nameMix = { ...mix };
  const endYear = cleanEndYear(edits.endYear);
  if (endYear) save.edits.endYear = endYear;
  const endTick = cleanEndTick(edits.endTick, endYearOf(edits));
  if (endTick) save.edits.endTick = endTick;
  const frontier = cleanFrontier(edits.frontier);
  if (frontier) save.edits.frontier = frontier;
  const origins = cleanOrigins(edits.origins);
  if (origins) save.edits.origins = origins;
  const calamity = cleanCalamity(edits.calamity);
  if (calamity) save.edits.calamity = calamity;
  const rules = worldRules(edits.rules);
  if (rules) save.edits.rules = rules;
  const civSeed = cleanCivSeed(edits.civSeed);
  if (civSeed !== undefined) save.edits.civSeed = civSeed;
  const map = cleanMapRef(edits.map);
  if (map) save.edits.map = map;
  const era = cleanEra(edits.era);
  if (era) save.edits.era = era;
  const months = cleanMonths(edits.months);
  if (months !== undefined) save.edits.months = months;
  const monthNames = cleanMonthNames(edits.monthNames);
  if (monthNames) save.edits.monthNames = monthNames;
  const play = cleanPlay(edits.play);
  if (play) save.edits.play = playState(play.year, play.tick ?? 0, play.commands.map((x) => ({ ...x })));
  const playFrom = cleanPlayFrom(edits.playFrom, play);
  if (playFrom !== undefined) save.edits.playFrom = playFrom;
  const branches = cleanBranches(edits.branches, play);
  if (branches) save.edits.branches = copyBranches(branches);
  const advance = cleanAdvance(edits.advance);
  if (advance) save.edits.advance = { ...advance };
  const follow = cleanFollow(edits.follow);
  if (follow) save.edits.follow = { kind: follow.kind, key: follow.key };
  const outline = cleanOutline(edits.outline);
  if (outline) save.edits.outline = JSON.parse(JSON.stringify(outline)) as Outline;
  const t = cleanTitle(title);
  if (t) save.title = t;
  const v = view ? cleanView(view) : null;
  if (v) save.view = v;
  const o = origin ? cleanOrigin(origin) : null;
  if (o) save.origin = o;
  const sys = cleanSystem(system);
  if (sys) {
    save.system = sys;
    // 同一份覆盖表再写一份分层形态(行星 → 卫星);默认世界没有 system,所以两样都不写
    save.systemSpec = layersOfOverrides(sys);
  }
  setCurrentSystem(sys ?? null);
  save.format = saveFormatOf(save.edits);
  return save;
}

/** 复制支线(之后改原来的不影响存档) */
function copyBranches(bs: PlayBranches): PlayBranches {
  return { ...bs, list: bs.list.map((b) => ({ ...b, commands: b.commands.map((x) => ({ ...x })) })) };
}

/** 复制一个标记(之后改原来的不影响存档) */
function copyMark(m: AuthorMark): AuthorMark {
  const c: AuthorMark = { ...m };
  if (m.at) c.at = [m.at[0], m.at[1]];
  if (m.regions) c.regions = m.regions.slice();
  return c;
}

/** 存档 → 文件内容(缩进两格,人也能读) */
export function saveText(save: SaveFile): string {
  return JSON.stringify(save, null, 2) + '\n';
}

/** 下载的文件名开头(存档、导出的图片和编年史共用):文明与地图-九州大陆;没起名 = 文明与地图-种子7 */
export function fileBaseName(save: Pick<SaveFile, 'title' | 'seed'>): string {
  // eslint-disable-next-line no-control-regex
  const t = cleanTitle(save.title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim();
  return `${SAVE_APP}-${t || `种子${save.seed}`}`;
}

/** 下载用的文件名:文明与地图-九州大陆.json;没起名 = 文明与地图-种子7.json */
export function saveFileName(save: Pick<SaveFile, 'title' | 'seed'>): string {
  return `${fileBaseName(save)}.json`;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 读进来的推进设置和清理以后的一样(写明了默认值、big 写了 false 的也算一样;多了认不出的项、值被改了的不算) */
function sameAdvanceRaw(raw: unknown, clean: AdvanceSettings | undefined): boolean {
  if (!isObj(raw)) return false;
  const full = advanceOf({ advance: clean }) as unknown as Record<string, unknown>;
  return Object.entries(raw).every(([k, v]) => k in full && full[k] === v);
}

/** 存档文件的开头(saveText 写的第一项) */
const SAVE_HEAD = new RegExp(`^\\uFEFF?\\s*\\{\\s*"app"\\s*:\\s*"${SAVE_APP}"`);

/**
 * 读存档:文件内容 → 存档。读不了(不是 JSON、不是本应用的存档、格式比自己新、没有种子)给中文错误;
 * 能读但有问题(生成器版本不同、参数超出范围、个别改名 / 干预格式不对)照样打开,附中文提示
 */
export function parseSave(text: string): ParseResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '文件是空的' };
  if (text.length > SAVE_MAX_BYTES) return { ok: false, error: '文件太大,不像「文明与地图」的存档' };
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    // 开头是存档的样子、后面读不了:没存完整(下载断了),不是选错了文件
    if (SAVE_HEAD.test(text)) return { ok: false, error: '存档文件坏了:没有存完整' };
    return { ok: false, error: '读不懂这个文件:它不是「文明与地图」的存档(.json)' };
  }
  if (!isObj(raw) || raw.app !== SAVE_APP) return { ok: false, error: '这不是「文明与地图」的存档文件' };
  if (isRulesFileLike(raw)) return { ok: false, error: RULES_FILE_ERROR };
  const format = raw.format;
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) return { ok: false, error: '存档文件坏了:缺少格式版本' };
  if (format > SAVE_FORMAT) return { ok: false, error: `这个存档来自更新版本的「文明与地图」(存档格式 ${format}),请刷新页面换到最新版再打开` };

  const warnings: string[] = [];
  const P = isObj(raw.params) ? raw.params : {};
  const seedRaw = typeof raw.seed === 'number' ? raw.seed : P.seed;
  if (typeof seedRaw !== 'number' || !Number.isFinite(seedRaw)) return { ok: false, error: '存档文件坏了:没有种子' };
  const params = { ...DEFAULT_PARAMS, seed: seedRaw } as WorldParams;
  const bad: string[] = [];
  for (const k of PARAM_KEYS) {
    if (k === 'seed') continue;
    const v = P[k];
    if (v === undefined) continue; // 老存档没有的参数用默认值
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      bad.push(PARAM_NAME[k]);
      continue;
    }
    const [lo, hi] = PARAM_RANGE[k];
    if (v < lo || v > hi) bad.push(PARAM_NAME[k]);
    params[k] = Math.min(hi, Math.max(lo, v));
  }
  if (bad.length) warnings.push(`存档里的${bad.join('、')}不对,已改成合理的值`);
  // 后来加的可选参数:给了才读;越界改成范围内的值,不是数字就当没给
  for (const k of EXTRA_KEYS) {
    const v = P[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      bad.push(EXTRA_PARAM_NAME[k]);
      continue;
    }
    const [lo, hi] = EXTRA_PARAM_RANGE[k];
    if (v < lo || v > hi) bad.push(EXTRA_PARAM_NAME[k]);
    params[k] = Math.round(Math.min(hi, Math.max(lo, v)));
  }

  const generator = typeof raw.generator === 'number' && Number.isFinite(raw.generator) ? raw.generator : 0;
  // 版本不同的提示排在参数之后、改名之前;变了什么要看改没改过地形,地形修改读完再算
  const noteAt = warnings.length;

  // 修改:改名只收"字符串键 → 非空字符串";干预原样收(只跳过不是对象的)
  const E = isObj(raw.edits) ? raw.edits : {};
  const names: Record<string, string> = {};
  let dropped = 0;
  if (isObj(E.names)) {
    for (const [k, v] of Object.entries(E.names)) {
      if (Object.keys(names).length >= MAX_NAMES) {
        dropped++;
        continue;
      }
      if (typeof v !== 'string' || !v.trim() || k.length > (k.startsWith('person:') ? PERSON_KEY_MAX : KEY_MAX) || !k.includes(':')) {
        dropped++;
        continue;
      }
      const cs = [...v];
      names[k] = cs.length > NAME_MAX ? cs.slice(0, NAME_MAX).join('') : v;
    }
  } else if (E.names !== undefined) dropped++;
  if (dropped) warnings.push(`有 ${dropped} 处改名格式不对,已跳过`);
  // AI 起的名字的记号:只收和改名对得上的(格式不对的悄悄跳过,只是少了"AI 写"的标记)
  const aiNames: Record<string, AiNameMark> = {};
  if (isObj(E.aiNames)) {
    for (const [k, v] of Object.entries(E.aiNames)) {
      if (!isObj(v) || typeof v.name !== 'string' || names[k] !== v.name) continue;
      aiNames[k] = typeof v.was === 'string' && v.was.trim() && [...v.was].length <= NAME_MAX ? { name: v.name, was: v.was } : { name: v.name };
    }
  }
  // 改过的旗:键像改名的键,值要能读成一面旗
  const flags: Record<string, string> = {};
  let droppedF = 0;
  if (isObj(E.flags)) {
    for (const [k, v] of Object.entries(E.flags)) {
      if (Object.keys(flags).length >= MAX_FLAGS || k.length > KEY_MAX || !/^(polity|dynasty):/.test(k) || !decodeFlag(v)) droppedF++;
      else flags[k] = v as string;
    }
  } else if (E.flags !== undefined) droppedF++;
  if (droppedF) warnings.push(`有 ${droppedF} 面改过的旗格式不对,已跳过`);
  const interventions: Intervention[] = [];
  let droppedI = 0;
  if (Array.isArray(E.interventions)) {
    for (const x of E.interventions) {
      if (isObj(x)) interventions.push(x as Intervention);
      else droppedI++;
    }
  } else if (E.interventions !== undefined) droppedI++;
  if (droppedI) warnings.push(`有 ${droppedI} 条干预格式不对,已跳过`);
  // 地形修改:逐处清理(坐标夹回地图内),认不出的跳过;旧存档没有 = 没改地形
  const terrain: TerrainOp[] = [];
  let droppedT = 0;
  if (Array.isArray(E.terrain)) {
    for (const x of E.terrain) {
      const v = terrain.length < TERRAIN_MAX_OPS ? cleanTerrainOp(x) : null;
      if (v) terrain.push(v);
      else droppedT++;
    }
  } else if (E.terrain !== undefined) droppedT++;
  if (droppedT) warnings.push(`有 ${droppedT} 处地形修改格式不对,已跳过`);
  // 草图:逐笔清理,认不出的跳过;旧存档没有 = 没画
  let sketch: SketchEdit | null = null;
  if (E.sketch !== undefined) {
    const raw = isObj(E.sketch) && Array.isArray(E.sketch.strokes) ? (E.sketch.strokes as unknown[]) : null;
    if (!raw) warnings.push('草图格式不对,已跳过');
    else {
      sketch = cleanSketch(E.sketch);
      const bad = raw.slice(0, SKETCH_MAX_STROKES).filter((x) => !cleanSketchStroke(x)).length;
      if (bad) warnings.push(`草图有 ${bad} 笔格式不对,已跳过`);
      if (raw.length > SKETCH_MAX_STROKES) warnings.push(`草图最多 ${SKETCH_MAX_STROKES} 笔,多出来的 ${raw.length - SKETCH_MAX_STROKES} 笔没有读进来`);
      if ((E.sketch as Record<string, unknown>).image !== undefined && !sketch?.image) warnings.push('草图里导入的图片格式不对,已跳过');
    }
  }
  // 地形大事:逐件清理,认不出的跳过;最多 UPHEAVALS_MAX 件、每件 UPHEAVAL_OPS_MAX 笔;旧存档没有 = 没有
  const upheavals: Upheaval[] = [];
  let droppedU = 0;
  let overU = 0;
  let droppedUOps = 0;
  let overUOps = 0;
  if (Array.isArray(E.upheavals)) {
    for (const x of E.upheavals) {
      const v = cleanUpheaval(x);
      if (!v) droppedU++;
      else if (upheavals.length >= UPHEAVALS_MAX) overU++;
      else {
        upheavals.push(v);
        // 读进来了、但丢了几笔的:格式不对的、超过笔数上限的
        const raw = (x as { ops: unknown[] }).ops;
        const bad = raw.filter((o) => {
          const c = cleanTerrainOp(o);
          return !c || !UPHEAVAL_KINDS.includes(c.kind);
        }).length;
        droppedUOps += bad;
        overUOps += raw.length - bad - v.ops.length;
      }
    }
  } else if (E.upheavals !== undefined) droppedU++;
  if (droppedU) warnings.push(`有 ${droppedU} 件地形大事格式不对,已跳过`);
  if (overU) warnings.push(`地形大事最多 ${UPHEAVALS_MAX} 件,多出来的 ${overU} 件没有读进来`);
  if (droppedUOps) warnings.push(`地形大事里有 ${droppedUOps} 笔格式不对,已跳过`);
  if (overUOps) warnings.push(`地形大事每件最多 ${UPHEAVAL_OPS_MAX} 笔,多出来的 ${overUOps} 笔没有读进来`);
  // 作者标记:逐个清理,认不出的跳过;编号重复的换一个新编号;最多留 MARKS_MAX 个、一共圈 MARK_REGIONS_TOTAL 个州;旧存档没有 = 没有标记
  const marks: AuthorMark[] = [];
  let droppedM = 0;
  let overM = 0;
  let overR = 0;
  if (Array.isArray(E.marks)) {
    const ids = new Set<number>();
    let regions = 0;
    for (const x of E.marks) {
      const m = cleanMark(x);
      if (!m) {
        droppedM++;
        continue;
      }
      if (marks.length >= MARKS_MAX) overM++;
      else if (m.regions && regions + m.regions.length > MARK_REGIONS_TOTAL) overR++;
      else {
        regions += m.regions?.length ?? 0;
        marks.push(m);
      }
    }
    let max = marks.reduce((a, m) => Math.max(a, m.id), 0);
    const used = new Set(marks.map((m) => m.id));
    for (let i = 0; i < marks.length; i++) {
      if (ids.has(marks[i].id)) {
        marks[i] = { ...marks[i], id: freeMarkId(used, max) };
        max = Math.max(max, marks[i].id);
      }
      ids.add(marks[i].id);
    }
  } else if (E.marks !== undefined) droppedM++;
  if (droppedM) warnings.push(`有 ${droppedM} 个作者标记格式不对,已跳过`);
  if (overM) warnings.push(`作者标记最多 ${MARKS_MAX} 个,多出来的 ${overM} 个没有读进来`);
  if (overR) warnings.push(`作者标记一共最多圈 ${MARK_REGIONS_TOTAL} 个州,多出来的 ${overR} 个标记没有读进来`);
  // 作者的人物:逐个清理,认不出的跳过;编号重复的换一个新编号;最多留 CHARACTERS_MAX 个;旧存档没有 = 没有人物
  const count = { dropped: 0, over: 0 };
  const characters = Array.isArray(E.characters) ? cleanCharacters(E.characters, count) : [];
  if (E.characters !== undefined && !Array.isArray(E.characters)) count.dropped++;
  if (count.dropped) warnings.push(`有 ${count.dropped} 个作者的人物格式不对,已跳过`);
  if (count.over) warnings.push(`作者的人物最多 ${CHARACTERS_MAX} 个,多出来的 ${count.over} 个没有读进来`);
  // 地名风格:认不出的语感、不对的份数去掉
  const nameMix = cleanMix(E.nameMix);
  const rawMix = isObj(E.nameMix) ? E.nameMix : null;
  if (E.nameMix !== undefined && (!rawMix || Object.keys(rawMix).some((k) => nameMix?.[k] !== rawMix[k])))
    warnings.push(nameMix ? '地名风格里有认不出来的语感或份数,已去掉' : '地名风格认不出来,按自动起名');
  // 推演年数:取整到年、夹在 1–60000;认不出的按 3000 年
  const endYear = cleanEndYear(E.endYear);
  if (E.endYear !== undefined && (typeof E.endYear !== 'number' || !Number.isFinite(E.endYear))) warnings.push('推演年数认不出来,按 3000 年推演');
  // 推到那一年的第几格:认不出的按那一年年初
  const endTick = cleanEndTick(E.endTick, endYear ?? END_YEAR_DEFAULT);
  if (E.endTick !== undefined && E.endTick !== 0 && !endTick) warnings.push(`推演到第 ${endYear ?? END_YEAR_DEFAULT} 年的哪一刻认不出来,按那一年年初推演`);
  // 拓荒:吸到最近的一档,认不出的项去掉
  const frontier = cleanFrontier(E.frontier);
  if (E.frontier !== undefined && JSON.stringify(frontier ?? {}) !== JSON.stringify(E.frontier)) warnings.push(frontier ? '拓荒设定里有认不出来的项,已按最近的一档读' : '拓荒设定认不出来,按默认推演');
  // 起源:坐标取整、去重,最多 16 处
  const origins = cleanOrigins(E.origins);
  if (E.origins !== undefined && !origins) warnings.push('文明起源认不出来,按自动推演');
  // 天灾:多 / 很多,认不出的按平常
  const calamity = cleanCalamity(E.calamity);
  if (E.calamity !== undefined && !calamity) warnings.push('天灾设定认不出来,按平常推演');
  // 规则:过 cleanRuleSet(认不出的丢、超出范围的拉回来……;世界里的那一套,换算版本照留),几处提示并成一句;清理完和官方一样的不留
  const ruleRead = cleanRuleSet(E.rules, { world: true });
  const rulesNote = ruleNotesLine(ruleRead.notes);
  if (rulesNote) warnings.push(rulesNote);
  const rules = ruleRead.rules && !isOfficialRules(ruleRead.rules) ? ruleRead.rules : undefined;
  // 规则按比现在新的换算推:这一版推不出它的历史,不读(和格式更新一样提示刷新)
  if (worldTuning(rules) && worldCalc(rules) > TUNING_CALC) {
    return { ok: false, error: `这个存档来自更新版本的「文明与地图」(规则换算第 ${worldCalc(rules)} 版),请刷新页面换到最新版再打开` };
  }
  // 文明种子:不是整数的按地图种子推
  const civSeed = cleanCivSeed(E.civSeed);
  if (E.civSeed !== undefined && civSeed === undefined) warnings.push('文明种子认不出来,按地图种子推演');
  const map = cleanMapRef(E.map);
  // 纪年:名字、元年不合格的按第几年写
  const era = cleanEra(E.era);
  if (E.era !== undefined && !era) warnings.push('纪年认不出来,年份按第几年写');
  // 月份:认不出的按一年 12 个月
  const months = cleanMonths(E.months);
  if (E.months !== undefined && E.months !== 12 && months === undefined) warnings.push('月份设定认不出来,按一年 12 个月写');
  // 月份的名字:认不出的那个月当没起名,照旧写数字
  const monthNames = cleanMonthNames(E.monthNames);
  if (E.monthNames !== undefined) {
    const raw = isObj(E.monthNames) && Array.isArray(E.monthNames.names) ? E.monthNames.names.slice(0, MONTHS_MAX) : null;
    const lost = raw ? raw.filter((x) => (typeof x === 'string' ? x.trim() !== '' && !cleanMonthName(x) : x != null)).length : 1;
    if (lost) warnings.push(raw ? `有 ${lost} 个月份的名字认不出来,照旧写数字` : '月份的名字认不出来,照旧写数字');
  }
  // 逐年推演的进度:年份、第几格不对的当没在逐年推演,不合格的命令丢掉
  const play = cleanPlay(E.play);
  if (E.play !== undefined) {
    const raw = isObj(E.play) && Array.isArray(E.play.commands) ? E.play.commands.length : 0;
    if (!play) warnings.push('逐年推演的进度认不出来,已跳过');
    else if (play.commands.length < raw) warnings.push(`逐年推演的进度里有 ${raw - play.commands.length} 条命令格式不对,已跳过`);
  }
  const playFrom = cleanPlayFrom(E.playFrom, play);
  // 支线:跟着进度走(没有进度的不要,不另提示);不合格的那一支去掉
  const branches = cleanBranches(E.branches, play);
  if (E.branches !== undefined && play && branches !== E.branches) {
    const n = isObj(E.branches) && Array.isArray(E.branches.list) ? E.branches.list.length - (branches?.list.length ?? 0) : 0;
    warnings.push(n > 0 ? `逐年推演的支线里有 ${n} 支认不出来,已跳过` : '逐年推演的支线里有认不出来的地方,已按认得出的读');
  }
  // 推进设置:认不出的项按默认
  const advance = cleanAdvance(E.advance);
  if (E.advance !== undefined && !sameAdvanceRaw(E.advance, advance)) warnings.push('推进设置里有认不出来的项,已按默认读');
  // 导播跟着谁:认不出的当没有(镜头跟着全世界的大事)
  const follow = cleanFollow(E.follow);
  if (E.follow !== undefined && !follow) warnings.push('导播跟着谁认不出来,已按全世界的大事读');
  // 大纲:格式不对的情节跳过
  const outline = cleanOutline(E.outline);
  if (E.outline !== undefined) {
    const raw = isObj(E.outline) && Array.isArray(E.outline.plots) ? E.outline.plots.length : 0;
    if (!outline && raw) warnings.push('大纲认不出来,已跳过');
    else if (outline && outline.plots.length < raw) warnings.push(`大纲里有 ${raw - outline.plots.length} 条情节格式不对,已跳过`);
  }
  const note = versionNote(generator, { terrain: terrain.length > 0 || !!sketch, upheavals: upheavals.length > 0 });
  if (note) warnings.splice(noteAt, 0, note);

  const save: SaveFile = {
    app: SAVE_APP,
    format: SAVE_FORMAT_YEARS,
    generator,
    seed: params.seed,
    params,
    edits: {
      names,
      ...(Object.keys(aiNames).length ? { aiNames } : {}),
      interventions,
      terrain,
      ...(sketch ? { sketch } : {}),
      ...(upheavals.length ? { upheavals } : {}),
      ...(marks.length ? { marks } : {}),
      ...(Object.keys(flags).length ? { flags } : {}),
      ...(characters.length ? { characters } : {}),
      ...(nameMix ? { nameMix } : {}),
      ...(endYear ? { endYear } : {}),
      ...(endTick ? { endTick } : {}),
      ...(frontier ? { frontier } : {}),
      ...(origins ? { origins } : {}),
      ...(calamity ? { calamity } : {}),
      ...(rules ? { rules } : {}),
      ...(civSeed !== undefined ? { civSeed } : {}),
      ...(map ? { map } : {}),
      ...(era ? { era } : {}),
      ...(months !== undefined ? { months } : {}),
      ...(monthNames ? { monthNames } : {}),
      ...(play ? { play } : {}),
      ...(playFrom !== undefined ? { playFrom } : {}),
      ...(branches ? { branches } : {}),
      ...(advance ? { advance } : {}),
      ...(follow ? { follow: { kind: follow.kind, key: follow.key } } : {}),
      ...(outline ? { outline } : {}),
    },
    check: typeof raw.check === 'string' ? raw.check.slice(0, 64) : '',
    savedAt: typeof raw.savedAt === 'string' && !Number.isNaN(Date.parse(raw.savedAt)) ? raw.savedAt : '',
  };
  const title = cleanTitle(raw.title);
  if (title) save.title = title;
  // 投影和中央经线:格式不对就当没存(按等距圆柱、0° 看),不影响打开
  const view = cleanView(raw.view);
  if (view) save.view = view;
  // 底稿出处:格式不对就当没有
  const origin = cleanOrigin(raw.origin);
  if (origin) save.origin = origin;
  save.format = saveFormatOf(save.edits);
  // 星系结构(逐行星/卫星覆盖表):优先读分层形态(systemSpec),读不懂回落到老的 system;都不行就按种子重建
  const layers = overridesOfLayers(raw.systemSpec);
  // 步11:每天体的世界/文明(不写 = 只有主天体)
  const bodies = cleanBodies(raw.bodies);
  if (bodies) save.bodies = bodies;
  const sys = cleanSystem(layers ?? raw.system);
  if (sys) {
    save.system = sys;
    save.systemSpec = layersOfOverrides(sys);
  } else if (raw.system !== undefined || raw.systemSpec !== undefined) warnings.push('星系结构读不懂,按种子重建');
  setCurrentSystem(sys ?? null);
  // 打开时看哪(分享链接里带的):不合格的那一样去掉,不提示
  const moment = cleanMoment(raw.moment, momentYearMax(save.edits));
  if (moment) save.moment = moment;
  return { ok: true, save, warnings };
}

/** 跨过这几种改动,世界(地形、疆域、兴亡)和原来一样:只重算了思潮、换了默认的名字、人物(性别、父子、名字)、编年史的字、道路和航线 */
const SAME_WORLD: readonly (GeneratorChange | 'newer' | null)[] = [null, 'ideology', 'names', 'people', 'chronicle', 'routes'];

/**
 * 按存档的参数生成完以后核对地形:生成器版本相同(或版本不同、但世界应该一样,见 SAME_WORLD)、地形哈希却对不上时给提示
 * (版本不同、世界变了的,parseSave 已经说过变了什么,这里不重复)。对得上 = null
 */
export function checkWarning(save: SaveFile, check: string): string | null {
  if (!SAME_WORLD.includes(changeSince(save.generator, (save.edits.terrain?.length ?? 0) > 0 || !!save.edits.sketch))) return null;
  if (!save.check || save.check === check) return null;
  return CHECK_WARNING;
}

// ---------------------------------------------------------------------------
// 地形校验

/** 32 位 FNV-1a 的一步(按 32 位整数喂) */
function mix(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xff), 16777619);
  h = Math.imul(h ^ ((v >>> 8) & 0xff), 16777619);
  h = Math.imul(h ^ ((v >>> 16) & 0xff), 16777619);
  return Math.imul(h ^ (v >>> 24), 16777619);
}

const hex = (h: number, n: number) => (h >>> 0).toString(16).padStart(8, '0').slice(0, n);

/**
 * 地形的短哈希(12 位十六进制):地块数、每个地块的海拔(Float32 的原始位)、水域、生物群落。
 * 同一版本下地形数据在各浏览器 / Node 里逐位一致,所以同种子 + 参数总得到同一个值;
 * 生成算法变了(地形哪怕差一点)就对不上
 */
export function worldCheck(world: World): string {
  const n = world.mesh.n;
  const e = world.elevation;
  const bits = new Uint32Array(e.buffer, e.byteOffset, e.length);
  const { water, biome } = world;
  let a = mix(0x811c9dc5, n);
  let b = mix(0x2166136b, n ^ 0x5bd1e995);
  for (let i = 0; i < n; i++) {
    a = mix(a, bits[i]);
    b = mix(b, (water[i] << 8) | biome[i] | ((i & 0xffff) << 16));
  }
  return hex(a, 8) + hex(b, 4);
}

// ---------------------------------------------------------------------------
// 分享链接:把整份存档塞进网址的 # 后面
//
//   https://…/?seed=7&style=fantasy#share=<base64url(deflate-raw(存档的 JSON))>
//
// - # 后面的东西浏览器不发给服务器,只在打开链接的人自己的页面里读
// - 编码的是**整个** SaveFile(JSON.stringify,不挑字段):存档以后加了字段(比如地形修改),链接自动带上;
//   "打开时看哪"(moment,withMoment 带上)也在里面,旧版本的页面读到不认识的字段会跳过,照平常打开
// - 压缩用浏览器自带的 CompressionStream('deflate-raw')(= zlib 的 raw deflate,Node 里 zlib.inflateRawSync 也能解),
//   再转成 base64url(只有 A–Z a–z 0–9 - _,放进网址不用转义)
// - 解开以后走和"从文件打开"同一个 parseSave:版本不同、参数超范围这些照样打开并提示

/** 网址里生成器版本的键(?…&gen=8):带种子的网址、分享链接都写上,打开时和现在的版本比 */
export const GEN_KEY = 'gen';

/** # 后面的键:#share=… */
export const SHARE_KEY = 'share';
/** 链接超过这么多字就提示"修改太多,链接可能打不开"(聊天软件、浏览器对网址长度各有上限) */
export const SHARE_WARN_LENGTH = 8000;
/** 链接里的数据最多多少字(再长就不像分享链接了) */
const SHARE_MAX_CHARS = 4 * 1024 * 1024;

export const SHARE_BROKEN = '链接不完整或被改动过(可能复制时少了一截),请让对方重新复制一次链接';
const SHARE_EMPTY = '链接里没有世界数据';
const SHARE_OLD_BROWSER = '这个浏览器太旧,打不开分享链接:请换个新版浏览器,或者让对方存成文件发给你';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** 字节 → base64url(不补 =) */
function toBase64Url(bytes: Uint8Array): string {
  const out: string[] = [];
  let s = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i];
    const b = i + 1 < n ? bytes[i + 1] : 0;
    const c = i + 2 < n ? bytes[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < n) s += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < n) s += B64[c & 63];
    if (s.length >= 4096) {
      out.push(s);
      s = '';
    }
  }
  out.push(s);
  return out.join('');
}

/** base64url → 字节;有不认识的字符、长度不对 = null */
function fromBase64Url(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  const v = [0, 0, 0, 0];
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = Math.min(4, s.length - i);
    v[2] = v[3] = 0;
    for (let j = 0; j < n; j++) {
      const code = s.charCodeAt(i + j);
      const x = code < 128 ? B64_INDEX[code] : -1;
      if (x < 0) return null;
      v[j] = x;
    }
    out[o++] = (v[0] << 2) | (v[1] >> 4);
    if (n > 2) out[o++] = ((v[1] & 15) << 4) | (v[2] >> 2);
    if (n > 3) out[o++] = ((v[2] & 3) << 6) | v[3];
  }
  return out.subarray(0, o);
}

type Pipe = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };

/** 让字节流过压缩 / 解压;解出来超过 limit 字节 = 'big',数据坏了 = 'bad' */
async function through(data: Uint8Array, ts: Pipe, limit = Infinity): Promise<Uint8Array | 'big' | 'bad'> {
  const w = ts.writable.getWriter();
  const fed = w
    .write(data)
    .then(() => w.close())
    .catch(() => {});
  const r = ts.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      n += value.length;
      if (n > limit) {
        r.cancel().catch(() => {});
        return 'big';
      }
      parts.push(value);
    }
  } catch {
    return 'bad';
  }
  await fed;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 这个存档值得做成带数据的链接吗:有任何修改(改名、干预、以后的地形修改……)、起了名字,或者带着"打开时看哪" */
export function hasShareData(save: SaveFile): boolean {
  if (save.title || save.moment) return true;
  for (const v of Object.values(save.edits as unknown as Record<string, unknown>)) {
    if (Array.isArray(v) ? v.length > 0 : isObj(v) ? Object.keys(v).length > 0 : v !== undefined && v !== null && v !== false && v !== '') return true;
  }
  return false;
}

/** 网址的 # 那段是不是分享数据(#share=…) */
export function isShareHash(hash: string): boolean {
  return typeof hash === 'string' && new RegExp(`^#?${SHARE_KEY}=`).test(hash.trim());
}

/**
 * 存档 → 网址的 # 那段(`#share=…`,接在网址后面就是分享链接)。
 * 浏览器太旧(没有 CompressionStream)会抛错,调用方提示"存成文件发给对方"
 */
export async function encodeShare(save: SaveFile): Promise<string> {
  if (typeof CompressionStream === 'undefined') throw new Error('这个浏览器太旧,做不了分享链接');
  const bytes = new TextEncoder().encode(JSON.stringify(save));
  const packed = await through(bytes, new CompressionStream('deflate-raw'));
  if (typeof packed === 'string') throw new Error('压缩失败,做不了分享链接');
  return `#${SHARE_KEY}=${toBase64Url(packed)}`;
}

/**
 * 网址的 # 那段(`#share=…`;也认不带 # 的、只有数据的)→ 和 parseSave 一样的结果。
 * 链接坏了(少了一截、被改过、不是本应用的)给中文错误;能读但版本不同之类的照样打开,附提示
 */
export async function decodeShare(hash: string): Promise<ParseResult> {
  if (typeof hash !== 'string') return { ok: false, error: SHARE_EMPTY };
  let s = hash.trim().replace(/^#/, '');
  const m = new RegExp(`(?:^|[&;])${SHARE_KEY}=([^&;]*)`).exec(s);
  if (m) s = m[1];
  else if (/^\w+=/.test(s)) return { ok: false, error: SHARE_EMPTY };
  // 聊天软件折过行、转义过的也认:去掉空白、%编码、末尾的 =
  try {
    if (s.includes('%')) s = decodeURIComponent(s);
  } catch {
    return { ok: false, error: SHARE_BROKEN };
  }
  s = s.replace(/\s+/g, '').replace(/=+$/, '');
  if (!s) return { ok: false, error: SHARE_EMPTY };
  if (s.length > SHARE_MAX_CHARS) return { ok: false, error: '链接太长,不像「文明与地图」的分享链接' };
  const bytes = fromBase64Url(s);
  if (!bytes || !bytes.length) return { ok: false, error: SHARE_BROKEN };
  let ds: DecompressionStream;
  try {
    ds = new DecompressionStream('deflate-raw');
  } catch {
    return { ok: false, error: SHARE_OLD_BROWSER };
  }
  const raw = await through(bytes, ds, SAVE_MAX_BYTES);
  if (raw === 'big') return { ok: false, error: '链接里的数据太大,不像「文明与地图」的分享链接' };
  if (raw === 'bad') return { ok: false, error: SHARE_BROKEN };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return { ok: false, error: SHARE_BROKEN };
  }
  const r = parseSave(text);
  if (r.ok) return r;
  // 来自更新版本的:照原话提示;别的错(不是 JSON、不是本应用的)都算链接坏了
  if (r.error.startsWith('这个存档来自更新版本')) return { ok: false, error: r.error.replace('这个存档', '这个链接') };
  return { ok: false, error: '链接里的数据不是「文明与地图」的世界(可能被改动过),请让对方重新复制一次链接' };
}

/** 逐年推演的每一支(连当前这一支)完整的进度和起演那年,写成字符串(比较用;名字、编号不算) */
function branchKeys(edits: WorldEdits): string[] {
  const cur = cleanPlay(edits.play);
  if (!cur) return [];
  const key = (p: PlayState, from: number) => JSON.stringify(p.tick ? [p.year, p.commands, from, p.tick] : [p.year, p.commands, from]);
  const list = cleanBranches(edits.branches, cur)?.list ?? [];
  return [key(cur, cleanPlayFrom(edits.playFrom, cur) ?? 0), ...list.map((b) => key(branchPlay(cur, b), b.playFrom ?? 0))];
}

/**
 * 换成 incoming 的修改,会丢掉 local 里的几处:改名(同一个键 incoming 没有或名字不同)、干预(incoming 里没有的)、
 * 世界名(两边都起了名、名字不同);以后加的字段(地形修改……)按"数组的项 / 对象的键"逐个比
 */
export function editsLost(local: SaveFile, incoming: SaveFile): number {
  const L = local.edits as unknown as Record<string, unknown>;
  const I = incoming.edits as unknown as Record<string, unknown>;
  // 逐年推演另开过支(哪一边都算):进度和另开的几支一起按"每一支完整的进度"比,不管哪一支是当前的
  const forked = !!(cleanBranches(local.edits.branches, local.edits.play) || cleanBranches(incoming.edits.branches, incoming.edits.play));
  let n = 0;
  for (const [k, lv] of Object.entries(L)) {
    // AI 起名的记号跟着改名走,丢没丢已经按改名算过了;用的哪张地图只是记录(第一次推完才补上校验)、导播跟着谁只管看,不算修改
    if (k === 'aiNames' || k === 'map' || k === 'follow') continue;
    const iv = I[k];
    // 地名风格、拓荒、起源、纪年整个算一处
    if (k === 'nameMix') {
      if (!sameMix(lv, iv)) n++;
      continue;
    }
    if (k === 'era') {
      if (!sameEra(cleanEra(lv), cleanEra(iv))) n++;
      continue;
    }
    if (k === 'frontier') {
      if (!sameFrontier(cleanFrontier(lv), cleanFrontier(iv))) n++;
      continue;
    }
    if (k === 'origins') {
      if (!sameOrigins(cleanOrigins(lv), cleanOrigins(iv))) n++;
      continue;
    }
    if (k === 'calamity') {
      if (cleanCalamity(lv) !== cleanCalamity(iv)) n++;
      continue;
    }
    // 规则整套算一处
    if (k === 'rules') {
      if (!sameRuleSet(lv, iv, true)) n++;
      continue;
    }
    if (k === 'months') {
      if (cleanMonths(lv) !== cleanMonths(iv)) n++;
      continue;
    }
    // 月份的名字整个算一处
    if (k === 'monthNames') {
      if (!sameMonthNames(cleanMonthNames(lv), cleanMonthNames(iv))) n++;
      continue;
    }
    // 推进设置整个算一处;逐年推演从第几年起跟着进度走,丢没丢已经按进度算过了
    if (k === 'advance') {
      if (!sameAdvance(lv, iv)) n++;
      continue;
    }
    if (k === 'playFrom' || k === 'branches') continue;
    if (k === 'play' && forked) {
      const has = new Set(branchKeys(incoming.edits));
      n += branchKeys(local.edits).filter((x) => !has.has(x)).length;
      continue;
    }
    if (Array.isArray(lv)) {
      const has = new Set(Array.isArray(iv) ? iv.map((x) => JSON.stringify(x)) : []);
      n += lv.filter((x) => !has.has(JSON.stringify(x))).length;
    } else if (isObj(lv)) {
      const io = isObj(iv) ? iv : {};
      n += Object.keys(lv).filter((key) => JSON.stringify(lv[key]) !== JSON.stringify(io[key])).length;
    } else if (lv !== undefined && lv !== null && JSON.stringify(lv) !== JSON.stringify(iv)) n++;
  }
  if (local.title && incoming.title && local.title !== incoming.title) n++;
  return n;
}
