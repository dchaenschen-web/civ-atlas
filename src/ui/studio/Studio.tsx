/**
 * 新建世界(和平常的地图页面分开的一套深色界面)。两种,在「新建世界」弹窗里选(NewWorldDialog.tsx),进来以后不能换成另一种:
 *
 * 随机生成(mode = 'random')。分两步(左上标着「① 地图 ② 文明」):
 *   第 1 步  地图:种子 + 换一颗、世界参数;地形(改地形工具、让助手改)。底部「保存地图」(只存地图,回我的世界的「地图」页签)
 *            和「打造文明 ›」(到第 2 步;手机上是「地图做好了，下一步」)
 *   第 2 步  文明:地图定下(左上「‹ 改地图」回第 1 步);文明种子 + 换一个(默认就是地图种子)、推演年数、天灾、规则、拓荒、文明起源;
 *            名字(世界名、地名风格);底部「开始推演」。手机上卡片里先是文明种子、推演年数和「更多设定」(规则、拓荒、起源、地名),名字框
 *   打造文明 在已有的一张地图上(App 的 startNewCiv;修改里记着 map):只有第 2 步,标题「打造文明」,最上面一组「地图」锁着
 *            (哪个世界一开始的地图),文明种子先随机给一个,底下写明原来那个世界的东西都不带
 *   以别的世界为底稿新建(base):还是一页(种子锁着,世界参数里连拓荒、推演年数),底部「创建新世界」
 *   中间     这颗星球(StudioScene + PlanetGL):进来就是地球仪、自转;拖动转动。改地形时摊成平面,换成平常的平面地图和改地形覆盖层
 *            (App 按 studioStore 的 flat 摆地图)
 *   左边     设定(电脑贴着窗口左边、能收起;手机是底部卡片,平时只露种子和「创建世界」):
 *            种子 + 换一颗、世界参数(连同「拓荒」三样);地形(改地形工具、让助手改);文明(文明起源);名字(世界名、地名风格);底部「创建世界」。
 *            点「地名风格」左边换成配比例的那一页(NameMixPage.tsx),左上返回;手机上卡片里换页、拉到最高。
 *            点「规则」左边换成选规则的那一页(rules/RulesPick.tsx,点了才下载):官方规则和「我的规则」里的几套,选一套;
 *            「调这一套…」把调规则的大卡盖在新建界面上。选的是「我的规则」里的一套时,那一套再调,这个世界跟着用调好的
 *            (建好以后才定下来,见 rulesStore.ts 的 noteRulesUsed)。
 *            点「文明起源」左边换成选起源的那一页(OriginsPage.tsx):星球停转,点一下放一处(带号的圆点和州名跟着星球摆,
 *            停住时才显示),点圆点拿掉,点到住不了人的地方底下提示原因;照手绘图的从第 3 步进去,地图先卷成地球仪
 *   右边     样式(不用历史的 7 种,带缩略图)和投影(地球仪 + 5 种平面)、经纬网(开关 + 间隔;编辑地形时照样能开);
 *            手机上是右上两个按钮,点开是列表
 *
 * 照手绘图生成(mode = 'image')
 *   左边     图片那一行(换一张)和三步:认出海陆 → 用笔修改 → 参数和名字(零件在 SketchSteps.tsx)。做到哪步展开哪步,
 *            做过的打勾、组头写着结果;第 1 步「照这样长出星球」以后才能点开后两步。手机上是占大半屏的底部卡片
 *   中间     平时是平面地图(比随机生成摊平的大:没有右边的面板;上方留出切换条,电脑上下方一句提示),
 *            切换条:原图 / 认出来的 / 长出来的、叠上原图、样式,平面 / 地球仪。地球仪和随机生成的一样能拖动转
 *
 *   助手     「让助手改」打开:电脑上贴着右边,手机上是盖住设定卡片的底部卡片(上面留出星球)。
 *            新建时助手只改地形、回答问题;列出来还没执行的改地形在星球上用白色虚线圈出来、编号和清单对上,
 *            星球先转过去正对着那一块。执行后和手动改地形一样重新生成、星球淡入新样子(不放提示条)
 *   确认框   点「创建世界」先列出建好以后不能改的几样(种子 / 照的图、世界参数、推演年数、拓荒、天灾、规则、地形、文明起源、地名风格;
 *            推演年数、拓荒、天灾、规则、文明起源改过才列);确认后面板滑出、星球展开成平常的地图、淡出
 *
 * 没有 WebGL(或显卡丢了):中间一直是平常的平面地图;样式照样能换。
 * 系统设了"减少动态效果":地球仪不自转,换样式和投影只做很短的过渡。
 */
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { World, WorldParams } from '../../gen/world';
import { DEFAULT_PARAMS } from '../../gen/world';
import type { Civ } from '../../gen/civ/types';
import type { Raster } from '../../gen/raster';
import { TITLE_MAX, worldKey } from '../../gen/savefile';
import { END_YEAR_DEFAULT, advanceOf, cleanCivSeed, cleanEndYear } from '../../gen/edits';
import type { DraftBase } from '../stageStore';
import { getEdits, setAdvance, setCalamity, setCivSeed, setEndYear, setFrontier, setOrigins, setRules, useEdits } from '../editsStore';
import { CALAMITIES, CALAMITY_NAMES, cleanCalamity, type Calamity } from '../../gen/civ/calamity';
import { AdvanceFields } from '../StepwiseDialogs';
import { advanceBrief } from '../advanceText';
import { cleanOrigins, frontierBrief, terrainChangedCount, terrainValue, type Origins } from '../../gen/civ/frontier';
import { EXPAND_SLIDER, SPREAD_SLIDER, TERRAIN_SLIDERS, withSpeed, withTerrain, withoutTerrain } from '../frontierUi';
import { OriginsPage } from './OriginsPage';
import { originCiv, originRefusal, originSpots, poseMap } from './origins';
import { OFFICIAL_RULES_NAME, ruleSetLabel } from '../../gen/civ/ruleSetEdit';
import type { RuleSet } from '../../gen/civ/ruleSet';
import { findMyRules, useMyRules } from '../rulesStore';
import { takePresetRules } from '../presetRules';
import { rulesUiOn } from '../rules/flag';
import { RulesPickHost } from '../rules/RulesHost';
import {
  TerrainCaption,
  TerrainPanel,
  applyImport,
  getTerrainTool,
  pageOf,
  setTerrainTool,
  terrainCount,
  terrainSide,
  useTerrainHint,
  useTerrainKeys,
  useTerrainTool,
} from '../TerrainTools';
import {
  ImportPanel,
  cancelImport,
  dropSource,
  importCaption,
  importOn,
  importProgress,
  importSummary,
  layerSummary,
  pickImage,
  resumeImport,
  setSourceView,
  useImport,
  useSource,
  useSourceView,
} from '../ImportImage';
import { CONT_SLIDERS, ParamSlider, SLIDERS, YearsRows, paramsSide, yearsSpan } from '../WorldOverviewGenesis';
import { ContinentSeg } from '../ParamField';
import { PresetPicker, type PresetPick } from '../PresetPicker';
import { changedKeys, usePresets } from '../presetStore';
import { getNewView, sameView, setNewView, useNewView, type NewView } from '../newViewStore';
import { openAiSettings } from '../AiSettings';
import { AiSettingsItem, MenuItem, MenuSep, PopMenu } from '../PopMenu';
import { AssistantPanel } from '../Assistant';
import { useAssistant } from '../assistantStore';
import { useAiOn } from '../../ai/client';
import { AST_W, closeAssistant, openAssistant, useAstOpen } from '../astPanel';
import { PRIVACY_URL, SOURCE_URL, TERMS_URL } from '../links';
import { ContactMenuItem } from '../ContactLink';
import { openDiag } from '../DiagDialog';
import { VersionMenuFoot } from '../VersionNews';
import { Icon } from '../icons';
import { styleKey } from '../LayerPopover';
import type { MapLayer } from '../mapLayers';
import {
  getGraticule,
  getGraticuleStep,
  getProjection,
  lastFlatProjection,
  setGraticule,
  setGraticuleStep,
  setProjection,
  useGraticule,
  useGraticuleStep,
  type MapProjection,
} from '../projection';
import { GraticuleSteps } from '../ProjectionPanel';
import type { ProjectionId } from '../../render/projection';
import { getMapCenter } from '../mapWrap';
import { landCenterLon, plateTexels, type PlanetProjection } from '../../render/planet';
import { PlanetGL } from './planetGL';
import { StudioScene, type SceneHooks, type StillPose } from './scene';
import { NameMixPage } from './NameMixPage';
import { ImageCard, StepGroup, StepParams, ViewBar, paramsBrief } from './SketchSteps';
import { mixSummary } from '../nameMix';
import { drawPlanetLabels } from './planetLabels';
import { drawPlanetMarks, marksCenter, type PlanetMark } from './planetMarks';
import { getCivFeed, subscribeCivFeed } from '../CivLayer';
import { labelSurface } from '../../render/civ/labels';
import type { LabelView } from '../../render/labels/draw';
import { LEFT_W, RIGHT_W, appPose, flatRect } from './layout';
import { SystemPage } from '../SystemPage';
import { SystemEditor } from '../SystemEditor';
import { currentSystem, setCurrentSystem } from '../../gen/systemState';
import { EMPTY_OVERRIDES, type SystemOverrides } from '../../gen/astroDesign';
import { listBodies, bodyCivByRef, bodiesOrDefault, setBodyCivs } from '../../gen/bodies';
import { buildBodyViews } from '../../gen/bodyView';
import { astroOf } from '../../gen/astro';
import { namedBodies } from '../../gen/astroNames';
import { beltsOf } from '../../gen/system';
import { SystemGlobe } from '../SystemGlobe';
import { SystemTimeline } from '../SystemTimelineView';
import { subSystemGroupsOf } from '../../gen/systemGroups';
import { skyLayerOf } from '../../gen/skyLayer';
import { ringsOf } from '../../gen/rings';
import { GlobeSky } from './GlobeSky';
import { orbitYears } from '../../gen/astroDesign';
import { yearsPerSecondOf } from '../systemClock';
import { canHostCiv } from '../../gen/civilizable';
import { bodyTexture, dropBodyTextures } from './bodyGlobe';
import { planetSurface } from '../../gen/astroWorlds';
import { createNamer } from '../../gen/names';
import { applyOverrides, emptyOverrides } from '../../gen/system';
import { styleKey as styleKeyOfLayer } from '../LayerPopover';
import type { TerrainOp } from '../../gen/edits';
import { flatGeom, getStudioFlat, keepStudioView, setStudioFlat, takeStudioView } from './studioStore';
import { holdMark } from '../holdMark';
import '../worlds.css';
import './studio.css';

/** 新建时能看的样式(不用历史的;政区、民族建好以后才有) */
export const STUDIO_STYLES: { id: MapLayer; name: string; hint: string }[] = [
  { id: 'realistic', name: '实景', hint: '像卫星照片' },
  { id: 'terrain', name: '地形', hint: '手绘地图' },
  { id: 'biomes', name: '生态', hint: '森林、草原、沙漠' },
  { id: 'elevation', name: '高程', hint: '按海拔上色' },
  { id: 'plates', name: '板块', hint: '板块和漂移方向' },
  { id: 'temperature', name: '气温', hint: '冷暖分布' },
  { id: 'precipitation', name: '降水', hint: '干湿分布' },
];
const STYLE_IDS = STUDIO_STYLES.map((s) => s.id);

/** 投影:名字、一句说明、小图标的宽高圆角(按这种投影整张图的轮廓) */
const PROJS: { id: PlanetProjection; name: string; hint: string; icon: [number, number, string] }[] = [
  { id: 'globe', name: '地球仪', hint: '拖动转动', icon: [22, 22, '50%'] },
  { id: 'equirect', name: '等距圆柱', hint: '经纬线横平竖直', icon: [34, 17, '1px'] },
  { id: 'robinson', name: '罗宾森', hint: '地图集常用', icon: [34, 18, '40% / 50%'] },
  { id: 'naturalEarth', name: '自然地球', hint: '介于前两种之间', icon: [34, 18, '28% / 45%'] },
  { id: 'mollweide', name: '摩尔魏德', hint: '等面积', icon: [34, 17, '50%'] },
  { id: 'mercator', name: '墨卡托', hint: '航海图，高纬度放大', icon: [24, 22, '1px'] },
];

/** 手机上助手的底部卡片占屏幕多高(和 studio.css 的 .st-phone > .ast-panel 一致) */
const AST_SHEET = 0.58;
/** 手机上照手绘图那一页的底部卡片占屏幕多高(和 studio.css 的 .sk-sheet 一致;拉到最高时盖住地图,地图不跟着挪) */
const SK_SHEET = 0.642;
/** 确认框里"下面几样不能再改" */
const LOCK_COUNT = ['', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 「天灾」选了多 / 很多:下面那一句(手机短一些) */
function calamityNote(c: Calamity, phone: boolean): string {
  if (c === 'many')
    return phone ? '很多：瘟疫、饥荒、水旱约是平常的三倍，几百年里有一两场全球大疫。' : '很多：瘟疫、饥荒、地震水旱约是平常的三倍，几百年里会有一两场全球大疫，疫后几十年文明倒退；文明不会断绝。';
  return phone ? '多：瘟疫、饥荒约是平常的两倍，约六百年有一场全球大疫。' : '多：瘟疫、饥荒约是平常的两倍，各国会闹地震水旱，约六百年有一场全球大疫，疫后几十年文明倒退；文明不会断绝。';
}
/** 选起源时点错了的那句提示留几毫秒 */
const ORIGIN_MSG_MS = 2600;
/** 放下一处起源后这么久里,圆点上的 click 不算拿掉(手机补发的 click) */
const PIN_GUARD_MS = 500;
/** 照手绘图那一页:电脑上地图下边到那句提示有多远 */
const CAP_GAP = 34;

/** 板块贴图的大小(找陆地最多的那一面用) */
const PLATE_W = 1024;
const PLATE_H = 512;

// N8:地球仪视角的常驻观测层(点开地球仪才下载)
const SkyLayerLazy = lazy(() => import('../SkyLayer').then((m) => ({ default: m.SkyLayer })));

export interface StudioProps {
  phone: boolean;
  /** 怎么生成:随机 / 照手绘图(新建时定下,两种不能互换) */
  mode: 'random' | 'image';
  params: WorldParams;
  /** 名字(打开没建完的世界时是它存的名字;以别的世界为底稿时先填好"原名(二)") */
  title: string;
  base: DraftBase | null;
  /** 左上返回(我的世界 / 底稿那个世界) */
  back: { label: string; onClick: () => void } | null;
  /** 换种子(params:连参数一起换,「看过的星球」里点一颗、带种子的预设) */
  onSeed: (seed: number, params?: WorldParams) => void;
  /** 换一个随机种子(随机生成的「换一颗」;照手绘图的「山河、地名换一种」:海陆照图,不变) */
  onRandomSeed: () => void;
  onParams: (p: WorldParams) => void;
  onTitle: (title: string) => void;
  /**
   * 确认创建:名字、正中的经度(度,平常的地图从这里接着看);how = 选了「演绎」(step:从第 0 年起逐年推演)/「照大纲」(outline:建好以后先打开大纲);
   * true = 建好了
   */
  onCreate: (title: string, lon: number, how?: 'step' | 'outline') => boolean;
  /** 第 1 步「保存地图」:只存地图、回我的世界;存下了 = true */
  onSaveMap: () => boolean;
  /** 在一张地图上打造文明(地图锁着):那张地图是哪个世界的(名字;只存了地图的、那个世界删掉了 = null)、一句简介;新建世界 = undefined */
  mapFrom?: { title: string | null; brief: string };
  /** 正在生成(换了种子、调了参数、改了地形):创建不了 */
  busy: boolean;
  /**
   * 编辑地形以后正在补推历史、起地名(编辑地形时不推历史,收起时补推):按钮照常能点(接着在后台起),
   * 确认创建以后等它起好再建
   */
  naming: boolean;
  /** 编辑地形时不推历史:正在编辑(还没收起)或正在补推,历史一会儿就有 */
  later: boolean;
  /** 补推的地名刚起好(星球上的地名淡入快一点) */
  namesIn: boolean;
  /** 照手绘图新建在第 2 步「用笔修改」点了「创建世界」:当作离开这一步(App 补推历史、起地名) */
  onLeaveTerrain: () => void;
  /** 世界出来了(不在生成) */
  ready: boolean;
  /** 地图出来了(历史可能还在推:新建的世界地图先换上):星球、样式缩略图看它,按钮照旧看 ready */
  mapReady: boolean;
  noCiv: boolean;
  data: { world: World; raster: Raster } | null;
  /** 第 0 年的星球(有地形大事时是大事以前的那颗;文明起源按它算) */
  baseWorld: World | null;
  /** 这颗星球推演出来的历史(套上改名的、没套的):助手要用 */
  civ: Civ | null;
  raw: Civ | null;
  /** 正在生成 / 按新地形重新生成:助手这时发不了话、确认单也不能执行 */
  worldBusy: boolean;
  /** 平常页面现在的图层(新建时 = 这里选的样式) */
  layer: MapLayer;
  onLayer: (id: MapLayer) => void;
  /** 某画风的整张图(等距圆柱;App 的缓存) */
  baseCanvas: (key: string) => HTMLCanvasElement | null;
  thumbs: Partial<Record<MapLayer, string>>;
  requestThumbs: (ids: MapLayer[]) => void;
  /** 创建以后:星球展开完、开始淡出(App 把平常的地图露出来) */
  onFade: () => void;
  /** 淡出完了(App 卸掉新建界面) */
  onGone: () => void;
  /** 第 1 步「照故事找世界 ›」(新建世界分两步时才有) */
  onFinder?: () => void;
  /** 照故事找世界「用这个世界」回来的:第 2 步种子和推演设定锁着,建好停在开场那年(换了种子 = null) */
  found?: StudioFound | null;
  /** 「回去换一个」:回到找世界的结果 */
  onFoundBack?: () => void;
}

/** 照故事找世界找到、要用的那个世界(第 2 步那一句说明、底部按钮用) */
export interface StudioFound {
  /** 地图种子、文明种子 */
  mapSeed: number;
  civSeed: number;
  /** 开场那年(建好以后停在这一年) */
  year: number;
  /** 故事里每国的叫法、对上的国名 */
  roles: { role: string; name: string }[];
  /** 加成标记的几处("隘口""三国交界") */
  places: string[];
  /** 从大纲页来的:带过去的大纲几条(不是 = 不给) */
  outline?: number;
}

/** 「看过的星球」里的一条:那颗星球的参数(连种子)、当时的小图、什么时候看的 */
interface Seen {
  key: string;
  params: WorldParams;
  thumb: string | null;
  at: number;
}
/** 最多记几条 */
const SEEN_MAX = 20;

/** 「看过的星球」的小图:实景整张图上正对着 lon(弧度)的那半边,裁成圆 */
function planetThumb(c: HTMLCanvasElement | null, lon: number): string | null {
  if (!c || !c.width) return null;
  const t = document.createElement('canvas');
  const S = 72;
  t.width = t.height = S;
  const ctx = t.getContext('2d');
  if (!ctx) return null;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.clip();
  const w = c.width / 2;
  const cx = ((((((lon * 180) / Math.PI + 180) % 360) + 360) % 360) / 360) * c.width;
  const sx = Math.max(0, Math.min(c.width - w, cx - w / 2));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, sx, 0, w, c.height, 0, 0, S, S);
  // 边上暗一点,像个球
  const g = ctx.createRadialGradient(S * 0.42, S * 0.38, S * 0.1, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const url = t.toDataURL('image/jpeg', 0.8);
  t.width = t.height = 0;
  return url;
}

/** "现在""刚才""3 分钟前" */
function agoText(at: number, now: number): string {
  const m = Math.floor((now - at) / 60000);
  return m < 1 ? '刚才' : m < 60 ? `${m} 分钟前` : `${Math.floor(m / 60)} 小时前`;
}

/** 「看过的星球」里第二行:"陆地 40%，2 块大陆""陆地 33%，大陆自动" */
const seenBrief = (q: WorldParams) => `陆地 ${Math.round(q.landFraction * 100)}%，${q.continents ? `${q.continents} 块大陆` : '大陆自动'}`;

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Studio(p: StudioProps) {
  const edits = useEdits();
  /** 推演年数:开了「推演超过 3000 年」= years */
  const years = cleanEndYear(edits.endYear);
  const endYear = years ?? END_YEAR_DEFAULT;
  const tool = useTerrainTool();
  const imp = useImport();
  const importing = !!imp;
  const src = useSource();
  const sv = useSourceView();
  const terrainHint = useTerrainHint();
  useTerrainKeys();
  const image = p.mode === 'image';
  /** 照手绘图:已经照图长出了星球(草图里有那张图) */
  const applied = !!edits.sketch?.image;
  const reduce = useMemo(reducedMotion, []);
  const style: MapLayer = STYLE_IDS.includes(p.layer) ? p.layer : 'realistic';
  const styleRef = useRef(style);
  styleRef.current = style;

  const rootRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<StudioScene | null>(null);
  const labRef = useRef<HTMLCanvasElement>(null);
  /** R1-2:预览天体的地理标签画布(主行星标签层在预览时关闭) */
  const previewLabRef = useRef<HTMLCanvasElement>(null);
  const pRef = useRef(p);
  /** N12A:编辑器里的最新覆盖表(不重生成世界也要能预览) */
  const sysEditOvRef = useRef<SystemOverrides>(EMPTY_OVERRIDES);
  pRef.current = p;
  /** 显卡:null = 还没试,false = 没有 / 丢了(退回平面地图) */
  const [glOk, setGlOk] = useState<boolean | null>(null);
  const [tip, setTip] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  /** 在一张地图上打造文明:地图锁着,只有定文明这一步 */
  const locked = !image && !!p.mapFrom;
  /** 新建世界分两步(以别的世界为底稿的还是一页) */
  const twoStep = !image && !p.base && !locked;
  /** 两步里到了第 2 步「文明」(照故事找世界「用这个世界」回来的直接在第 2 步) */
  const [civStep, setCivStep] = useState(() => !!p.found);
  /** 照故事找的:种子、推演年数、拓荒、起源、天灾、规则锁着(改了历史就不是找到的那样) */
  const found = twoStep ? (p.found ?? null) : null;
  const step2 = locked || (twoStep && civStep);
  /** 星系与天体弹层 / 星球系页(3D 系统预览) */
  const [sysEditOpen, setSysEditOpen] = useState(false);
  const [sysEditOv, setSysEditOv] = useState<SystemOverrides>(EMPTY_OVERRIDES);
  const [systemPage, setSystemPage] = useState(false);
  /** 步9:双击行星进地球仪时的缩放起点(舞台坐标;null = 不做转场) */
  const [sysSelected, setSysSelected] = useState(0);
  /** WP4:没有生物圈就不许创建文明(殖民/地球化留给科技树,见 gen/colonization.ts) */
  const [civBlock, setCivBlock] = useState<string | null>(null);
  const civCheck = useMemo(() => canHostCiv(p.data?.world ?? p.baseWorld ?? null), [p.data, p.baseWorld]);
  const fixCivOrigin = () => {
    setCivBlock(null);
    p.onParams({ ...p.params, life: 1 });
  };
  /** WP7:单 stage —— 星系视角 / 地球仪视角,700ms 推进转场 */
  const [sysStage, setSysStage] = useState<'system' | 'globe'>('globe');
  /** 顶层三模式:星系(3D 场景)/ 地图(原版 Studio)/ 文明(天体文明) */
  const [studioMode, setStudioMode] = useState<'galaxy' | 'map' | 'civ'>('galaxy');
  /** 双击行星的缩放起点(舞台像素;null = 不缩放) */
  /** 相机推进目标行星(null = 不推进) */
  const [sysFocus, setSysFocus] = useState<number | null>(null);
  /** 返回星系视角时"从哪颗行星拉远"(null = 不拉远) */
  /** 切地球仪时星图留在后面淡出(减少硬切) */
  const [sysGhost, setSysGhost] = useState(false);
  /** 步13:文明面板 —— 打开状态、当前天体 id、推演结果 */
  const [civOpen, setCivOpen] = useState(false);
  const [civBodyId, setCivBodyId] = useState<string | null>(null);
  const [civInfo, setCivInfo] = useState<{ id: string; viable: boolean; cultures: number; polities: number; settlements: number; endYear: number } | null>(null);
  const [civBusy, setCivBusy] = useState(false);
  /** 步13:每天体文明(内存;点"存进存档"才写 bodies) */
  const [civStore, setCivStore] = useState<{ id: string; civs: unknown[] }[]>([]);
  const [sysPullFrom, setSysPullFrom] = useState<number | null>(null);
  /** US 式星图:各行星的小贴图(懒加载;生成一张塞一张,星图里直接画成球) */
  const bodyTexRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [bodyTexVersion, setBodyTexVersion] = useState(0);
  /** R1-1:预览天体的样式缩略图(小尺寸 dataURL;非主行星时用它替换主行星缩略图) */
  const [bodyThumb, setBodyThumb] = useState<string | null>(null);
  const [sysZoomAt, setSysZoomAt] = useState<{ x: number; y: number } | null>(null);
  const [sysFade, setSysFade] = useState(false);
  /** 7C:现画非主行星地表时给加载态 */
  const [bodyLoading, setBodyLoading] = useState(false);
  /** N12A:从地球仪点「编辑这颗行星」进来时,编辑器先选中哪颗 */
  const [sysEditFocus, setSysEditFocus] = useState<{ kind: 'planet'; planet: number } | null>(null);
  /** N12A:覆盖表改完 +1,让预览贴图按新设计重算 */
  const [bodyRev, setBodyRev] = useState(0);
  // ---- 规则:选的那一套、跟上「我的规则」里调过的 ----
  /**
   * 选的是「我的规则」里的哪一套(本机编号;null = 官方规则;undefined = 还没在这里选过,照修改里的那一套)。
   * 另外记着:一项没改的一套和官方一样,写不进修改(见 editsStore.ts 的 setRules),选了它也要打勾、调了以后要跟上
   */
  const [rulesPick, setRulesPick] = useState<string | null | undefined>(undefined);
  const rulesOn = rulesUiOn();
  const myRules = useMyRules();
  const rulesPickId = rulesPick === undefined ? (edits.rules?.id ?? null) : rulesPick;
  // 修改里带着「我的规则」里的一套进来的(别人分享的「用它新建世界」、另存一份重推、没建完接着建):记成选了它。
  // 不然在大卡里把它全改回官方,修改里写不下(和官方一样),再调就跟不上了
  useEffect(() => {
    if (rulesPick === undefined && edits.rules?.id) setRulesPick(edits.rules.id);
  }, [rulesPick, edits.rules?.id]);
  const pickedRules = rulesPickId ? myRules.find((e) => e.rules.id === rulesPickId) : undefined;
  /** 「规则」那一行右边写的:选的那一套的名字(修改里带着、不在我的规则里的,写它的名字) */
  const rulesName = pickedRules?.rules.name ?? edits.rules?.name ?? OFFICIAL_RULES_NAME;
  /** 规则是跟着选的预设换的:换之前的那一套(再选不带规则的预设时换回来;自己在「规则」那一页选过就不算) */
  const beforePreset = useRef<{ rules: RuleSet | undefined; pick: string | null | undefined } | null>(null);
  /** 选一套规则(null = 官方规则) */
  const pickRules = (id: string | null) => {
    beforePreset.current = null;
    setRulesPick(id);
    setRules(id ? findMyRules(id)?.rules : undefined);
  };
  /** 第 2 步「怎么推」:一口气推完(推演年数)/ 演绎(建好以后从第 0 年起逐年推演,推进设置)/ 照大纲(照常推完,建好以后先打开大纲) */
  const [how, setHow] = useState<'all' | 'step' | 'outline'>('all');
  const stepHow = step2 && how === 'step';
  const outlineHow = step2 && how === 'outline';
  /** 确认框里的动词;选了演绎时推演年数不算(从第 0 年起一步步往下走) */
  const verb = stepHow ? '演绎' : '推演';
  const yearsLocked = !!years && !stepHow;
  /** 第 2 步里推演年数、推进设置、拓荒展开着没有 */
  const [yearsOpen, setYearsOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [frontierOpen, setFrontierOpen] = useState(false);
  /** 一进来用的投影:设过「新建时的默认」就照它(照手绘图的照旧是地球仪) */
  const startProj = useRef<PlanetProjection>((!image && getNewView()?.proj) || 'globe');
  const [proj, setProj] = useState<PlanetProjection>(startProj.current);
  // 经纬网:和世界页、编辑地形共用一个设置(开关 + 间隔)
  const grat = useGraticule();
  const [confirm, setConfirm] = useState(false);
  /** 创建以后:1 = 面板滑出、星球展开;2 = 淡出 */
  const [out, setOut] = useState<0 | 1 | 2>(0);
  // 选的是「我的规则」里的一套:那一套调过、改了名(在调规则的大卡里、别的页面里),这个世界跟着用现在的样子(和官方一样 = 不写);
  // 照故事找的锁着,不跟;点了创建以后(面板滑出、淡出时)已经定下,不再跟
  useEffect(() => {
    if (!found && !out && pickedRules) setRules(pickedRules.rules);
  }, [pickedRules, found, out, edits.rules]);
  const gone = useRef(false);
  /** 平面地图露出来了(改地形 / 没有 WebGL):星球藏起来 */
  const [flatShown, setFlatShown] = useState(false);
  // 手机:底部卡片拉开没有、右上哪个列表开着、卡片多高
  const [sheetFull, setSheetFull] = useState(false);
  /** 左边换成「地名风格」页(手机上卡片里换页) */
  const [namesPage, setNamesPage] = useState(false);
  /** 左边换成「文明起源」页 */
  const [originsPage, setOriginsPage] = useState(false);
  /** 左边换成选「规则」的那一页 */
  const [rulesPage, setRulesPage] = useState(false);
  /** 起源页上:星球停住时的样子(圆点按它摆;动着 = null)、底下的提示(点错了的那句和画虚线圈的地方,过几秒收起) */
  const [pinPose, setPinPose] = useState<StillPose | null>(null);
  const [originMsg, setOriginMsg] = useState<{ text: string; x: number; y: number } | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 上一次在星球上放下一处起源的时刻 */
  const addedAt = useRef(-Infinity);
  useEffect(() => () => clearTimeout(msgTimer.current), []);
  /** 起源页上选的是「自己选」、「别处也自动长出民族」关着(一处没点时也记着);切回「自动」时收起来的几处 */
  const [originCustom, setOriginCustom] = useState(false);
  const [originOnly, setOriginOnly] = useState(false);
  const keptOrigins = useRef<Origins | undefined>(undefined);
  /** 地形难走程度展开着没有(世界参数里) */
  const [terrOpen, setTerrOpen] = useState(false);
  /** 地名风格页还没交的份数(见 NameMixPage 的 flush) */
  const mixFlush = useRef<(() => void) | null>(null);
  const [drawer, setDrawer] = useState<'style' | 'proj' | null>(null);
  const [sheetH, setSheetH] = useState(0);
  const [vw, setVw] = useState(() => (typeof innerWidth === 'number' ? innerWidth : 1280));
  const [vh, setVh] = useState(() => (typeof innerHeight === 'number' ? innerHeight : 800));

  // ---- 照手绘图:哪一步开着(null = 都收着)、开过哪几步(组头打勾)、地图是平面还是地球仪、样式列表开着没有 ----
  const [step, setStep] = useState<1 | 2 | 3 | null>(() => (!image ? null : getEdits().sketch?.image && !importOn() ? 2 : 1));
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (step) setSeen((s) => s | (1 << step));
  }, [step]);
  const [imgFlat, setImgFlat] = useState(true);
  const [styOpen, setStyOpen] = useState(false);
  /** 地图摊成平面:改地形的时候;照手绘图的平时也是(切到地球仪才卷起来) */
  const wantFlat = tool.on || (image && imgFlat);
  /**
   * 样式列表摊开着没有:电脑上右边一直摊开;手机上点开「样式」、照手绘图点开样式那一栏才摊开。
   * 编辑地形时列表收着:每停一次笔只重画按钮上那一张(每张缩略图都要先画一整张底图),其余的摊开时再画
   * (实景那张的整张底图收起平面时星球要用,顺手备好,点「完成」时不用当场画);别的时候照旧几张都做(点开列表时已经做好了)
   */
  const listOpen = image ? styOpen : !p.phone || drawer === 'style';
  const wantThumbs = () => p.requestThumbs(listOpen || !tool.on ? STYLE_IDS : style === 'realistic' ? [style] : [style, 'realistic']);

  // ---- 设定(和原来的新建卡片一样) ----
  const [paramsOpen, setParamsOpen] = useState(false);
  // ---- 看过的星球:这一次新建里每换一颗记一条(换种子、调参数),离开新建页就没了 ----
  const [planets, setPlanets] = useState<Seen[]>([]);
  const [seenOpen, setSeenOpen] = useState<{ x: number; y: number } | null>(null);
  const noteSeen = (q: WorldParams, thumb: string | null) => {
    const key = worldKey(q);
    setPlanets((l) => [{ key, params: q, thumb, at: Date.now() }, ...l.filter((x) => x.key !== key)].slice(0, SEEN_MAX));
  };
  const [name, setName] = useState(p.title);
  useEffect(() => setName(p.title), [p.title]);
  const [seedText, setSeedText] = useState(String(p.params.seed));
  useEffect(() => setSeedText(String(p.params.seed)), [p.params.seed]);
  const [seedBad, setSeedBad] = useState(false);

  // ---- 助手(只改地形、回答问题;对话、确认单在 assistantStore) ----
  const astOpen = useAstOpen();
  const ast = useAssistant();
  // 「使用 AI 功能」关着:没有「让助手改」(左边那行、手机右上第三个按钮)
  const aiOn = useAiOn();
  const astShown = aiOn && astOpen && !!p.data && !!p.civ && !!p.raw;
  /** 列出来、还没执行的那一份(最新的) */
  const pending = useMemo(() => {
    for (let i = ast.turns.length - 1; i >= 0; i--) {
      const t = ast.turns[i];
      if (t.status === 'done' && t.proposal && !t.applied && !t.dismissed && t.lock === 'history') return t;
    }
    return null;
  }, [ast.turns]);
  /** 星球上要圈出来的几处(勾着的改地形;编号 = 清单上第几条) */
  const marks = useMemo<PlanetMark[]>(() => {
    if (!pending?.proposal) return [];
    const off = new Set(pending.off ?? []);
    return pending.proposal.items.flatMap((x, i) => (x.change?.kind === 'terrain' && !off.has(i) ? [{ n: i + 1, op: x.change.op }] : []));
  }, [pending]);
  const marksRef = useRef<PlanetMark[]>([]);
  marksRef.current = astShown ? marks : [];

  // ---- 进来时平常的地图换成等距圆柱(改地形、没有 WebGL 时露出来的是它;藏着的时候换图层也最省事);
  //      没创建就离开时换回原来的投影 ----
  const prevProj = useRef<MapProjection>('equirect');
  /** 进来之前的平面投影(原来是地球仪时,从地球仪切回平面要回到的那个) */
  const prevFlat = useRef<ProjectionId>('equirect');
  const created = useRef(false);
  useLayoutEffect(() => {
    // 照故事找世界那一页回来:进新建之前的投影、经纬网是收起前记下的(那时已经换成了新建用的)
    const carried = takeStudioView();
    prevProj.current = carried?.proj ?? getProjection();
    prevFlat.current = carried?.flat ?? lastFlatProjection();
    // 设过「新建时的默认」:经纬网照它
    const nv = getNewView();
    const prevGrat = carried?.grat ?? { on: getGraticule(), step: getGraticuleStep() };
    if (nv && !image && !carried) {
      setGraticule(nv.grat);
      setGraticuleStep(nv.step);
    }
    if (prevProj.current !== 'equirect') setProjection('equirect');
    // 平常页面上开着的助手不跟进来(新建里从「让助手改」打开);离开时也收起
    closeAssistant();
    // 照手绘图:进来就是摊平的地图和认图(或第 2 步的笔)
    if (image) setTerrainTool({ on: true });
    return () => {
      closeAssistant();
      setStudioFlat(null);
      // 收起去照故事找世界:投影、经纬网先不换回去(回来接着用)
      if (keepStudioView({ proj: prevProj.current, flat: prevFlat.current, grat: prevGrat })) return;
      // 正在认的、留着的那张图只属于这一次新建
      dropSource();
      if (!created.current && prevProj.current !== 'equirect' && getProjection() === 'equirect') setProjection(prevProj.current, prevFlat.current);
      // 没创建就离开:经纬网也回到进来之前
      if (!created.current && nv && !image) {
        setGraticule(prevGrat.on);
        setGraticuleStep(prevGrat.step);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 星球上的地名:停住时排一次,一动就藏起来 ----
  const stillRef = useRef<StillPose | null>(null);
  const labTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [labOn, setLabOn] = useState(false);
  const markRef = useRef<HTMLCanvasElement>(null);
  const [markOn, setMarkOn] = useState(false);
  const surf = useRef<{ data: object; fn: LabelView['surface'] } | null>(null);
  const queueLabels = () => {
    clearTimeout(labTimer.current);
    if (!stillRef.current) {
      setLabOn(false);
      setMarkOn(false);
      return;
    }
    // 停稳一下再排(拖完松手、变形刚停时不急着排)
    labTimer.current = setTimeout(() => {
      const cv = labRef.current;
      const d = pRef.current.data;
      const pose = stillRef.current;
      if (!cv || !d || !pose || gone.current) return;
      if (surf.current?.data !== d) surf.current = { data: d, fn: labelSurface(d.world, d.raster, 1) };
      const feed = getCivFeed();
      const dpr = Math.min(2, devicePixelRatio || 1);
      const n = drawPlanetLabels(cv, feed.fontsOk ? feed.places : [], pose, d.world, surf.current.fn, dpr);
      setLabOn(n > 0);
      const mc = markRef.current;
      if (mc) setMarkOn(drawPlanetMarks(mc, marksRef.current, pose, d.world, dpr) > 0);
    }, 160);
  };
  // 地名换了(换了样式、换了一颗、字体刚加载好):停着的话重排
  useEffect(
    () =>
      subscribeCivFeed(() => {
        if (stillRef.current) queueLabels();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => clearTimeout(labTimer.current), []);

  // ---- 文明起源页:星球停转,点一下放一处、点圆点拿掉 ----
  const originsOn = originsPage && !tool.on && !out;
  const flashOrigin = (text: string, x: number, y: number) => {
    clearTimeout(msgTimer.current);
    setOriginMsg({ text, x, y });
    msgTimer.current = setTimeout(() => setOriginMsg(null), ORIGIN_MSG_MS);
  };
  const tapOrigin = (sx: number, sy: number, pose: StillPose) => {
    const d = pRef.current.data;
    const raw = pRef.current.civ ?? pRef.current.raw;
    const civ = raw && originCiv(raw);
    if (!d || !civ || !originCustom) return;
    const w = poseMap(pose, d.world.width, d.world.height).inv(sx, sy);
    if (!w) return;
    const o = getEdits().origins;
    const pts = o?.pts ?? [];
    const world = pRef.current.baseWorld ?? d.world;
    const why = originRefusal(world, civ, w[0], w[1], originSpots(world, civ, pts));
    if (why) return flashOrigin(why, sx, sy);
    clearTimeout(msgTimer.current);
    setOriginMsg(null);
    setOrigins(cleanOrigins({ pts: [...pts, w[0], w[1]], only: originOnly || undefined }));
    addedAt.current = performance.now();
  };
  const removeOrigin = (i: number) => {
    // 手机上点一下放了一处,浏览器随后补发的 click 正好落在刚出现的圆点上,别把它当成「拿掉」
    if (performance.now() - addedAt.current < PIN_GUARD_MS) return;
    const o = getEdits().origins;
    if (o) setOrigins(cleanOrigins({ pts: o.pts.filter((_, k) => k >> 1 !== i), only: o.only }));
  };
  const pickOriginCustom = (on: boolean) => {
    setOriginCustom(on);
    if (on) {
      if (keptOrigins.current) setOrigins(keptOrigins.current);
      keptOrigins.current = undefined;
    } else {
      keptOrigins.current = getEdits().origins;
      setOrigins(undefined);
    }
  };
  const pickOriginOnly = (only: boolean) => {
    setOriginOnly(only);
    const o = getEdits().origins;
    if (o) setOrigins(cleanOrigins({ pts: o.pts, only: only || undefined }));
  };

  // ---- 星球 ----
  const hooks = useRef<SceneHooks>({
    frame: () => {},
    flat: () => {},
    touched: () => {},
    still: () => {},
  });
  hooks.current = {
    frame: ({ cx, r, m, cy, tex, mix }) => {
      // 冒烟检查、测速用:星球上开始淡入的是哪一颗(at = 它第一次露出来那一帧)、淡入到哪
      const sh = shown.current;
      if (sh && mix > 0 && tex.startsWith(`${sh.tag}:`)) {
        const w = window as unknown as { __wfPlanet?: { seed: number; tag: number; at: number; mix: number } };
        if (w.__wfPlanet?.tag !== sh.tag) w.__wfPlanet = { seed: sh.seed, tag: sh.tag, at: performance.now(), mix };
        else w.__wfPlanet.mix = mix;
      }
      const g = glowRef.current;
      if (g) {
        const R = r * 1.2;
        g.style.opacity = m > 0.02 ? String(Math.pow(m, 3)) : '0';
        g.style.width = g.style.height = `${R * 2}px`;
        g.style.transform = `translate(${cx - R}px, ${cy - R}px)`;
      }
      if (!p.phone && tipRef.current) tipRef.current.style.left = `${cx}px`;
    },
    flat: (rect, lon) => {
      setStudioFlat(rect, lon);
      setFlatShown(!!rect);
    },
    touched: () => {
      setTip(false);
      setDrawer(null);
      setStyOpen(false);
    },
    still: (pose) => {
      stillRef.current = pose;
      queueLabels();
      if (originsOn) setPinPose(pose);
    },
    tap: (x, y, pose) => {
      if (originsOn) tapOrigin(x, y, pose);
    },
  };

  useLayoutEffect(() => {
    const cv = glRef.current;
    const root = rootRef.current;
    if (!cv || !root) return;
    const gl = PlanetGL.create(cv, { small: p.phone });
    if (!gl) {
      setGlOk(false);
      return;
    }
    const sc = new StudioScene(
      gl,
      {
        frame: (i) => hooks.current.frame(i),
        flat: (r, l) => hooks.current.flat(r, l),
        touched: () => hooks.current.touched(),
        still: (pose) => hooks.current.still(pose),
        tap: (x, y, pose) => hooks.current.tap?.(x, y, pose),
      },
      reduce,
    );
    sceneRef.current = sc;
    const size = () => {
      const w = root.clientWidth || innerWidth;
      const h = root.clientHeight || innerHeight;
      setVw(w);
      setVh(h);
      sc.setViewport(w, h, devicePixelRatio || 1);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(root);
    gl.onLost = () => {
      // 显卡丢了:退回平面地图(这一次新建里不再用星球)
      sc.dispose();
      sceneRef.current = null;
      setGlOk(false);
    };
    sc.start();
    setGlOk(true);
    return () => {
      ro.disconnect();
      if (sceneRef.current === sc) {
        sc.dispose();
        sceneRef.current = null;
      }
    };
    // 只在进来时建一次(手机 / 电脑跨断点时贴图大小不变)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 没有 WebGL:窗口大小跟着变
  useEffect(() => {
    if (glOk !== false) return;
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      setVw(root.clientWidth || innerWidth);
      setVh(root.clientHeight || innerHeight);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [glOk]);

  // 手机:底部卡片多高(星球摆在它上面)
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!p.phone || !el) return setSheetH(0);
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    setSheetH(el.offsetHeight);
    return () => ro.disconnect();
  }, [p.phone, glOk]);

  // 两边让出多少;面板滑进滑出时星球跟着挪(第一次直接摆好)
  const laidOut = useRef(false);
  // 助手开着:电脑上右边是助手面板(随机生成的换掉样式和投影);手机上助手的底部卡片占屏幕的 58%(星球摆在它上面)。
  // 照手绘图的没有右边的面板;手机上底部卡片的高是定的(拉到最高时盖住地图)
  const insets = useMemo(() => {
    if (p.phone) return { l: 0, r: 0, b: astShown ? Math.round(vh * AST_SHEET) : image ? Math.round(vh * SK_SHEET) : sheetH };
    return { l: collapsed ? 0 : LEFT_W, r: astShown ? AST_W : image ? 0 : RIGHT_W, b: 0 };
  }, [p.phone, collapsed, sheetH, astShown, vh, image]);
  useLayoutEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.setLayout({ ...insets, bar: image, phone: p.phone }, laidOut.current);
    laidOut.current = true;
  }, [insets, image, p.phone, glOk]);
  /** 中间那一块(两边面板、底部卡片让完以后) */
  const box = { x: insets.l, y: 0, w: Math.max(1, vw - insets.l - insets.r), h: Math.max(1, vh - insets.b) };

  // 没有 WebGL:右边样式的缩略图照样要做
  useEffect(() => {
    if (glOk === false && p.mapReady) wantThumbs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glOk, p.mapReady, p.data]);

  // 没有 WebGL:平常的地图一直铺在中间那块(刚铺上时带上正中的经线:从放大着的地图进来,也放回 1 倍看整颗星球)
  useEffect(() => {
    if (glOk !== false || out) return;
    setStudioFlat(flatRect(box, { phone: p.phone, bar: image }), getStudioFlat() ? undefined : getMapCenter());
    setFlatShown(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glOk, insets, vw, vh, p.phone, out, image]);

  // ---- 世界:贴图;第一颗直接是地球仪,换了一颗、调了参数、改了地形都淡过去 ----
  const tagRef = useRef(0);
  /** 星球上贴着的是哪一颗(mark = holdMark(世界数据):只记记号不拉住数据,摊平改地形时旧的那颗不白占内存) */
  const shown = useRef<{ mark: string; tag: number; seed: number; pkey: string } | null>(null);
  const landLon = useRef(0);
  /** 把某样式的整张图放上显卡(App 缓存里有就直接拿;没有就画一张,要等一会儿) */
  const upload = (sc: StudioScene, tag: number, id: MapLayer): boolean => {
    const key = `${tag}:${id}`;
    if (sc.gl.hasStyle(key)) return true;
    const c = p.baseCanvas(styleKey(id));
    if (!c || !c.width) return false;
    sc.gl.setStyle(key, c);
    return true;
  };

  /** 第一颗星球出来:开始自转(摊平着的等卷回来再转)、缩略图开始做 */
  const settle = () => {
    const sc = sceneRef.current;
    const first = startProj.current;
    setProj(first);
    if (!image && !p.base) setTip(true);
    if (sc) {
      sc.spin = first === 'globe';
      sc.setFlatBack(first);
    }
    wantThumbs();
  };

  /** 摊平着(改地形、照手绘图看平面)换了世界,星球的贴图还没跟着换 */
  const flatStale = useRef(false);
  useEffect(() => {
    const sc = sceneRef.current;
    const d = p.data;
    if (!glOk || !sc || !d || !p.mapReady || gone.current) return;
    if (shown.current?.mark === holdMark(d)) return;
    const prev = shown.current;
    // 摊平着看不见星球:贴图等收起平面时再换(整张底图那时多半已经在缩略图那边分小步备好了,贴上只要一下),
    // 不在每涂一笔以后都当场整张画一遍;右边的缩略图照样做(编辑地形时停笔一会儿才做,见 LayerPopover.tsx 的 useLayerThumbs)
    if (prev && wantFlat) {
      flatStale.current = true;
      wantThumbs();
      return;
    }
    const tag = ++tagRef.current;
    if (!upload(sc, tag, 'realistic')) return;
    if (style !== 'realistic') upload(sc, tag, style);
    const t = d.world.tect;
    const px = plateTexels(d.raster.cell, d.raster.w, d.raster.h, t.plate, d.world.water, t.plateContinental, PLATE_W, PLATE_H);
    const pkey = worldKey({ ...p.params, seed: 0 });
    shown.current = { mark: holdMark(d), tag, seed: p.params.seed, pkey };
    const latest = () => sc.gl.keepStyles((k) => k.startsWith(`${tagRef.current}:`));
    // 每换一颗都重算陆地最多的那一面(手机建好时转过去)
    landLon.current = landCenterLon(px, PLATE_W, PLATE_H);
    if (!image && !p.base) noteSeen(p.params, planetThumb(p.baseCanvas(styleKey('realistic')), landLon.current));
    if (!prev) {
      sc.showStyle(`${tag}:${style}`);
      if (!sc.flatOn) {
        sc.showProj(startProj.current);
        sc.lon = landLon.current;
      }
      settle();
      return;
    }
    wantThumbs();
    // 摊平着换的(这会儿收起平面):星球还没露出来,直接换上
    if (flatStale.current) {
      flatStale.current = false;
      sc.showStyle(`${tag}:${style}`);
      latest();
      return;
    }
    // 换了一颗、改了地形慢慢淡入新样子;同一颗调了参数淡得快
    void sc.setStyle(`${tag}:${style}`, prev.seed === p.params.seed && prev.pkey !== pkey ? 450 : 1100).then(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glOk, p.data, p.mapReady, wantFlat]);
  // 样式列表摊开了(手机点开「样式」):收着时没做的几张现在做(第一颗星球出来以前不抢在它前面)
  useEffect(() => {
    if (listOpen && p.mapReady && (shown.current || glOk === false)) p.requestThumbs(STYLE_IDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listOpen]);
  // 画不了地球仪(只有平面地图)时,看过的星球也照样记
  useEffect(() => {
    if (glOk !== false || !p.data || !p.mapReady || image || p.base) return;
    noteSeen(p.params, planetThumb(p.baseCanvas(styleKey('realistic')), 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glOk, p.data, p.mapReady]);

  // 换样式:淡过去
  useEffect(() => {
    const sc = sceneRef.current;
    const sh = shown.current;
    if (!sc || !sh || gone.current) return;
    if (!upload(sc, sh.tag, style)) return;
    void sc.setStyle(`${sh.tag}:${style}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  // 助手列出了要改的地方:星球转过去正对着它(新的一份才转);圈、编号停住时画,勾掉一条重画
  const faced = useRef(0);
  useEffect(() => {
    if (!astShown || !pending || faced.current === pending.id || !p.data) return;
    faced.current = pending.id;
    const c = marksCenter(marks, p.data.world);
    if (c) void sceneRef.current?.face(c[0], c[1]);
  }, [astShown, pending, marks, p.data]);
  useEffect(() => {
    if (stillRef.current) queueLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, astShown]);

  // 改地形(照手绘图的平时也是):摊成平面,换成平常的地图;改完从平常的地图现在的样子变回去
  useEffect(() => {
    if (tool.on) closeAssistant();
  }, [tool.on]);
  const flatAsked = useRef(false);
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || gone.current) return;
    if (wantFlat) {
      flatAsked.current = true;
      setTip(false);
      setDrawer(null);
      void sc.enterFlat();
    } else if (flatAsked.current) {
      flatAsked.current = false;
      void sc.exitFlat(flatGeom());
      // 随机生成画了草图:卷回地球仪时提示一句"换一颗"会照同一张草图长
      if (!image && getEdits().sketch) setTip(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantFlat, glOk]);

  // ---- 照手绘图的三步 ----
  // 开始认一张图(进来时、「换一张」、把图拖到地图上):回到第 1 步,地图摊平
  useEffect(() => {
    if (!image || !importing) return;
    setStep(1);
    setImgFlat(true);
    setStyOpen(false);
    if (!getTerrainTool().on) setTerrainTool({ on: true });
    // 认图时地图上看的是图:停在板块页的笔换回陆地(板块页会把地图换成板块配色)
    if (pageOf(getTerrainTool().tool) === 'plates') setTerrainTool({ tool: 'land' });
  }, [importing, image]);
  // 第 2 步的笔收起了(按了 Esc、切到地球仪、打开助手):这一步也收起
  useEffect(() => {
    if (image && !tool.on && step === 2) setStep(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.on]);
  /** 点组头:开着的收起(第 1 步还没长出星球时收不起),收着的展开(后两步要先长出星球) */
  const toggleStep = (n: 1 | 2 | 3) => {
    setStyOpen(false);
    if (step === n) {
      if (n === 1) {
        if (!applied) return;
        cancelImport();
      }
      if (n !== 3) setTerrainTool({ on: false });
      setStep(null);
      return;
    }
    if (n === 1) {
      // 接着上次的认法认;那张图已经不在了(刷新过)就重新选一张
      if (!importOn() && !resumeImport()) return pickImage();
      setImgFlat(true);
      setTerrainTool({ on: true });
      setStep(1);
      return;
    }
    if (!applied) return;
    cancelImport();
    setSourceView({ show: 'grown' });
    if (n === 2) {
      setImgFlat(true);
      setTerrainTool({ on: true });
    } else setTerrainTool({ on: false });
    setStep(n);
  };
  /** 「照这样长出星球」 */
  const growPlanet = () => {
    if (!p.ready || !applyImport()) return;
    setSourceView({ show: 'grown' });
    setStep(2);
  };
  /** 切换条上的平面 / 地球仪 */
  const setImageFlat = (f: boolean) => {
    setStyOpen(false);
    if (f) return setImgFlat(true);
    if (importOn() || !applied) return;
    // 卷成地球仪:笔收起,看长出来的
    if (tool.on) setTerrainTool({ on: false });
    setSourceView({ show: 'grown' });
    setImgFlat(false);
  };

  const pickStyle = (id: MapLayer) => {
    setDrawer(null);
    if (id !== p.layer) p.onLayer(id);
  };
  const pickProj = (id: PlanetProjection) => {
    setDrawer(null);
    const sc = sceneRef.current;
    if (!sc || tool.on) return;
    setProj(id);
    setTip(false);
    if (id !== 'globe') sc.spin = false;
    void sc.setProj(id);
  };

  // ---- 创建 ----
  const commitName = () => {
    if (name !== p.title) p.onTitle(name);
  };
  const askCreate = () => {
    p.onLeaveTerrain();
    commitName();
    mixFlush.current?.();
    setDrawer(null);
    setStyOpen(false);
    setConfirm(true);
  };
  /** 「地名风格」页:手机上卡片拉到最高 */
  const openNames = () => {
    setDrawer(null);
    if (p.phone) setSheetFull(true);
    setRulesPage(false);
    setNamesPage(true);
  };
  /** 选「规则」的那一页:手机上卡片拉到最高 */
  const openRulesPage = () => {
    setDrawer(null);
    setStyOpen(false);
    if (p.phone) setSheetFull(true);
    setNamesPage(false);
    closeOrigins();
    setRulesPage(true);
  };
  /** 「文明起源」页:星球停转(照手绘图的卷成地球仪),圆点按星球现在的样子摆;手机上卡片拉开 */
  const openOrigins = () => {
    setDrawer(null);
    setStyOpen(false);
    setTip(false);
    closeAssistant();
    const o = getEdits().origins;
    setOriginCustom(!!o);
    setOriginOnly(!!o?.only);
    keptOrigins.current = undefined;
    setRulesPage(false);
    if (p.phone) setSheetFull(true);
    if (image) {
      if (tool.on) setTerrainTool({ on: false });
      setSourceView({ show: 'grown' });
      setImgFlat(false);
    }
    const sc = sceneRef.current;
    if (sc) sc.spin = false;
    setPinPose(stillRef.current);
    setOriginsPage(true);
  };
  const closeOrigins = () => {
    setOriginsPage(false);
    setOriginMsg(null);
    setPinPose(null);
  };
  /** 「让助手改」:改地形工具开着就先收起(星球卷回来,圈画在星球上) */
  const askAssistant = () => {
    setDrawer(null);
    setStyOpen(false);
    setTip(false);
    setSheetFull(false);
    if (p.phone) {
      setNamesPage(false);
      setRulesPage(false);
    }
    closeOrigins();
    if (tool.on) setTerrainTool({ on: false });
    if (image) {
      setSourceView({ show: 'grown' });
      setImgFlat(false);
    }
    openAssistant();
  };
  const doCreate = async () => {
    // WP4:没有生物圈就建不出文明(提示在左栏,这里再挡一次,防止绕过)
    if (!civCheck.ok) {
      setCivBlock(civCheck.reason ?? '主行星现在不适合孕育文明');
      setConfirm(false);
      return;
    }
    setConfirm(false);
    // 编辑地形以后还在补推历史、起地名(照手绘图新建点「创建世界」时才开始的):等它起好再建(顶上提示条写着进度)
    while (pRef.current.naming) await new Promise((r) => setTimeout(r, 50));
    const sc = glOk ? sceneRef.current : null;
    // 建好以后平常的地图用哪种投影:这里选的平面投影;选的是地球仪就回到进来之前的平面投影
    const target: MapProjection = proj === 'globe' ? prevFlat.current : proj;
    const g = flatGeom();
    const flatLon = g?.lon ?? 0;
    gone.current = true;
    setOut(1);
    setTip(false);
    setStyOpen(false);
    closeAssistant();
    cancelImport();
    if (tool.on) setTerrainTool({ on: false });
    setSourceView({ show: 'grown' });
    setStudioFlat(null);
    setFlatShown(false);
    // 摊平着建:从平面地图现在正中的经线接着展开
    if (sc?.flatOn && g) sc.lon = (g.lon * Math.PI) / 180;
    // 手机竖屏建好以后只看得到八十来个经度:展开的同时转到陆地最多的那一面(不然可能正对着一片海)
    let to = sc?.lon ?? 0;
    if (sc && p.phone && vh > vw) {
      const d = landLon.current - sc.lon;
      to = sc.lon + d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
    }
    if (sc) await sc.leave(target, appPose(target, vw, vh), to);
    else await new Promise((r) => setTimeout(r, reduce ? 0 : 360));
    const lon = sc ? (((((to * 180) / Math.PI + 180) % 360) + 360) % 360) - 180 : flatLon;
    if (target !== getProjection()) setProjection(target);
    const ok = p.onCreate(name, lon, stepHow ? 'step' : outlineHow ? 'outline' : undefined);
    if (!ok) {
      // 没建成(还在生成):回到新建
      gone.current = false;
      setOut(0);
      if (getProjection() !== 'equirect') setProjection('equirect');
      if (sc) {
        void sc.setProj(proj);
        if (proj === 'globe') sc.spin = true;
      }
      if (image) setImgFlat(false);
      return;
    }
    created.current = true;
    setOut(2);
    p.onFade();
    setTimeout(p.onGone, reduce ? 0 : 420);
  };

  // 确认框:Esc = 再改改
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  // ---- 左边的设定 ----
  const base = p.base;
  const carried = !!base && base.names + base.interventions > 0;
  const commitSeed = () => {
    const n = Math.floor(Number(seedText));
    if (n > 0 && n !== p.params.seed) p.onSeed(n);
    else setSeedText(String(p.params.seed));
  };
  /** 打造文明:地图是哪个世界的 */
  const srcName = p.mapFrom?.title ?? null;
  const intro0 = locked
    ? srcName
      ? `用「${srcName}」一开始的地图，从第 0 年推演出一个新的文明。「${srcName}」本身不动。`
      : '用这张地图，从第 0 年推演出一个新的文明。地图本身不动。'
    : base
      ? `设定都带过来了，改完存成一个新世界，${base.title}本身不变。`
      : image
        ? '海和陆地照你的图长，山、河、气候由程序补上。'
        : civStep
          ? '地图定下了。接下来定文明怎么推演：一口气推完，或者从第 0 年起演绎。'
          : '按种子随机生成。地图做好了，可以先保存，也可以接着打造文明。';
  const isDefault = (Object.keys(DEFAULT_PARAMS) as (keyof WorldParams)[]).every((k) => k === 'seed' || p.params[k] === DEFAULT_PARAMS[k]) && (twoStep || !edits.frontier);
  const presets = usePresets();
  /** 和所选预设不一样的几样(数字用主色写) */
  const changed = changedKeys(presets, presets.chosen, p.params);
  /** 选了一个预设:参数换成它的(推演年数也是);存了种子的连种子换(以别的世界为底稿时种子不换);存了规则的规则选好那一套(照故事找的锁着) */
  const applyPreset = (c: PresetPick) => {
    if (c.endYear !== years) setEndYear(c.endYear);
    if (rulesOn && !found && c.rules) {
      beforePreset.current ??= { rules: edits.rules, pick: rulesPick };
      const r = takePresetRules(c.rules);
      setRulesPick(r.id && findMyRules(r.id) ? r.id : undefined);
      setRules(r);
    } else if (rulesOn && !found && beforePreset.current) {
      const b = beforePreset.current;
      beforePreset.current = null;
      setRulesPick(b.pick);
      setRules(b.rules);
    }
    if (!base && c.seed && c.seed !== p.params.seed) p.onSeed(c.seed, { ...c.params, seed: c.seed });
    else p.onParams({ ...c.params, seed: p.params.seed });
  };
  // 编辑地形时还没推的历史(收起编辑地形就补推):照常能点(助手那一栏等历史推好了再出来)
  const canAsk = p.ready && ((!!p.civ && !!p.raw) || p.later);
  const ico = p.phone ? 18 : 17;
  const peek = !image && p.phone && !sheetFull && !tool.on;

  const seedRow = base ? (
    <div className="sb-row nw-seed locked" data-act="seed-locked">
      <span className="sb-row-main">
        <b>种子</b>
        <small>换种子就是另一颗星球，请直接新建</small>
      </span>
      <span className="sb-row-side">{p.params.seed}</span>
      <Icon name="lock" size={15} className="nw-lock" />
    </div>
  ) : (
    <div className="sb-row nw-seed">
      <span className="sb-row-main">
        <b>种子</b>
        {seedBad && <small className="nw-seed-bad">只能填数字</small>}
      </span>
      <span className={`nw-seed-ctl${p.phone ? '' : ' with-hist'}`}>
        <input
          className="nw-field nw-seed-input"
          aria-label="种子"
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
        <button
          className="nw-btn tint"
          data-act="new-seed"
          onClick={() => {
            setTip(false);
            p.onRandomSeed();
          }}
          title="随机换一个种子"
        >
          <Icon name="dice" size={16} />
          换一颗
        </button>
        {!p.phone && (
          <button
            className={`nw-btn nw-hist${seenOpen ? ' on' : ''}`}
            data-act="seen-planets"
            aria-label="看过的星球"
            aria-expanded={!!seenOpen}
            data-tip={seenOpen ? undefined : '看过的星球'}
            disabled={!planets.length}
            onClick={(e) => {
              if (seenOpen) return setSeenOpen(null);
              const r = e.currentTarget.getBoundingClientRect();
              setDrawer(null);
              setSeenOpen({ x: r.right, y: r.top });
            }}
          >
            <Icon name="history" size={16} />
          </button>
        )}
      </span>
    </div>
  );
  const slider = (x: (typeof SLIDERS)[number]) => (
    <ParamSlider key={x.key} s={x} value={p.params[x.key]} changed={changed.has(x.key)} onCommit={(v) => p.onParams({ ...p.params, [x.key]: v })} />
  );
  // 「拓荒」三样(世界参数里精细度下面):民族扩散、国家扩张,「地形难走程度」点开原地展开八样
  const frontier = edits.frontier;
  /** 「天灾」(平常 = undefined) */
  const calamity = cleanCalamity(edits.calamity);
  const terrN = terrainChangedCount(frontier);
  const frontierRows = (
    <>
      <ParamSlider s={SPREAD_SLIDER} value={SPREAD_SLIDER.pos(frontier?.spread ?? 1)} changed={frontier?.spread !== undefined} onCommit={(v) => setFrontier(withSpeed(getEdits().frontier, 'spread', SPREAD_SLIDER.value(v)))} />
      <ParamSlider s={EXPAND_SLIDER} value={EXPAND_SLIDER.pos(frontier?.expand ?? 1)} changed={frontier?.expand !== undefined} onCommit={(v) => setFrontier(withSpeed(getEdits().frontier, 'expand', EXPAND_SLIDER.value(v)))} />
      <button className={`sb-row nw-terr${terrOpen ? ' open' : ''}`} data-act="terrain-cost" aria-expanded={terrOpen} onClick={() => setTerrOpen((o) => !o)}>
        <span className="sb-row-main">
          <b>地形难走程度</b>
        </span>
        {terrOpen ? (
          terrN > 0 && (
            <span
              className="sb-link"
              role="button"
              data-act="terrain-cost-reset"
              onClick={(e) => {
                e.stopPropagation();
                setFrontier(withoutTerrain(getEdits().frontier));
              }}
            >
              恢复默认
            </span>
          )
        ) : (
          <span className="sb-row-side">{terrN ? `改过 ${terrN} 样` : '默认'}</span>
        )}
        <Icon name={terrOpen ? 'down' : 'chevron'} size={14} className="sb-chev" />
      </button>
      {terrOpen && (
        <div className="nw-terr-list">
          {TERRAIN_SLIDERS.map(({ g, s: sl }) => {
            const v = terrainValue(frontier, g);
            return <ParamSlider key={g.key} s={sl} value={sl.pos(v)} changed={v !== g.def} onCommit={(x) => setFrontier(withTerrain(getEdits().frontier, g, sl.value(x)))} />;
          })}
        </div>
      )}
    </>
  );
  const paramsRow = (
    <>
      <button className={`sb-row nw-params${paramsOpen ? ' open' : ''}`} data-act="params" aria-expanded={paramsOpen} onClick={() => setParamsOpen((o) => !o)}>
        <Icon name="sliders" size={ico} className="sb-ico" />
        <span className="sb-row-main">
          <b>世界参数</b>
        </span>
        {paramsOpen ? (
          !isDefault && (
            <span
              className="sb-link"
              role="button"
              data-act="params-reset"
              onClick={(e) => {
                e.stopPropagation();
                // 分两步的新建:拓荒是第 2 步「文明」里的,这里不动它
                if (!twoStep) setFrontier(undefined);
                p.onParams({ ...DEFAULT_PARAMS, seed: p.params.seed });
              }}
            >
              恢复默认
            </span>
          )
        ) : (
          <span className="sb-row-side">{paramsSide(p.params)}</span>
        )}
        <Icon name={paramsOpen ? 'down' : 'chevron'} size={14} className="sb-chev" />
      </button>
      {paramsOpen && (
        <div className="nw-sliders">
          <div className="ps-row nw-preset">
            <span className="ps-l">预设</span>
            <PresetPicker params={p.params} endYear={years} rules={edits.rules} onPick={applyPreset} phone={p.phone} />
          </div>
          {SLIDERS.slice(0, 3).map(slider)}
          <div className="nw-sub">大陆</div>
          <div className="sb-row static nw-cont" data-param="continents">
            <span className="sb-row-main">数量</span>
            <ContinentSeg value={p.params.continents} onChange={(n) => p.onParams({ ...p.params, continents: n })} plates={p.params.plates} land={p.params.landFraction} />
          </div>
          {CONT_SLIDERS.map(slider)}
          <div className="nw-sub">气候</div>
          {SLIDERS.slice(3, 5).map(slider)}
          <div className="nw-sub">精细度</div>
          {SLIDERS.slice(5).map(slider)}
          {/* 分两步的新建:拓荒、推演年数在第 2 步「文明」里 */}
          {!twoStep && (
            <>
              <div className="nw-sub">拓荒</div>
              {frontierRows}
              <YearsRows />
            </>
          )}
        </div>
      )}
    </>
  );
  /** 第 1 步「照故事找世界 ›」:按故事里的条件把一批种子各推一遍,挑最合的(新建世界分两步时才有) */
  const finderRow = twoStep && p.onFinder && (
    <button className="sb-row" data-act="story-finder" disabled={!p.ready || p.busy} onClick={p.onFinder} title="按故事里的国家和地方，把一批世界各推一遍，挑出最合的">
      <Icon name="search" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>照故事找世界</b>
      </span>
      <span className="sb-row-side">按条件挑</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  const terrainRow = (
    <button className="sb-row terrain-toggle" data-act="terrain" disabled={!p.ready} onClick={() => setTerrainTool({ on: true })} title="涂大陆、山和海，放火山、湖和河">
      <Icon name="sketch" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>编辑地形</b>
      </span>
      <span className="sb-row-side">{terrainSide(edits, '还没改')}</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  const askRow = (
    <button className={`sb-row st-ask${astShown ? ' on' : ''}`} data-act="ask-assistant" disabled={!canAsk} onClick={askAssistant} title="说说想要什么样，助手替你放火山、拉山脉、挖湖">
      <Icon name="bubble" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>让助手改</b>
      </span>
      <span className="sb-row-side">说一句话就行</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  const originN = edits.origins ? edits.origins.pts.length >> 1 : 0;
  const originsRow = (
    <button className="sb-row" data-act="origins" disabled={!p.ready || !p.data || !(p.civ ?? p.raw)} onClick={openOrigins}>
      <Icon name="pin" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>文明起源</b>
      </span>
      <span className="sb-row-side">{originN ? `自己选了 ${originN} 处` : '自动'}</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  // ---- 第 2 步「文明」:文明种子、推演年数、拓荒(起源、名字、地名风格和原来一样) ----
  /** 文明种子:没写 = 跟着地图种子 */
  const civSeedNow = cleanCivSeed(edits.civSeed) ?? p.params.seed;
  const [civText, setCivText] = useState(String(civSeedNow));
  useEffect(() => setCivText(String(civSeedNow)), [civSeedNow]);
  const [civBad, setCivBad] = useState(false);
  /** 定文明种子:新建世界里和地图种子一样就不写(跟着地图种子);打造文明的一直写着 */
  const putCivSeed = (n: number) => setCivSeed(!locked && n === p.params.seed ? undefined : n);
  const commitCiv = () => {
    const n = Math.floor(Number(civText));
    if (n > 0 && n !== civSeedNow) putCivSeed(n);
    else setCivText(String(civSeedNow));
  };
  /** 照故事找的:锁着的一行(左边一把锁,右边写"和找的时候一样") */
  const lockedRow = (act: string, label: string, side: string) => (
    <div className="sb-row static nw-found-lock" data-act={act}>
      <Icon name="lock" size={15} className="sb-ico" />
      <span className="sb-row-main">
        <b>{label}</b>
      </span>
      <span className="sb-row-side">{side}</span>
    </div>
  );
  const civSeedRow = found ? (
    <div className="sb-row static nw-seed nw-civ-seed" data-act="civ-seed-found">
      <span className="sb-row-main">
        <b>文明种子</b>
      </span>
      <span className="sb-row-side">{civSeedNow}(照故事找的)</span>
    </div>
  ) : (
    <div className="sb-row nw-seed nw-civ-seed">
      <span className="sb-row-main">
        <b>文明种子</b>
        {civBad && <small className="nw-seed-bad">只能填数字</small>}
      </span>
      <span className="nw-seed-ctl">
        <input
          className="nw-field nw-seed-input"
          aria-label="文明种子"
          data-act="civ-seed"
          value={civText}
          inputMode="numeric"
          disabled={!p.ready}
          onChange={(e) => {
            const v = e.target.value;
            const d = v.replace(/\D/g, '');
            setCivBad(d !== v);
            setCivText(d.slice(0, 9));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          onBlur={() => {
            setCivBad(false);
            commitCiv();
          }}
        />
        <button className="nw-btn tint" data-act="new-civ-seed" disabled={!p.ready} onClick={() => putCivSeed(Math.floor(Math.random() * 999999) + 1)} title="随机换一个文明种子">
          <Icon name="dice" size={16} />
          换一个
        </button>
      </span>
    </div>
  );
  const yearsRow = (
    <>
      <button className={`sb-row nw-params${yearsOpen ? ' open' : ''}`} data-act="years" aria-expanded={yearsOpen} disabled={!p.ready} onClick={() => setYearsOpen((o) => !o)}>
        <Icon name="history" size={ico} className="sb-ico" />
        <span className="sb-row-main">
          <b>推演年数</b>
        </span>
        {!yearsOpen && <span className="sb-row-side">{endYear} 年</span>}
        <Icon name={yearsOpen ? 'down' : 'chevron'} size={14} className="sb-chev" />
      </button>
      {yearsOpen && (
        <div className="nw-sliders">
          <YearsRows />
        </div>
      )}
    </>
  );
  /** 怎么推:一口气推完 / 演绎 */
  const howRow = (
    <div className="sb-row nw-how" data-act="how">
      <span className="sb-row-main">
        <b>怎么推</b>
      </span>
      <span className="nw-dseg" role="radiogroup" aria-label="怎么推">
        <button role="radio" aria-checked={!stepHow && !outlineHow} className={stepHow || outlineHow ? '' : 'on'} data-act="how-all" onClick={() => setHow('all')}>
          一口气推完
        </button>
        <button role="radio" aria-checked={stepHow} className={stepHow ? 'on' : ''} data-act="how-step" onClick={() => setHow('step')}>
          演绎
        </button>
        <button role="radio" aria-checked={outlineHow} className={outlineHow ? 'on' : ''} data-act="how-outline" onClick={() => setHow('outline')}>
          照大纲
        </button>
      </span>
    </div>
  );
  /** 「天灾」平常 / 多 / 很多(选了多、很多:下面一句会怎样) */
  const calamityRow = (
    <>
      <div className="sb-row nw-how" data-act="calamity">
        <span className="sb-row-main">
          <b>天灾</b>
        </span>
        <span className="nw-dseg" role="radiogroup" aria-label="天灾">
          {([undefined, ...CALAMITIES] as const).map((c) => (
            <button key={c ?? 'usual'} role="radio" aria-checked={calamity === c} className={calamity === c ? 'on' : ''} data-act={`calamity-${c ?? 'usual'}`} disabled={!p.ready} onClick={() => setCalamity(c)}>
              {c ? CALAMITY_NAMES[c] : '平常'}
            </button>
          ))}
        </span>
      </div>
      {calamity && <div className="nw-note nw-how-note">{calamityNote(calamity, p.phone)}</div>}
    </>
  );
  /** 「规则」:选的那一套的名字,点了左边换成选规则的那一页(入口开着时才有) */
  const rulesRow = rulesOn && (
    <button className="sb-row" data-act="rules" onClick={openRulesPage}>
      <Icon name="sliders" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>规则</b>
      </span>
      <span className="sb-row-side sb-origin">{rulesName}</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  /** 选了照大纲:一句说明(放在「怎么推」下面) */
  const outlineNote = outlineHow && <div className="nw-note nw-how-note">建好以后先打开「大纲」：一条条写下故事里的大事，写完点「照大纲推演」。地形、民族、国家起源照常生成，大纲只决定后面的历史怎么走。</div>;
  const adv = advanceOf(edits);
  /** 选了演绎:推进设置(和逐年推演开始之前的设置同一套,点开原地展开) */
  const advRow = (
    <>
      <button className={`sb-row nw-params${advOpen ? ' open' : ''}`} data-act="advance" aria-expanded={advOpen} disabled={!p.ready} onClick={() => setAdvOpen((o) => !o)}>
        {!p.phone && <Icon name="sliders" size={ico} className="sb-ico" />}
        <span className="sb-row-main">
          <b>推进设置</b>
        </span>
        <span className="sb-row-side">{advanceBrief(adv)}</span>
        <Icon name={advOpen ? 'down' : 'chevron'} size={14} className="sb-chev" />
      </button>
      {advOpen && (
        <div className="nw-sliders nw-adv">
          {/* 左边面板窄:照手机的排法(分段按钮各占一行) */}
          <AdvanceFields adv={adv} set={setAdvance} phone />

        </div>
      )}
    </>
  );
  const frontierRow = (
    <>
      <button className={`sb-row nw-params${frontierOpen ? ' open' : ''}`} data-act="frontier" aria-expanded={frontierOpen} disabled={!p.ready} onClick={() => setFrontierOpen((o) => !o)}>
        <Icon name="sketch" size={ico} className="sb-ico" />
        <span className="sb-row-main">
          <b>拓荒</b>
        </span>
        {frontierOpen ? (
          frontier && (
            <span
              className="sb-link"
              role="button"
              data-act="frontier-reset"
              onClick={(e) => {
                e.stopPropagation();
                setFrontier(undefined);
              }}
            >
              恢复默认
            </span>
          )
        ) : (
          <span className="sb-row-side">{frontier ? frontierBrief(frontier) : '默认'}</span>
        )}
        <Icon name={frontierOpen ? 'down' : 'chevron'} size={14} className="sb-chev" />
      </button>
      {frontierOpen && <div className="nw-sliders">{frontierRows}</div>}
    </>
  );
  /** 打造文明:最上面锁着的那张地图 */
  const mapRow = locked && (
    <div className="sb-row static nw-map-row" data-act="map-locked">
      <Icon name="map" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>{srcName ? `${srcName}一开始的地图` : '这张地图'}</b>
        {!p.phone && <small>{p.mapFrom!.brief}</small>}
      </span>
      {p.phone && <Icon name="lock" size={15} className="nw-lock" />}
    </div>
  );
  /** 照故事找的:那一句说明(谁是故事里的哪一国、加成标记的几处、为什么锁着)和「回去换一个」 */
  const foundNote = found && (
    <div className="nw-note nw-found-note" data-testid="found-note">
      照故事找的世界：建好以后停在第 {found.year} 年
      {found.roles.length ? `，${found.roles.map((r, i) => `${r.name}是${i ? '' : '你的'}「${r.role}」`).join('、')}` : ''}
      {found.places.length ? `；${found.places.join('和')}加成地图上的标记` : ''}
      {found.outline ? `；大纲 ${found.outline} 条一起带过去，对不上的标出来让你重新指` : ''}。种子和这几样设定改了，历史就不是找到的那样了，所以先锁着。
      {p.onFoundBack && (
        <button className="sb-link nw-found-back" data-act="found-back" onClick={p.onFoundBack}>
          回去换一个
        </button>
      )}
    </div>
  );
  const civNote = stepHow ? (
    <div className="nw-note">演绎：建好以后从第 0 年起一步一步往下推，导播带你看发生了什么。最早几百年还没有国家，会很快带过。</div>
  ) : (
    <div className="nw-note">文明种子决定民族、国家和名字怎么长出来。同一张地图换一个文明种子，就是另一个文明。</div>
  );
  const leftNote = locked && srcName && <div className="nw-note">{srcName}里的国家、人物、你的干预、标记、改过的名字和地形大事都不带过来。</div>;
  const noCivHint = p.noCiv && <div className="nw-note warn">{image ? '这颗星球长不出文明，多画些陆地试试' : '这颗星球长不出文明，换一颗或调大陆地比例'}</div>;
  const baseRows = base && (
    <>
      <div className="sb-row static" data-act="base-names">
        <Icon name="rename" size={ico} className="sb-ico" />
        <span className="sb-row-main">
          <b>改过的名字</b>
        </span>
        <span className="sb-row-side">{base.names} 处</span>
      </div>
      <div className="sb-row static" data-act="base-interventions">
        <Icon name="intervene" size={ico} className="sb-ico" />
        <span className="sb-row-main">
          <b>干预历史</b>
        </span>
        <span className="sb-row-side">{base.interventions} 条</span>
      </div>
      <div className="nw-group-hint">地形改了以后，有的地方会变成海、历史也会不同；对不上的改名和干预先留着不生效，创建后会列出来。</div>
    </>
  );
  const carriedSec = carried && (
    <section className="sb-sec">
      <div className="sb-sec-head">
        <span>跟过去的修改</span>
      </div>
      <div className="sb-group">{baseRows}</div>
    </section>
  );
  const moreMenu = (
    <div className="nw-more-wrap">
      <PopMenu className="sb-pill sb-more" icon={<Icon name="more" size={17} />} title="更多" act="world-more" align="right">
        <AiSettingsItem onClick={() => openAiSettings()} />
        <MenuSep />
        <MenuItem icon={<Icon name="log" size={16} />} act="diag" onClick={openDiag}>
          问题记录
        </MenuItem>
        <MenuItem icon={<Icon name="info" size={16} />} href={SOURCE_URL} act="source">
          源代码
        </MenuItem>
        <MenuItem href={PRIVACY_URL} act="privacy">
          隐私政策
        </MenuItem>
        <MenuItem href={TERMS_URL} act="terms">
          用户协议
        </MenuItem>
        <ContactMenuItem />
        <VersionMenuFoot />
      </PopMenu>
    </div>
  );
  const heading = locked ? '打造文明' : base ? `以${base.title}为底稿新建` : image ? '照手绘图新建' : '新建世界';
  /** 第 1 步 → 第 2 步:改地形、助手、地名风格和起源那两页都收起;星球底下换一句提示 */
  const toCiv = () => {
    if (!civCheck.ok) {
      setCivBlock(civCheck.reason ?? '主行星现在不适合孕育文明');
      return;
    }
    setDrawer(null);
    setSeenOpen(null);
    if (tool.on) setTerrainTool({ on: false });
    closeAssistant();
    setNamesPage(false);
    setRulesPage(false);
    closeOrigins();
    setSheetFull(false);
    setCivStep(true);
    setTip(true);
  };
  const toMap = () => {
    setDrawer(null);
    setNamesPage(false);
    setRulesPage(false);
    closeOrigins();
    setSheetFull(false);
    setYearsOpen(false);
    setFrontierOpen(false);
    setCivStep(false);
    setTip(false);
  };
  const backLink =
    twoStep && civStep ? (
      <button className="nw-back" data-act="back-to-map" onClick={toMap}>
        <Icon name="back" size={18} />
        改地图
      </button>
    ) : (
      p.back && (
        <button className="nw-back" data-act="back" onClick={p.back.onClick}>
          <Icon name="back" size={18} />
          {p.back.label}
        </button>
      )
    );
  /** 两步:「① 地图 —— ② 文明」,现在这一步蓝色,做完的打勾 */
  const stepper = twoStep && (
    <div className="st-steps" aria-label={civStep ? '第 2 步，共 2 步' : '第 1 步，共 2 步'}>
      <span className={`st-st${civStep ? ' ok' : ' on'}`} data-step="map">
        <i>{civStep ? <Icon name="check" size={11} /> : '1'}</i>
        地图
      </span>
      <span className="st-bar" aria-hidden="true" />
      <span className={`st-st${civStep ? ' on' : ''}`} data-step="civ">
        <i>2</i>
        文明
      </span>
    </div>
  );
  const nameField = (
    <input
      className="nw-field nw-name"
      data-act="world-name"
      value={name}
      maxLength={TITLE_MAX}
      placeholder="给这个世界起个名字"
      spellCheck={false}
      aria-label="世界名"
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      onBlur={commitName}
    />
  );
  /** 星系与天体…(每颗行星/卫星的轨道、地表参数与地形;只在建图这一步能改) */
  const sysEditRow = (
    <button className="sb-row" data-act="open-system-editor-studio" disabled={p.busy || !p.data} title="每颗行星/卫星的轨道、地表参数与地形;新建地图这一步改,建好以后这几项锁着" onClick={() => {
        const ov = currentSystem() ?? EMPTY_OVERRIDES;
        setSysEditOv(ov);
        sysEditOvRef.current = ov;
        setSysEditFocus(null);
        setSysEditOpen(true);
      }}>
      <span className="sb-row-main">
        <b>星系与天体…</b>
      </span>
      <span className="sb-row-side">{p.params.astro === 1 ? '已开' : '未开'}</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );

  /** 星球系(3D 系统预览) */
  const sysRow = (
    <button className="sb-row" data-act="system-page" disabled={!p.data} onClick={() => setSystemPage(true)}>
      <span className="sb-row-main">
        <b>星球系</b>
      </span>
      <span className="sb-row-side">3D 预览</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  /** 星系与天体弹层(改完落进当前世界的覆盖表) */
  const sysEditDlg = sysEditOpen ? (
    <SystemEditor
      params={p.params}
      overrides={sysEditOv}
      focus={sysEditFocus ?? undefined}
      onChange={(o) => {
        setSysEditOv(o);
        sysEditOvRef.current = o;
      }}
      onParams={(patch) => p.onParams({ ...p.params, ...patch })}
      onClose={() => {
        setCurrentSystem(sysEditOv);
        setSysEditFocus(null);
        setSysEditOpen(false);
        // N12A:地形/地表/名字改了以后,预览贴图要按新覆盖表重画
        dropBodyTextures();
        setBodyRev((v) => v + 1);
      }}
    />
  ) : null;
  const mixRow = (
    <button className="sb-row" data-act="name-mix" onClick={openNames}>
      <span className="sb-row-main">
        <b>地名风格</b>
      </span>
      <span className="sb-row-side">{mixSummary(edits.nameMix)}</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  /** WP4 提示条:没有生物圈时挡住「打造文明」,并给一键修正 */
  const civBlockNote = !civCheck.ok && !image && out === 0 && (
    <div data-act="civ-block" style={{ margin: '6px 10px 0', padding: '7px 9px', borderRadius: 8, border: '1px solid rgba(192,112,112,0.5)', background: 'rgba(192,112,112,0.1)', fontSize: 11.5, lineHeight: 1.6 }}>
      <b style={{ color: '#a4544f' }}>造不了文明：</b>
      {civBlock ?? civCheck.reason ?? '主行星没有生物圈'}
      <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="ov-btn" data-act="civ-fix" onClick={fixCivOrigin} style={{ padding: '0 6px', fontSize: 11.5 }}>
          把主行星改成有生物圈
        </button>
        <span style={{ opacity: 0.6 }}>殖民 / 地球化改造等科技树（暂未开放）</span>
      </div>
    </div>
  );
  const createBtn = (
    <>
      {civBlockNote}
      <button className="nw-create" data-act="create-world" disabled={p.busy || !p.ready || out > 0 || importing || (image && !applied)} onClick={askCreate}>
      {base ? '创建新世界' : step2 ? (stepHow ? '开始演绎' : outlineHow ? '建好，先写大纲' : found ? `建好，停在第 ${found.year} 年` : '开始推演') : '创建世界'}
      </button>
    </>
  );
  /** 第 1 步底部:「保存地图」「打造文明 ›」 */
  const mapBtns = (
    <div className="st-foot-2">
      <button className="nw-create alt" data-act="save-map" disabled={p.busy || !p.ready || out > 0} onClick={() => p.onSaveMap()}>
        保存地图
      </button>
      <button className="nw-create" data-act="to-civ" disabled={p.busy || !p.ready || out > 0} onClick={toCiv}>
        {p.phone ? '地图做好了，下一步' : '打造文明 ›'}
      </button>
    </div>
  );
  const footBtn = twoStep && !civStep ? mapBtns : createBtn;
  const mixShown = namesPage && !tool.on && !peek;
  const rpShown = rulesOn && rulesPage && !tool.on && !peek && !mixShown;
  /** 文明起源按第 0 年的州看(有地形大事时是大事以前的,见 origins.ts 的 originCiv) */
  const ogRaw = p.civ ?? p.raw;
  const ogCiv = ogRaw && originCiv(ogRaw);
  /** 星球系页:看的世界(和文明起源页同一份) */
  const sysWorld = p.baseWorld ?? p.data?.world ?? null;
  const sysAstro = useMemo(() => (sysWorld ? astroOf(sysWorld) : null), [sysWorld]);
  const sysNames = useMemo(() => (sysAstro && sysWorld ? namedBodies(sysAstro, sysWorld.params.seed, sysWorld.system) : null), [sysAstro, sysWorld]);
  const sysBelts = useMemo(() => (sysAstro && sysWorld ? beltsOf(sysAstro.design, sysWorld.params.seed, sysWorld.params.impact) : []), [sysAstro, sysWorld]);
  const STAGE_MS = reduce ? 0 : 700;
/** 镜头推进时长(推到位再切到地球仪) */
const ZOOM_MS = 520;
  const SYS_END_YEAR = 200;
  /** N6:星系视角的时间轴(1× = 主行星公转周期的 1/8 每秒) */
  const [sysYear, setSysYear] = useState(0);
  /** 步10:选中天体的"一年"是多少地球日(没有星系数据时按 365.25) */
  const sysLocalYearDays = useMemo(() => {
    const pl = sysAstro?.design.planets[sysSelected];
    if (!pl) return 365.25;
    try {
      return Math.max(0.01, orbitYears(pl.a) * 365.25);
    } catch {
      return 365.25;
    }
  }, [sysAstro, sysSelected]);

  /** 单一数据源:天体视图(名字/类型/文明都从这一份读,不再各取一处) */
  const civBodyViews = useMemo(() => {
    if (!sysAstro) return [];
    try {
      const ov = sysEditOvRef.current ?? pRef.current.data?.world.system;
      return buildBodyViews(sysAstro, {
        names: ov?.bodyNames ?? null,
        defaultNames: sysNames ? { planets: sysNames.planets, moons: sysNames.moons } : null,
        bodies: (pRef.current.data as { bodies?: import('../../gen/savefile').SaveBody[] } | null | undefined)?.bodies ?? null,
      });
    } catch {
      return [];
    }
  }, [sysAstro, sysNames, bodyRev]);

/** 地图模式左栏:选择要编辑/查看的天体 */
const mapBodyPicker = sysAstro && civBodyViews.length ? (
  <div className="sb-row" data-act="map-body-picker" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
    <span style={{ opacity: 0.6, fontSize: 12 }}>天体</span>
    <select
      aria-label="选择要编辑的天体"
      value={sysSelected}
      onChange={(e) => { const i = Number(e.target.value); setSysSelected(i); setSysEditFocus({ kind: 'planet', planet: i }); setSystemPage(true); }}
      style={{ flex: 1, fontSize: 12, padding: '2px 4px' }}
    >
      {civBodyViews.filter((v) => v.kind === 'planet').map((v) => (
        <option key={v.id} value={Number(v.id.slice(1))}>{v.name} · {v.typeLabel}</option>
      ))}
    </select>
  </div>
) : null;

  const sysYearsPerSec = sysAstro ? yearsPerSecondOf(orbitYears(sysAstro.design.planets[sysAstro.design.home.index].a)) : 1;
  /** WP7-7B:地球仪看的是哪颗行星(非主行星 = 只读预览;-1 = 主行星) */
  const homeBody = sysAstro?.design.home.index ?? -1;
  const previewBody = sysAstro && sysStage === 'globe' && sysSelected !== homeBody ? sysSelected : -1;

  const [zoomFrom, setZoomFrom] = useState<{ x: number; y: number } | null>(null);
  /** 步6c:当前天体(行星/卫星)的星环,按质量判定;交给球面渲染器画 */
  const ringsForGlobe = useMemo(() => {
    if (!sysAstro) return null;
    const pl = sysAstro.design.planets[sysSelected];
    if (!pl) return null;
    const seed = Math.round(pl.mass * 1000) + sysSelected * 7919;
    return ringsOf({ mass: pl.mass, radius: pl.radius, kind: pl.kind, tilt: pl.tilt }, seed);
  }, [sysAstro, sysSelected]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.rings = ringsForGlobe;
  }, [ringsForGlobe]);

  /** 步9:球面晨昏线的太阳直射经度(按选中行星在时间轴那一刻算;经度交给着色器,球自转不影响晨昏线) */
  const sunLonForGlobe = useMemo<number>(() => {
    if (!sysAstro) return 0;
    try {
      const sky = skyLayerOf(sysAstro.design, sysYear, sysSelected);
      return (sky.subsolarLonDeg * Math.PI) / 180;
    } catch {
      return 0;
    }
  }, [sysAstro, sysYear, sysSelected]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.sunLon = sunLonForGlobe;
  }, [sunLonForGlobe]);
  /** 太阳直射纬度(赤纬):按行星自转倾角 × sin(公转位置角) 近似,供晨昏线用 */
  const sunLatForGlobe = useMemo<number>(() => {
    if (!sysAstro) return 0;
    const pl = sysAstro.design.planets[sysSelected];
    if (!pl) return 0;
    try {
      const sky = skyLayerOf(sysAstro.design, sysYear, sysSelected);
      const theta = ((((sky.sunAzDeg + 180) % 360) + 360) % 360) * (Math.PI / 180);
      return (pl.tilt * Math.sin(theta) * Math.PI) / 180;
    } catch {
      return 0;
    }
  }, [sysAstro, sysYear, sysSelected]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.sunLat = sunLatForGlobe;
  }, [sunLatForGlobe]);
  /** 进地球仪:星系层缩放淡出,700ms 后切 stage */
  /**
   * 进地球仪。带点击坐标时做「镜头推进」:星系视角以点击点为中心放大,推到位再切地球仪(没有从中间淡入)。
   */
  const enterGlobe = (at?: { x: number; y: number; r: number }) => {
    setSystemPage(false);
    if (!at) {
      setSysFade(true);
      window.setTimeout(() => {
        setSysStage('globe');
        setSysFade(false);
      }, STAGE_MS);
      return;
    }
    setSysZoomAt({ x: at.x, y: at.y });
    window.setTimeout(() => {
      setSysStage('globe');
      setSysFade(false);
      setSysZoomAt(null);
    }, ZOOM_MS);
  };
  /** 回星系视角 */
  /** 回星系视角:相机从当前行星拉远(不是直接切画面) */
  const backToSystem = () => {
    setSysStage('system');
    setSysPullFrom(sysSelected);
  };
  // 有星系数据、还没被切过时,先进星系视角
  useEffect(() => {
    if (sysAstro && !image && !locked && !p.base) setSysStage('system');
  }, [sysAstro, image, locked, p.base]);
  /** N8:当前选中行星所在子星系的其他成员(地球仪视角常驻观测层) */
  const skySiblings = useMemo(() => {
    if (!sysAstro || !sysNames) return [];
    const groups = subSystemGroupsOf({
      design: {
        planets: sysAstro.design.planets.map((b) => ({ index: b.index, kind: b.kind, moons: b.moons })),
        home: { index: sysAstro.design.home.index },
        binary: sysAstro.design.binary,
        habitableMoon: sysAstro.design.habitableMoon,
      },
      planetNames: sysNames.planets,
      overrides: sysWorld?.system ?? null,
    });
    const g = groups.find((x) => x.planets.includes(sysSelected));
    if (!g) return [];
    const out: { index: number; name: string; kind: 'planet' | 'moon'; parent?: number }[] = [];
    for (const i of g.planets) if (i !== sysSelected) out.push({ index: i, name: sysNames.planets[i] ?? '行星 ' + (i + 1), kind: 'planet' });
    for (const k of g.moons[sysSelected] ?? []) out.push({ index: k, name: (sysNames.moons[sysSelected] ?? [])[k] ?? '卫星 ' + (k + 1), kind: 'moon', parent: k });
    return out;
  }, [sysAstro, sysNames, sysWorld, sysSelected]);
  /** S3:开了星球系的新建世界,进来默认先给 3D 系统预览(只自动开一次,用户自己关掉后不再抢) */
  const sysAutoOpened = useRef(false);
  useEffect(() => {
    if (sysAutoOpened.current || !sysAstro) return;
    if (image || locked || p.base || tool.on) return;
    sysAutoOpened.current = true;
    // 步9:新建界面不再自动打开左侧「星球系」页(星系视角在中栏)
  }, [sysAstro, image, locked, p.base, tool.on]);
  // WP7-7B/7C:选中非主行星时把它的地表现画成贴图换上去(只读);选回主行星换回来
  useEffect(() => {
    if (studioMode !== 'map') return;
    const sc = sceneRef.current;
    const sh = shown.current;
    if (!sc || !sh || gone.current || out) return;
    if (!sysAstro || previewBody < 0) {
      setBodyLoading(false);
      if (!upload(sc, sh.tag, style)) return;
      void sc.setStyle(`${sh.tag}:${style}`);
      return;
    }
    setBodyLoading(true);
    const timer = window.setTimeout(() => {
      // N12A:覆盖表可能刚被编辑器改过(还没重生成世界),这里按覆盖表当场算一份有效设计
      const ov = sysEditOvRef.current ?? pRef.current.data?.world.system ?? emptyOverrides();
      const po = ov.planets.find((o) => o.index === previewBody);
      // 覆盖表有两套同名类型(astroDesign 的宽松版 / gen/system 的严格版),这里按严格版用
      const effective = applyOverrides(sysAstro.design, ov as unknown as Parameters<typeof applyOverrides>[1]);
      const sysForBody = { ...sysAstro, design: effective };
      const canvas = bodyTexture({
        sys: sysForBody,
        index: previewBody,
        params: pRef.current.params,
        styleKey: styleKeyOfLayer(style),
        ops: po?.terrain as TerrainOp[] | undefined,
        surface: po?.surface,
        gen: po?.gen,
      });
      setBodyLoading(false);
      const cur = sceneRef.current;
      if (!canvas || !cur || gone.current) return;
      const key = `body:${previewBody}:${styleKeyOfLayer(style)}:${sh.tag}`;
      if (!cur.gl.hasStyle(key)) cur.gl.setStyle(key, canvas);
      void cur.setStyle(key, 300);
    }, 30);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewBody, style, sysAstro, out, bodyRev]);
  // R1-2:预览天体的地理标签(最高峰/最大海/两个陆块;名字按该天体的种子取)
  useEffect(() => {
    const cv = previewLabRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || window.innerWidth;
    const h = cv.clientHeight || window.innerHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (previewBody < 0 || !sysAstro) return;
    let gone = false;
    const t = window.setTimeout(() => {
      try {
        const ov = sysEditOvRef.current ?? pRef.current.data?.world.system;
        const po = ov?.planets.find((o) => o.index === previewBody);
        const effective = applyOverrides(sysAstro.design, (ov ?? emptyOverrides()) as unknown as Parameters<typeof applyOverrides>[1]);
        const sysForBody = { ...sysAstro, design: effective };
        const world = planetSurface(sysForBody, previewBody, pRef.current.params, (po?.terrain as TerrainOp[]) ?? [], po?.surface, po?.gen);
        if (gone) return;
        const { mesh, water, elevation } = world;
        // 地标:最高峰、最低海、两个大陆中心(按经度分布挑两块)
        let peak = -1;
        let deep = -1;
        for (let i = 0; i < mesh.n; i++) {
          if (water[i] !== 1 && elevation[i] > (peak < 0 ? -1e9 : elevation[peak])) peak = i;
          if (water[i] === 1 && elevation[i] < (deep < 0 ? 1e9 : elevation[deep])) deep = i;
        }
        const namer = createNamer((pRef.current.params.seed + previewBody * 7919) >>> 0, 'kingdom');
        const pick = (kind: string, key: number) => {
          try {
            return namer.keyed(kind as never, key, previewBody)().zh;
          } catch {
            return null;
          }
        };
        const marks: { cell: number; text: string; big: boolean }[] = [];
        if (peak >= 0) {
          const nm = pick('mountain', peak);
          if (nm) marks.push({ cell: peak, text: nm, big: false });
        }
        if (deep >= 0) {
          const nm = pick('sea', deep);
          if (nm) marks.push({ cell: deep, text: nm, big: true });
        }
        // 两个陆块:按经度分两半各取最高点
        const camLon = sceneRef.current?.lon ?? 0;
        const camTilt = 0.35;
        const project = (cell: number): [number, number] | null => {
          const lon = (mesh.x[cell] / mesh.width) * Math.PI * 2 - Math.PI;
          const lat = Math.PI / 2 - (mesh.y[cell] / mesh.height) * Math.PI;
          const cl = Math.cos(lat), sl = Math.sin(lat);
          let nx = cl * Math.sin(lon + camLon);
          let ny = sl;
          let nz = cl * Math.cos(lon + camLon);
          const ct = Math.cos(camTilt);
          const st = Math.sin(camTilt);
          const ny2 = ny * ct - nz * st;
          const nz2 = ny * st + nz * ct;
          if (nz2 <= 0.02) return null;
          const r = Math.min(w, h) * 0.31;
          return [w / 2 + nx * r, h / 2 - ny2 * r];
        };
        for (const m of marks) {
          const xy = project(m.cell);
          if (!xy) continue;
          ctx.font = `${m.big ? 15 : 13}px system-ui, sans-serif`;
          ctx.fillStyle = m.big ? 'rgba(200,222,255,0.9)' : 'rgba(226,230,240,0.85)';
          ctx.shadowColor = 'rgba(0,0,0,0.65)';
          ctx.shadowBlur = 3;
          ctx.fillText(m.text, xy[0] + 6, xy[1] - 4);
          ctx.shadowBlur = 0;
        }
      } catch {
        /* 生成不出来就不画标签 */
      }
    }, 60);
    return () => {
      gone = true;
      window.clearTimeout(t);
    };
  }, [previewBody, sysAstro]);
  // 步13:按天体推演文明(行星/卫星都行;只推 alive 的天体)
  useEffect(() => {
    if (!civOpen || !sysAstro || !civBodyId) return;
    let gone = false;
    setCivBusy(true);
    const t = window.setTimeout(() => {
      try {
        const ref = listBodies(sysAstro).find((b) => b.id === civBodyId);
        if (!ref || !ref.alive) {
          if (!gone) {
            setCivInfo(null);
            setCivBusy(false);
          }
          return;
        }
        const civ = bodyCivByRef(sysAstro, ref, pRef.current.params);
        if (!gone) {
          setCivInfo(civ ? { id: ref.id, viable: civ.viable, cultures: civ.cultures.length, polities: civ.polities.length, settlements: civ.settlements.length, endYear: Math.round(civ.endYear) } : null);
          setCivBusy(false);
        }
      } catch {
        if (!gone) {
          setCivInfo(null);
          setCivBusy(false);
        }
      }
    }, 30);
    return () => {
      gone = true;
      window.clearTimeout(t);
    };
  }, [civOpen, civBodyId, sysAstro]);
  // R1-1:给预览天体生成样式缩略图(把 bodyTexture 缩到 96×48 存成 dataURL)
  useEffect(() => {
    if (previewBody < 0 || !sysAstro) {
      setBodyThumb(null);
      return;
    }
    let gone = false;
    const t = window.setTimeout(() => {
      try {
        const ov = sysEditOvRef.current ?? pRef.current.data?.world.system;
        const po = ov?.planets.find((o) => o.index === previewBody);
        const effective = applyOverrides(sysAstro.design, (ov ?? emptyOverrides()) as unknown as Parameters<typeof applyOverrides>[1]);
        const cv = bodyTexture({
          sys: { ...sysAstro, design: effective },
          index: previewBody,
          params: pRef.current.params,
          styleKey: 'realistic',
          ops: po?.terrain as TerrainOp[] | undefined,
          surface: po?.surface,
          gen: po?.gen,
        });
        if (!cv || gone) return;
        const small = document.createElement('canvas');
        small.width = 96;
        small.height = 48;
        const c2 = small.getContext('2d');
        if (!c2) return;
        c2.drawImage(cv, 0, 0, 96, 48);
        setBodyThumb(small.toDataURL('image/png'));
      } catch {
        setBodyThumb(null);
      }
    }, 40);
    return () => {
      gone = true;
      window.clearTimeout(t);
    };
  }, [previewBody, sysAstro, bodyRev]);
  // US 式星图:懒加载行星贴图(一次一颗,避免卡住主线程)
  useEffect(() => {
    if (sysStage !== 'system' || !sysAstro || image || locked) return;
    let cancelled = false;
    let timer = 0;
    const ov = sysEditOvRef.current ?? pRef.current.data?.world.system;
    const effective = applyOverrides(sysAstro.design, (ov ?? emptyOverrides()) as unknown as Parameters<typeof applyOverrides>[1]);
    const sysForBody = { ...sysAstro, design: effective };
    const list = effective.planets.map((pl, i) => i);
    const step = (k: number) => {
      if (cancelled || k >= list.length) return;
      const i = list[k];
      if (bodyTexRef.current.has(i)) {
        step(k + 1);
        return;
      }
      try {
        const po = ov?.planets.find((o) => o.index === i);
        const cv = bodyTexture({
          sys: sysForBody,
          index: i,
          params: pRef.current.params,
          styleKey: 'realistic',
          ops: po?.terrain as TerrainOp[] | undefined,
          surface: po?.surface,
          gen: po?.gen,
        });
        if (cv) {
          bodyTexRef.current.set(i, cv);
          setBodyTexVersion((v) => v + 1);
        }
      } catch {
        /* 这颗生成不出来就先留纯色点 */
      }
      timer = window.setTimeout(() => step(k + 1), 24);
    };
    timer = window.setTimeout(() => step(0), 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sysStage, sysAstro, image, locked, bodyRev]);
  const ogShown = originsOn && !mixShown && !rpShown;
  const pageShown = mixShown || ogShown || rpShown;
  const mixPage = mixShown ? (
    <NameMixPage backLabel={heading} onBack={() => setNamesPage(false)} civ={p.raw} busy={p.busy} ready={p.ready} phone={p.phone} flush={mixFlush} />
  ) : rpShown ? (
    <RulesPickHost
      phone={p.phone}
      picked={rulesPickId}
      rules={edits.rules}
      onPick={pickRules}
      onBack={() => setRulesPage(false)}
      onCollapse={p.phone ? undefined : () => setCollapsed(true)}
    />
  ) : (
    ogShown && (
      <OriginsPage
        backLabel={heading}
        onBack={closeOrigins}
        world={p.baseWorld ?? p.data?.world ?? null}
        civ={ogCiv}
        phone={p.phone}
        noMap={glOk === false}
        custom={originCustom}
        onCustom={pickOriginCustom}
        only={originOnly}
        onOnly={pickOriginOnly}
      />
    )
  );
  const doneBtn = (
    <button className="nw-create" data-act="origins-finish" onClick={closeOrigins}>
      完成
    </button>
  );

  // ---- 照手绘图:图片那一行和三步 ----
  const nameNow = name.trim();
  const strokes = terrainCount(edits);
  const done = (n: 1 | 2 | 3) => (n === 1 ? applied : (seen & (1 << n)) !== 0);
  const stepSummary = (n: 1 | 2 | 3): string => {
    if (n === 1) {
      if (step === 1) return imp && !p.phone ? importProgress(imp) : '';
      if (src) return importSummary(src);
      return edits.sketch?.image ? layerSummary(edits.sketch.image.cells) : '';
    }
    if (n === 2) return !applied ? '认好海陆以后' : strokes ? `画了 ${strokes} 笔` : '还没画';
    return step === 3 ? '' : nameNow || paramsBrief(p.params);
  };
  const stepGroup = (n: 1 | 2 | 3, title: string, body: React.ReactNode) => (
    <StepGroup key={n} n={n} title={title} summary={stepSummary(n)} open={step === n} done={done(n)} locked={n > 1 && !applied} onToggle={() => toggleStep(n)}>
      {body}
    </StepGroup>
  );
  const rerollRow = (
    <button className="sb-row" data-act="new-seed" disabled={!!base || !p.ready} onClick={p.onRandomSeed} title="海陆照图不变，山、河、地名换一种长法">
      <Icon name="dice" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>山河、地名换一种</b>
      </span>
      <span className="sb-row-side">海陆不变</span>
    </button>
  );
  const imageSteps = image && (
    <>
      <ImageCard phone={p.phone} />
      {stepGroup(
        1,
        '认出海陆',
        importing ? (
          <ImportPanel phone={p.phone} onUse={growPlanet} wait={!p.ready} />
        ) : (
          <div className="tp imp imp-step">
            <button className="imp-use" data-act="import-repick" onClick={pickImage}>
              选一张图
            </button>
          </div>
        ),
      )}
      {stepGroup(2, '用笔修改', <TerrainPanel disabled={p.busy} phone={p.phone} mode="image" extra={aiOn && askRow} />)}
      {stepGroup(
        3,
        '参数和名字',
        <>
          <StepParams params={p.params} onParams={p.onParams} disabled={p.busy} />
          {rerollRow}
          {rulesRow}
          {originsRow}
          <div className="sk-name">{nameField}</div>
          {sysEditRow}
          {mapBodyPicker}
          {sysRow}
          {mixRow}
        </>,
      )}
      {noCivHint}
      {carriedSec}
    </>
  );

  /** 第 2 步「文明」(打造文明的最上面多一组锁着的「地图」);compact = 手机卡片没拉开时 */
  const civSettings = (compact: boolean) => (
    <>
      {locked && !p.phone && (
        <section className="sb-sec">
          <div className="sb-sec-head">
            <span>地图</span>
            <small className="nw-locked">
              <Icon name="lock" size={13} />
              沿用，不能改
            </small>
          </div>
          <div className="sb-group">{mapRow}</div>
        </section>
      )}
      <section className="sb-sec">
        {!p.phone && (
          <div className="sb-sec-head">
            <span>文明</span>
          </div>
        )}
        <div className="sb-group">
          {p.phone && mapRow}
          {civSeedRow}
          {howRow}
          {outlineNote}
          {found ? (
            <>
              {stepHow ? advRow : lockedRow('years-found', '推演年数', `${endYear} 年`)}
              {lockedRow('frontier-found', '拓荒', '和找的时候一样')}
              {lockedRow('origins-found', '文明起源', '和找的时候一样')}
              {lockedRow('calamity-found', '天灾', '和找的时候一样')}
              {rulesOn && lockedRow('rules-found', '规则', '和找的时候一样')}
            </>
          ) : (
            <>
              {stepHow ? advRow : yearsRow}
              {calamityRow}
              {!compact && rulesRow}
            </>
          )}
          {found ? null : compact ? (
            <button className="sb-row" data-act="civ-more" onClick={() => setSheetFull(true)}>
              <span className="sb-row-main">
                <b>更多设定</b>
              </span>
              <span className="sb-row-side">{rulesOn ? '规则、拓荒、起源、地名' : '拓荒、起源、地名'}</span>
              <Icon name="chevron" size={14} className="sb-chev" />
            </button>
          ) : (
            <>
              {frontierRow}
              {originsRow}
            </>
          )}
        </div>
        {found ? foundNote : !p.phone && civNote}
        {noCivHint}
      </section>
      <section className="sb-sec">
        {!p.phone && (
          <div className="sb-sec-head">
            <span>名字</span>
          </div>
        )}
        {nameField}
        {!compact && <div className="sb-group">{mixRow}</div>}
        {leftNote}
      </section>
    </>
  );
  const settings = tool.on ? (
    <TerrainPanel disabled={p.busy} phone={p.phone} />
  ) : step2 ? (
    civSettings(p.phone && !sheetFull)
  ) : (
    <>
      <section className="sb-sec">
        {!peek && (
          <div className="sb-sec-head">
            <span>星球</span>
          </div>
        )}
        <div className="sb-group">
          {seedRow}
          {!peek && paramsRow}
          {!peek && sysEditRow}
          {!peek && sysRow}
          {finderRow}
        </div>
        {!peek && noCivHint}
      </section>
      {!peek && (
        <section className="sb-sec">
          <div className="sb-sec-head">
            <span>地形</span>
            <small>可选</small>
          </div>
          <div className="sb-group">
            {terrainRow}
            {aiOn && askRow}
          </div>
        </section>
      )}
      {!peek && !twoStep && (
        <section className="sb-sec">
          <div className="sb-sec-head">
            <span>文明</span>
            <small>可选</small>
          </div>
          <div className="sb-group">
            {calamityRow}
            {rulesRow}
            {originsRow}
          </div>
        </section>
      )}
      {!peek && carriedSec}
      {!peek && !twoStep && (
        <section className="sb-sec">
          <div className="sb-sec-head">
            <span>名字</span>
          </div>
          {nameField}
          <div className="sb-group">{mixRow}</div>
        </section>
      )}
    </>
  );

  const grip = (
    <button
      className="st-grip"
      data-act="new-sheet"
      aria-label={sheetFull ? '收起' : '展开'}
      aria-expanded={sheetFull}
      onClick={() => {
        if (sheetFull) {
          setNamesPage(false);
          setRulesPage(false);
          closeOrigins();
        }
        setSheetFull(!sheetFull);
      }}
    >
      <i aria-hidden="true" />
    </button>
  );
  // 属性一直不变的容器(卡片、侧栏、最外层):世界、历史换了就换个记号,免得它记着的旧 props 拉住旧世界(见 holdMark.ts)
  const hold = holdMark(p.data, p.baseWorld, p.civ, p.raw);
  let left: React.ReactNode;
  if (p.phone && image) {
    left = (
      <section ref={sheetRef} className="st-sheet nw-sheet nw-card sk-sheet" data-hold={hold} aria-label={heading} onPointerDown={stop} onClick={stop} onWheel={stop}>
        {grip}
        {!pageShown && (
          <div className="sk-phd">
            {p.back && (
              <button className="sk-bk" data-act="back" aria-label={`返回${p.back.label}`} onClick={p.back.onClick}>
                <Icon name="back" size={20} />
              </button>
            )}
            <div className="nw-title">{heading}</div>
            {moreMenu}
          </div>
        )}
        <div className={`st-in nw-body${pageShown ? ' nm-page' : ' sk-in'}${ogShown ? ' og-page' : ''}`}>{mixPage || imageSteps}</div>
        {!ogShown && <footer className="st-foot">{createBtn}</footer>}
      </section>
    );
  } else if (p.phone) {
    // 第 2 步「文明」:卡片没拉开时也是一整组(文明种子、推演年数、更多设定、名字),不是只露一行
    const civPeek = step2 && !sheetFull;
    left = (
      <section
        ref={sheetRef}
        className={`st-sheet nw-sheet nw-card${peek && !step2 ? ' peek' : ''}${civPeek ? ' civ-peek' : ''}${tool.on ? ' tools' : ''}`}
        data-hold={hold}
        aria-label={heading}
        onPointerDown={stop}
        onClick={stop}
        onWheel={stop}
      >
        {grip}
        <div className={`st-in nw-body${pageShown ? ' nm-page' : ''}${ogShown ? ' og-page' : ''}`}>
          {mixPage || (
            <>
              {!tool.on && backLink}
              {!tool.on && (
                <div className="nw-title-row">
                  <div className="nw-title">{heading}</div>
                  {!step2 && moreMenu}
                </div>
              )}
              {!peek && !tool.on && !civPeek && stepper}
              {(!peek || step2) && !tool.on && <div className="nw-intro">{intro0}</div>}
              {settings}
            </>
          )}
        </div>
        {!tool.on && !ogShown && <footer className="st-foot">{footBtn}</footer>}
      </section>
    );
  } else {
    left = (
      <aside className="st-left nw-card" data-hold={hold} aria-label={heading} onPointerDown={stop} onDoubleClick={stop} onClick={stop}>
        <div className={`st-in nw-body${pageShown ? ' nm-page' : image ? ' sk-in' : ''}${ogShown ? ' og-page' : ''}`}>
          {mixPage || (
            <>
              <div className="st-top">
                {backLink ?? <span />}
                <button className="sb-collapse" data-act="side-collapse" aria-label="收起侧栏" data-tip="收起侧栏" onClick={() => setCollapsed(true)}>
                  <Icon name="sidebar" size={19} />
                </button>
              </div>
              <div className="nw-title-row">
                <div className="nw-title">{heading}</div>
                {moreMenu}
              </div>
              {!tool.on && stepper}
              {(image || !tool.on) && <div className="nw-intro">{intro0}</div>}
              {image ? imageSteps : settings}
            </>
          )}
        </div>
        <footer className="st-foot">{ogShown ? doneBtn : footBtn}</footer>
      </aside>
    );
  }

  // R1-1:主行星用 p.thumbs;预览其他天体时只用该天体的纹理(其他样式置灰,避免"看起来是主行星")
  const isBodyPreview = previewBody >= 0;
  const bodyStyleOnly = STUDIO_STYLES.filter((s) => s.id === 'realistic');
  const thumbFor = (id: MapLayer) => (isBodyPreview ? (id === 'realistic' ? bodyThumb : null) : p.thumbs[id]);
  const styleList = isBodyPreview ? bodyStyleOnly : STUDIO_STYLES;
  const styleRows = styleList.map((s) => (
    <button key={s.id} className="sb-row st-opt" role="radio" aria-checked={style === s.id} data-style={s.id} onClick={() => pickStyle(s.id)}>
      <span className="st-thumb" style={thumbFor(s.id) ? { backgroundImage: `url(${thumbFor(s.id)})` } : undefined} />
      <span className="sb-row-main">
        <b>{s.name}</b>
        <small>{isBodyPreview ? '预览天体的实景贴图(其他样式只适用于主行星)' : s.hint}</small>
      </span>
    </button>
  ));
  // 预览天体时补一行说明:其余样式(地形/生态/气温…)是主行星的地图图层
  const bodyStyleNote = isBodyPreview ? (
    <div style={{ padding: '6px 10px', fontSize: 11.5, opacity: 0.6, lineHeight: 1.5 }}>
      预览「{sysNames?.planets[previewBody] ?? '该天体'}」:样式只显示它自己的实景贴图;地形/生态/气温等图层属于主行星。
    </div>
  ) : null;
  const shownProj = tool.on || glOk === false ? 'equirect' : proj;
  const projRows = PROJS.map((x) => (
    <button
      key={x.id}
      className="sb-row st-opt"
      role="radio"
      aria-checked={shownProj === x.id}
      data-proj={x.id}
      disabled={tool.on || !glOk}
      onClick={() => pickProj(x.id)}
    >
      <span className="st-shape">
        <i style={{ width: x.icon[0], height: x.icon[1], borderRadius: x.icon[2] }} />
      </span>
      <span className="sb-row-main">
        <b>{x.name}</b>
        <small>{x.hint}</small>
      </span>
    </button>
  ));
  const curProj = PROJS.find((x) => x.id === shownProj) ?? PROJS[0];
  // ---- 设为新建时的默认:记下样式、投影、经纬网;点了以后按钮变灰,底下一条提示能撤销 ----
  const newView = useNewView();
  const gratStep = useGraticuleStep();
  const viewNow: NewView = { style, proj, grat, step: gratStep };
  const viewIsDefault = newView ? sameView(newView, viewNow) : style === 'realistic' && proj === 'globe' && !grat;
  const [viewSaved, setViewSaved] = useState<{ prev: NewView | null; text: string } | null>(null);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(viewTimer.current), []);
  const styleName = STUDIO_STYLES.find((x) => x.id === style)?.name ?? '';
  const projName = PROJS.find((x) => x.id === proj)?.name ?? '';
  const gratText = grat ? `经纬网每隔 ${gratStep}°` : '经纬网关着';
  const saveView = () => {
    setDrawer(null);
    setTip(false);
    const prev = newView;
    setNewView(viewNow);
    setViewSaved({ prev, text: `以后新建世界，一进来就是${styleName}、${projName}${grat ? `、${gratText}` : ''}` });
    clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => setViewSaved(null), 8000);
  };
  const undoView = () => {
    clearTimeout(viewTimer.current);
    if (viewSaved) setNewView(viewSaved.prev);
    setViewSaved(null);
  };
  const viewBtn = (
    <button
      className="sb-group st-def"
      data-act="studio-default-view"
      disabled={viewIsDefault || tool.on}
      data-tip={viewIsDefault || tool.on ? undefined : `以后新建世界，一进来就是现在这样：${styleName}、${projName}、${gratText}。打开存档和分享链接不受影响。`}
      data-tip-side={p.phone ? undefined : 'left'}
      data-tip-wide=""
      onClick={saveView}
    >
      {viewIsDefault ? (
        <>
          <Icon name="check" size={14} />
          已是新建时的默认
        </>
      ) : (
        '设为新建时的默认'
      )}
    </button>
  );
  const right = !image && (
    <aside className="st-right" aria-label="样式和投影" onPointerDown={stop} onClick={stop} onWheel={stop}>
      {(!p.phone || drawer === 'style') && (
        <>
          <div className="sb-sec-head">
            <span>样式</span>
          </div>
          <div className="sb-group" role="radiogroup" aria-label="样式">
              {bodyStyleNote}
              {styleRows}
            {styleRows}
          </div>
          {p.phone && viewBtn}
        </>
      )}
      {(!p.phone || drawer === 'proj') && (
        <>
          <div className="sb-sec-head">
            <span>投影</span>
          </div>
          <div className="sb-group" role="radiogroup" aria-label="投影">
            {projRows}
          </div>
          <div className="sb-group st-grat">
            <button className="sb-row" role="switch" aria-checked={grat} data-act="studio-graticule" onClick={() => setGraticule(!grat)}>
              <span className="sb-row-main">经纬网</span>
              <span className={`ai-switch${grat ? ' on' : ''}`} aria-hidden="true" />
            </button>
            <div className="sb-row static st-grat-step">
              <span className="sb-row-main">每隔</span>
              <GraticuleSteps />
            </div>
          </div>
          {viewBtn}
          {tool.on && <p className="st-note">编辑地形时用平面地图，编辑完回到原来的投影</p>}
          {glOk === false && <p className="st-note">这台设备画不了地球仪，先用平面地图</p>}
        </>
      )}
    </aside>
  );

  // 照手绘图:地图上方的切换条、电脑上地图下边的一句提示
  const flatNow = wantFlat || glOk === false;
  const viewBar = image && (
    <ViewBar
      phone={p.phone}
      importing={importing}
      grown={applied}
      flat={flatNow}
      onFlat={(f) => (glOk === false ? undefined : setImageFlat(f))}
      style={style}
      styles={STUDIO_STYLES}
      thumbs={p.thumbs}
      onStyle={pickStyle}
      styleOpen={styOpen}
      onStyleOpen={setStyOpen}
      left={p.phone ? undefined : box.x + box.w / 2}
    />
  );
  let capText: string | null = null;
  if (image && !p.phone && !out) {
    if (importing) capText = importCaption(imp);
    else if (step === 2 && tool.on) capText = terrainHint;
    else if (!flatNow) capText = '拖动转动这颗星球；点「平面」回去接着改';
    else if (sv.show === 'grown' && src) capText = '拖「叠上原图」对照长出来的和你画的';
  }
  const fr = flatRect(box, { phone: p.phone, bar: true });
  const imageCap = capText && (
    <div className="st-cap st-tip sk-cap" style={{ left: box.x + box.w / 2, top: fr.y + fr.h + CAP_GAP, bottom: 'auto' }}>
      {capText}
    </div>
  );

  // 起源页:星球上带号的圆点(停住时才摆;点一下拿掉)、底下的提示、点错的地方一个虚线圈
  let pins: React.ReactNode = null;
  if (ogShown && pinPose && p.data && ogCiv && glOk && edits.origins) {
    const W = p.data.world.width;
    const pm = poseMap(pinPose, W, p.data.world.height);
    pins = (
      <div className="og-pins">
        {originSpots(p.baseWorld ?? p.data.world, ogCiv, edits.origins.pts).map((sp, i) => {
          const [x, y, vis] = pm.fwd(sp.x, sp.y);
          if (vis <= 0.05) return null;
          return (
            <button key={`${sp.x},${sp.y}`} className={`og-pin${sp.ok ? '' : ' off'}`} style={{ left: x, top: y }} data-pin={i + 1} aria-label={`拿掉第 ${i + 1} 处：${sp.name}`} onClick={() => removeOrigin(i)}>
              {i + 1}
              <i>{sp.name}</i>
            </button>
          );
        })}
      </div>
    );
  }
  const ogTip = ogShown && originCustom && glOk && (
    <>
      <div className="st-cap st-tip og-tip" style={p.phone ? undefined : { left: box.x + box.w / 2 }} data-bad={originMsg ? 1 : 0}>
        {originMsg?.text ?? (p.phone ? '点能住人的地方放一处起源' : '点能住人的地方放一处起源，点圆点拿掉')}
      </div>
      {originMsg && <div className="og-bad" style={{ left: originMsg.x, top: originMsg.y }} />}
    </>
  );

  const cls = [
    'studio',
    p.phone ? 'st-phone' : 'st-desk',
    image ? 'st-image' : '',
    collapsed && !p.phone ? 'collapsed' : '',
    flatShown ? 'flat' : '',
    out ? 'out' : '',
    out === 2 ? 'fade' : '',
    drawer ? `drawer-${drawer}` : '',
    sheetFull ? 'sheet-full' : '',
    astShown ? 'ast' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div ref={rootRef} className={cls} data-theme="dark" data-hold={hold} style={p.phone ? ({ '--sheet-h': `${sheetH}px` } as React.CSSProperties) : undefined}>
      <div ref={glowRef} className="st-glow" aria-hidden="true" />
      {sysAstro && !image && !locked && (
        <div data-act="globe-sky-globe" aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: out ? 0 : 1, transition: 'opacity .25s ease' }}>
          <GlobeSky design={sysAstro.design} index={sysSelected} year={sysYear} seed={sysAstro.design.star.mass * 1000 + sysAstro.design.planets.length} />
        </div>
      )}
      {/* 顶层三模式:星系 / 地图 / 文明 */}
      {!image && !locked && (
        <div data-act="studio-mode-switch" style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 70, display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'rgba(16,22,34,0.82)', border: '1px solid rgba(120,150,200,0.28)' }}>
          {([['galaxy', '星系'], ['map', '地图'], ['civ', '文明']] as const).map(([m, label]) => (
            <button
              key={m}
              className="ov-btn"
              data-act={`studio-mode-${m}`}
              onClick={() => { setStudioMode(m); if (m === 'galaxy') { setSysStage('system'); setSysFade(false); } if (m === 'civ') { setCivOpen(true); if (!civBodyId) { const first = sysAstro ? listBodies(sysAstro).find((b) => b.alive) : null; if (first) setCivBodyId(first.id); } } }}
              style={{ padding: '2px 12px', fontSize: 12, ...(studioMode === m ? { background: '#dbe6f7', color: '#0a0f1c', border: 0 } : { color: '#dbe6f7' }) }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <canvas ref={glRef} className="st-gl" aria-label="这颗星球" style={studioMode !== 'map' ? { display: 'none' } : undefined} />
      <canvas ref={labRef} className={`${studioMode !== 'map' ? ' hid-mode ' : ''}st-labels${labOn && !tool.on && !out && glOk && previewBody < 0 ? ' on' : ''}${p.namesIn ? ' names-in' : ''}`} aria-hidden="true" />
      <canvas ref={previewLabRef} className={`st-labels st-preview-labels${previewBody >= 0 && !tool.on && !out && glOk ? ' on' : ''}`} aria-hidden="true" />
      <canvas ref={markRef} className={`${studioMode !== 'map' ? ' hid-mode ' : ''}st-labels st-marks${markOn && astShown && !tool.on && !out && glOk && previewBody < 0 ? ' on' : ''}`} data-marks={markOn && astShown ? marks.length : 0} aria-hidden="true" />
      {pins}
      {(drawer || styOpen) && (
        <div
          className="st-dismiss"
          onPointerDown={() => {
            setDrawer(null);
            setStyOpen(false);
          }}
        />
      )}
      {/* 星系模式左栏:星系树/天体编辑(实时改覆盖表) */}
      {studioMode === 'galaxy' && !p.phone && sysAstro && (
        <aside
          className="st-left galaxy-dark"
          data-act="galaxy-left"
          style={{ position: 'absolute', left: 0, top: 48, bottom: 104, width: 600, zIndex: 55, background: 'rgba(14,19,30,0.94)', border: '1px solid rgba(120,150,200,0.22)', borderLeft: 0, borderRadius: '0 12px 12px 0', overflow: 'auto', padding: 10, color: '#dbe6f7', filter: 'none' }}
        >
          <SystemEditor
            miniGlobe={false}
            params={p.params}
            overrides={sysEditOv}
            focus={sysEditFocus ?? undefined}
            onChange={(o) => {
              setSysEditOv(o);
              sysEditOvRef.current = o;
            }}
            onParams={(patch) => p.onParams({ ...p.params, ...patch })}
            onClose={() => {
              setCurrentSystem(sysEditOv);
              setSysEditFocus(null);
              dropBodyTextures();
              setBodyRev((v) => v + 1);
            }}
          />
        </aside>
      )}
      {studioMode === 'map' ? left : null}
      {!p.phone && (
        <button className="side-open glass st-pill" data-act="side-expand" aria-label={`展开侧栏:${heading}`} onPointerDown={stop} onClick={() => setCollapsed(false)}>
          <Icon name="sidebar" size={19} />
          <span className="side-open-name">{heading}</span>
        </button>
      )}
      {p.phone && !image && (
        <div className="st-ph-btns" onPointerDown={stop} onClick={stop}>
          <button className={`st-ph-btn${drawer === 'style' ? ' on' : ''}`} data-act="studio-style" aria-label="样式" aria-expanded={drawer === 'style'} onClick={() => setDrawer((d) => (d === 'style' ? null : 'style'))}>
            <span className="st-thumb" style={thumbFor(style) ? { backgroundImage: `url(${thumbFor(style)})` } : undefined} />
          </button>
          <button className={`st-ph-btn${drawer === 'proj' ? ' on' : ''}`} data-act="studio-proj" aria-label="投影" aria-expanded={drawer === 'proj'} onClick={() => setDrawer((d) => (d === 'proj' ? null : 'proj'))}>
            <span className="st-shape">
              <i style={{ width: Math.round(curProj.icon[0] * 0.8), height: Math.round(curProj.icon[1] * 0.8), borderRadius: curProj.icon[2] }} />
            </span>
          </button>
          {aiOn && (
            <button
              className={`st-ph-btn${astShown ? ' on' : ''}`}
              data-act="assistant"
              aria-label="让助手改"
              aria-pressed={astShown}
              disabled={!canAsk}
              onClick={() => (astShown ? closeAssistant() : askAssistant())}
            >
              <Icon name="bubble" size={22} />
            </button>
          )}
        </div>
      )}
      {/* 步9:星球系总览页(中栏全屏;左栏不再放预览) */}
      {systemPage && sysWorld && !image && !locked && (
        <div data-act="system-page-full" style={{ position: 'absolute', inset: 0, zIndex: 80, background: '#0a0f1c', color: '#dbe6f7', overflow: 'auto' }}>
          <SystemPage backLabel={heading} onBack={() => setSystemPage(false)} world={sysWorld} civ={ogRaw} phone={p.phone} />
        </div>
      )}
      {/* WP7:星系视角(单 stage;700ms 推进/返回) */}
      {sysAstro && sysNames && !image && !locked && !p.base && (studioMode !== 'map' || sysStage === 'system' || sysGhost) && out === 0 && (
        <div
          data-act="stage-system"
          style={{
            position: 'absolute',
            left: p.phone || studioMode !== 'map' ? 0 : (collapsed ? 0 : LEFT_W),
            right: p.phone || studioMode !== 'map' ? 0 : (image ? 0 : RIGHT_W),
            top: 0,
            bottom: 0,
            zIndex: 32,
            background: '#0a0f1c',
            color: '#dbe6f7',
            display: 'flex',
            flexDirection: 'column',
            transformOrigin: sysZoomAt ? `${sysZoomAt.x}px ${sysZoomAt.y}px` : undefined,
            transform: sysFade ? 'scale(1.35)' : 'scale(1)',
            opacity: sysFade || sysGhost ? 0 : 1,
            transition: 'transform ' + (sysZoomAt ? ZOOM_MS : STAGE_MS) + 'ms cubic-bezier(.3,.7,.4,1), opacity ' + STAGE_MS + 'ms ease',
            pointerEvents: sysFade || sysGhost ? 'none' : 'auto',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: p.phone ? '8px 10px' : '10px 14px', flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}>星系视角</b>
            <span style={{ fontSize: 11.5, opacity: 0.6 }}>点一颗行星选中 · 双击进入地球仪 · 拖拽旋转 / 滚轮缩放</span>
            <button className="ov-btn" data-act="stage-enter-globe" onClick={() => enterGlobe()} style={{ marginLeft: 'auto', color: '#0a0f1c', background: '#dbe6f7', border: 0 }}>
              进入地球仪 ▸
            </button>
            <button className="ov-btn" data-act="stage-civ-bodies" onClick={() => { setCivOpen(true); if (!civBodyId && sysAstro) { const first = listBodies(sysAstro).find((b) => b.alive); if (first) setCivBodyId(first.id); } }} style={{ color: '#0a0f1c', background: '#cfe0ff', border: 0 }}>
              天体文明…
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: p.phone ? '0 6px' : '0 10px', overflow: 'auto' }}>
            <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 260 }}>
              {/* 步9:天球背景(附近恒星 + 同子星系的其他星体),球是透明的,星空在后面 */}
              <GlobeSky
                design={sysAstro.design}
                index={sysSelected}
                year={sysYear}
                seed={sysAstro.design.star.mass * 1000 + sysAstro.design.planets.length}
              />
              {zoomFrom && (
                <>
                <style>{`@keyframes globeZoom { 0% { transform: scale(.25); opacity: 1 } 100% { transform: scale(26); opacity: 0 } }`}</style>
                <div
                  data-act="globe-zoom"
                  style={{
                    position: 'absolute',
                    left: zoomFrom.x,
                    top: zoomFrom.y,
                    width: 36,
                    height: 36,
                    marginLeft: -18,
                    marginTop: -18,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(190,220,255,0.95), rgba(120,170,255,0.25) 60%, rgba(0,0,0,0) 70%)',
                    animation: 'globeZoom 600ms cubic-bezier(.3,.7,.4,1) forwards',
                    pointerEvents: 'none',
                    zIndex: 5,
                  }}
                />
                </>
              )}
            <SystemGlobe
              design={sysAstro.design}
              names={sysNames.planets}
              belts={sysBelts}
              selected={sysSelected}
              onSelect={setSysSelected}
              onOpen={(i) => {
                setSysSelected(i);
                setSysFocus(i);
              }}
              focusIndex={sysFocus}
              onFocusDone={() => {
                // 星系模式:相机到位后留在同一个 3D 场景里(近处的球就是地表);不切地球仪
                setSysFocus(null);
              }}
              startFocusIndex={sysPullFrom}
              bodyTex={bodyTexRef.current}
              onPullDone={() => {
                setSysPullFrom(null);
              }}
              year={sysYear}
              height="fill"
            />
            </div>
          </div>
          {civOpen && sysAstro && (
            <div data-act="civ-bodies-panel" style={studioMode === 'civ' ? { position: 'absolute', left: 16, right: 16, top: 56, bottom: 16, maxHeight: 'none', overflow: 'auto', zIndex: 40, background: 'rgba(12,18,30,0.96)', color: '#dbe6f7', border: '1px solid rgba(120,150,200,0.35)', borderRadius: 10, padding: 16, fontSize: 13, lineHeight: 1.6 } : { position: 'absolute', right: p.phone ? 8 : 16, top: p.phone ? 54 : 60, width: 300, maxHeight: '70%', overflow: 'auto', zIndex: 40, background: 'rgba(12,18,30,0.96)', color: '#dbe6f7', border: '1px solid rgba(120,150,200,0.35)', borderRadius: 10, padding: 10, fontSize: 12.5, lineHeight: 1.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <b style={{ fontSize: 13 }}>天体文明</b>
              <span style={{ opacity: 0.55, fontSize: 11 }}>选一个天体推演它的文明(只读预览)</span>
              <button className="ov-btn" style={{ marginLeft: 'auto', padding: '0 6px' }} onClick={() => setCivOpen(false)}>关闭</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {civBodyViews.map((b) => (
                <button
                  key={b.id}
                  className="ov-btn"
                  data-act={`civ-body-${b.id}`}
                  disabled={!b.alive}
                  title={b.alive ? '可住人:能推演文明' : '不适合居住:不推演文明'}
                  onClick={() => setCivBodyId(b.id)}
                  style={{ padding: '1px 7px', fontSize: 11.5, ...(civBodyId === b.id ? { borderColor: '#f0dc8c', color: '#f0dc8c' } : b.alive ? {} : { opacity: 0.4 }) }}
                >
                  {b.name}{b.kind === 'moon' ? '(卫)' : ''}
                </button>
              ))}
            </div>
            {civBusy && <div style={{ opacity: 0.7 }}>推演中…</div>}
            {civBodyId && (() => { const v = civBodyViews.find((x) => x.id === civBodyId); return v ? (<div style={{ marginBottom: 6, opacity: 0.85 }}>当前:{v.name} · {v.typeLabel} · {v.kind === 'moon' ? '卫星' : '行星'}</div>) : null; })()}
            {!civBusy && !civInfo && civBodyId && <div style={{ opacity: 0.7 }}>这个天体推不出文明(可居地太少或不能住人)。</div>}
            {!civBusy && civInfo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div>到第 <b>{civInfo.endYear}</b> 年:{civInfo.viable ? '文明存在' : '无成型文明(可居地太少)'}</div>
                <div>民族 {civInfo.cultures} · 国家 {civInfo.polities} · 城镇 {civInfo.settlements}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                  <button
                    className="ov-btn"
                    data-act="civ-body-save"
                    style={{ padding: '0 8px', fontSize: 11.5 }}
                    onClick={() => { setCivStore((cur) => { const next = cur.filter((x) => x.id !== civInfo.id); next.push({ id: civInfo.id, civs: [{ id: civInfo.id, endYear: civInfo.endYear }] }); return next; }); }}
                  >
                    记进"每天体文明"(下一步写存档)
                  </button>
                </div>
                {civStore.length > 0 && <div style={{ opacity: 0.6, marginTop: 4 }}>已记 {civStore.length} 个天体:{civStore.map((x) => x.id).join('、')}</div>}
              </div>
            )}
            </div>
          )}
          <div style={{ padding: p.phone ? '2px 8px' : '2px 12px' }}>
            <SystemTimeline endYear={SYS_END_YEAR} year={sysYear} onYear={setSysYear} yearsPerSec={sysYearsPerSec} localYearDays={sysLocalYearDays} />
          </div>
          <div style={{ display: 'flex', gap: 6, padding: p.phone ? '6px 10px' : '8px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, opacity: 0.6 }}>行星</span>
            {sysAstro.design.planets.map((pl, i) => (
              <button
                key={i}
                data-act={'stage-pick-' + i}
                className="ov-btn"
                onClick={() => setSysSelected(i)}
                onDoubleClick={(e) => { setSysSelected(i); enterGlobe({ x: e.clientX, y: e.clientY, r: 18 }); }}
                style={{ padding: '1px 7px', fontSize: 11.5, ...(sysSelected === i ? { borderColor: '#f0dc8c', color: '#f0dc8c' } : { color: '#dbe6f7', borderColor: 'rgba(120,150,200,0.35)', background: 'rgba(14,22,38,0.7)' }) }}
              >
                {sysNames.planets[i] ?? '行星 ' + (i + 1)}
                {i === sysAstro.design.home.index ? '★' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* 7B/7C:非主行星 = 只读预览;现画地表时显示加载态,并给「回到主行星」 */}
      {previewBody >= 0 && sysNames && (
        <div
          data-act="body-preview-badge"
          style={{ position: 'absolute', left: p.phone ? 12 : (collapsed ? 12 : LEFT_W + 12), top: p.phone ? 46 : 12, zIndex: 31, padding: '4px 10px', fontSize: 11.5, borderRadius: 7, border: '1px solid rgba(201,161,90,0.5)', background: 'rgba(40,32,14,0.78)', color: '#f0dc8c', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: p.phone ? 'calc(100% - 24px)' : 560 }}
        >
          <span>
            {bodyLoading
              ? '正在生成这颗行星的地表…'
              : '预览：' + (sysNames.planets[previewBody] ?? '行星 ' + (previewBody + 1)) + '（只读；左侧设定仍作用在主行星）'}
          </span>
          <button
            className="ov-btn"
            data-act="body-preview-edit"
            onClick={() => {
              const ov = currentSystem() ?? EMPTY_OVERRIDES;
              setSysEditOv(ov);
              sysEditOvRef.current = ov;
              setSysEditFocus({ kind: 'planet', planet: previewBody });
              setSysEditOpen(true);
            }}
            style={{ padding: '0 6px', fontSize: 11, color: '#f0dc8c', borderColor: 'rgba(240,220,140,0.45)' }}
          >
            编辑这颗行星…
          </button>
          <button
            className="ov-btn"
            data-act="body-preview-home"
            onClick={() => setSysSelected(homeBody)}
            style={{ padding: '0 6px', fontSize: 11, background: 'rgba(240,220,140,0.18)', border: '1px solid rgba(240,220,140,0.45)', color: '#f0dc8c' }}
          >
            回到主行星
          </button>
        </div>
      )}
      {/* 地球仪视角:回到星系视角 */}
      {sysAstro && !image && !locked && !p.base && sysStage === 'globe' && out === 0 && (
        <button
          data-act="stage-back-system"
          onClick={backToSystem}
          style={{ position: 'absolute', left: p.phone ? 12 : (collapsed ? 12 : LEFT_W + 12), top: 12, zIndex: 31, padding: '4px 10px', fontSize: 11.5, borderRadius: 7, border: '1px solid rgba(120,150,200,0.35)', background: 'rgba(14,22,38,0.72)', color: '#dbe6f7', cursor: 'pointer' }}
        >
          ← 回到星系视角
        </button>
      )}
      {sysEditDlg}
      {studioMode === 'map' ? right : null}
      {viewBar}
      {astShown && <AssistantPanel phone={p.phone} world={p.data!.world} raster={p.data!.raster} civ={p.civ!} raw={p.raw!} lock="history" busy={p.worldBusy} />}
      {seenOpen && (
        <SeenList
          at={seenOpen}
          phone={p.phone}
          bottom={p.phone ? sheetH : 0}
          list={planets}
          now={worldKey(p.params)}
          onClose={() => setSeenOpen(null)}
          onPick={(q) => {
            setSeenOpen(null);
            setTip(false);
            if (q.seed !== p.params.seed) p.onSeed(q.seed, q);
            else p.onParams(q);
          }}
        />
      )}
      {viewSaved && !out && (
        <div className="st-cap st-tip st-def-tip" style={!p.phone ? { left: box.x + box.w / 2 } : undefined} data-act="default-view-tip">
          {viewSaved.text}
          <button data-act="default-view-undo" onClick={undoView}>
            撤销
          </button>
        </div>
      )}
      {!image && (
        <div ref={tipRef} className={`st-cap st-tip${tip && !viewSaved && !tool.on && !out && !(p.phone && (drawer || sheetFull)) ? '' : ' off'}`}>
          {locked
            ? srcName
              ? `这是「${srcName}」一开始的地图；拖动看看，在${p.phone ? '下面' : '左边'}定文明怎么推演`
              : `这是这张地图；拖动看看，在${p.phone ? '下面' : '左边'}定文明怎么推演`
            : step2
              ? p.phone
                ? '地图定下了；在下面定文明怎么推演'
                : '地图定下了；在左边定文明怎么推演'
              : edits.sketch
                ? '拖动看看这颗星球；「换一颗」会照同一张草图长出新的山河'
                : '拖动看看这颗星球；不满意就点「换一颗」'}
        </div>
      )}
      {imageCap}
      {ogTip}
      {tool.on && (!image || (p.phone && !importing)) && <TerrainCaption phone={p.phone} />}
      {confirm && (
        <div className="st-scrim" onPointerDown={stop} onClick={() => setConfirm(false)}>
          <div className="st-dlg" role="alertdialog" aria-modal="true" aria-labelledby="st-dlg-title" onClick={stop}>
            <div className="st-dlg-ico">
              <Icon name="lock" size={22} />
            </div>
            <h2 id="st-dlg-title">
              {step2 ? (nameNow ? `开始${verb}「${nameNow}」？` : `开始${verb}这个文明？`) : nameNow ? `创建「${nameNow}」？` : '创建这个世界？'}
            </h2>
            <p>
              {step2 ? `开始${verb}以后` : '创建以后，这颗星球的样子就定下来了'}，下面{LOCK_COUNT[4 + (step2 ? 1 : 0) + (yearsLocked ? 1 : 0) + (frontier ? 1 : 0) + (calamity ? 1 : 0) + (edits.rules ? 1 : 0) + (originN ? 1 : 0)]}样不能再改：
            </p>
            <div className="sb-group">
              {image ? (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>图片</b>
                  </span>
                  <span className="sb-row-side" data-confirm="image">
                    {edits.sketch?.image?.name}
                  </span>
                </div>
              ) : (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>种子</b>
                  </span>
                  <span className="sb-row-side" data-confirm="seed">
                    {p.params.seed}
                  </span>
                </div>
              )}
              <div className="sb-row static">
                <Icon name="lock" size={16} className="sb-ico" />
                <span className="sb-row-main">
                  <b>世界参数</b>
                </span>
                <span className="sb-row-side">{paramsSide(p.params)}</span>
              </div>
              {step2 && (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>文明种子</b>
                  </span>
                  <span className="sb-row-side" data-confirm="civ-seed">
                    {civSeedNow}
                  </span>
                </div>
              )}
              {yearsLocked && (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>推演年数</b>
                  </span>
                  <span className="sb-row-side" data-confirm="end-year">
                    {endYear} 年
                  </span>
                </div>
              )}
              {frontier && (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>拓荒</b>
                  </span>
                  <span className="sb-row-side" data-confirm="frontier">
                    {frontierBrief(frontier)}
                  </span>
                </div>
              )}
              {calamity && (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>天灾</b>
                  </span>
                  <span className="sb-row-side" data-confirm="calamity">
                    {CALAMITY_NAMES[calamity]}
                  </span>
                </div>
              )}
              {edits.rules && (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>规则</b>
                  </span>
                  <span className="sb-row-side sb-origin" data-confirm="rules">
                    {ruleSetLabel(edits.rules)}
                  </span>
                </div>
              )}
              <div className="sb-row static">
                <Icon name="lock" size={16} className="sb-ico" />
                <span className="sb-row-main">
                  <b>地形</b>
                </span>
                <span className="sb-row-side" data-confirm="terrain">
                  {terrainSide(edits, '没改过')}
                </span>
              </div>
              {originN > 0 && (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>文明起源</b>
                  </span>
                  <span className="sb-row-side" data-confirm="origins">
                    自己选了 {originN} 处
                  </span>
                </div>
              )}
              <div className="sb-row static">
                <Icon name="lock" size={16} className="sb-ico" />
                <span className="sb-row-main">
                  <b>地名风格</b>
                </span>
                <span className="sb-row-side" data-confirm="name-mix">
                  {mixSummary(edits.nameMix)}
                </span>
              </div>
            </div>
            <p className="st-dlg-note">世界名、历史和一个个国名地名，{step2 ? verb : '创建'}以后随时能改。</p>
            <div className="st-dlg-btns">
              <button className="st-b2" data-act="confirm-back" onClick={() => setConfirm(false)}>
                再改改
              </button>
              <button className="st-b1" data-act="confirm-create" autoFocus onClick={() => void doCreate()}>
                {step2 ? `开始${verb}` : '确认创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 「看过的星球」:种子右边那个小按钮点开的列表(最新的在上面,现在这颗写"现在");点一颗回到它,连当时的参数 */
function SeenList({
  at,
  phone,
  bottom,
  list,
  now,
  onClose,
  onPick,
}: {
  at: { x: number; y: number };
  phone: boolean;
  /** 手机:底部卡片多高(列表摆在它上面) */
  bottom: number;
  list: Seen[];
  /** 现在这颗的键 */
  now: string;
  onClose: () => void;
  onPick: (q: WorldParams) => void;
}) {
  const [t] = useState(() => Date.now());
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', f, true);
    return () => window.removeEventListener('keydown', f, true);
  }, [onClose]);
  const pos: React.CSSProperties = phone ? { left: 12, right: 12, bottom: bottom + 12 } : { left: at.x + 20, top: Math.max(12, at.y - 22) };
  return (
    <>
      <div className="st-dismiss" onPointerDown={onClose} />
      <div className="st-seen" role="dialog" aria-label="看过的星球" style={pos} onPointerDown={stop} onClick={stop} onWheel={stop}>
        <div className="st-seen-hd">
          <span>看过的星球</span>
          <small>这次新建里</small>
        </div>
        <div className="st-seen-list">
          {list.map((x) => {
            const cur = x.key === now;
            return (
              <button
                key={x.key}
                className={`st-seen-it${cur ? ' on' : ''}`}
                data-seed={x.params.seed}
                aria-current={cur || undefined}
                onClick={() => (cur ? onClose() : onPick(x.params))}
              >
                <span className="st-seen-pic" style={x.thumb ? { backgroundImage: `url(${x.thumb})` } : undefined} />
                <span className="st-seen-tx">
                  <b>种子 {x.params.seed}</b>
                  <small>{seenBrief(x.params)}</small>
                </span>
                <span className="st-seen-t">{cur ? '现在' : agoText(x.at, t)}</span>
              </button>
            );
          })}
        </div>
        <p className="st-seen-ft">点一颗回到它（连当时的参数）</p>
      </div>
    </>
  );
}
