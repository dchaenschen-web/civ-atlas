/**
 * 网址里记着的东西(App 用):
 *   readUrl       打开网页时读一次网址:世界参数、底图和填色、分享链接、作品墙、投影和经纬网、生成器版本、推演年数
 *   writeViewUrl  换了底图 / 填色 / 卫星画法写进网址
 *   visitTarget   网址里带种子的世界(直接看,先不存)
 *   firstRoute    打开网页时去哪
 * 按后退 / 前进换画面、存下以后改写网址见 ./useRouteNav.ts
 */
import { DEFAULT_PARAMS, type WorldParams } from '../../gen/world';
import { EMPTY_EDITS, cleanEndYear } from '../../gen/edits';
import { GEN_KEY, PARAM_RANGE, decodeMomentHash, isContourKind, isMomentHash, isShareHash } from '../../gen/savefile';
import type { BaseParamKey } from '../../gen/params';
import { LAYERS, type LayerId } from '../../render/layers';
import { wrapLon } from '../../render/projection';
import type { SurfaceLook } from '../../render/surface';
import { galleryOfUrl } from '../../account/gallery';
import { baseLook, mapViewFromUrl, writeMapView, type BaseId, type FillId, type SatLook, type Style } from '../mapLayers';
import { showMapInWorlds } from '../MyWorlds';
import { isNavState, navUrl } from '../nav';
import { isPresetHash } from '../presetLink';
import { GLOBE_READY, isGraticuleStep, isMapProjection, type MapProjection } from '../projection';
import { isWorldId, legacyWorld, loadWorld, newWorldId } from '../saveStore';
import { draftTarget, storedTarget, yearsEdits, type FirstRoute, type Target } from './worldTarget';

export function readUrl() {
  const q = new URLSearchParams(location.search);
  const params: WorldParams = { ...DEFAULT_PARAMS };
  for (const k of Object.keys(DEFAULT_PARAMS) as BaseParamKey[]) {
    const v = q.get(k);
    // 和读存档一样:超出合理范围的调回范围内(手改的网址里可能是 0 或特别大的数)
    const n = v === null || v.trim() === '' ? NaN : Number(v);
    if (Number.isFinite(n)) params[k] = Math.min(PARAM_RANGE[k][1], Math.max(PARAM_RANGE[k][0], n));
  }
  // 底图 / 填色:新链接是 map=、fill=、sat=;旧链接的 style=、layer=、civ= 照旧认(实景 = 经典卫星;见 mapLayers.ts)
  const qs = q.get('style');
  const ql = q.get('layer');
  const mapView = mapViewFromUrl(q);
  let style: Style = qs === 'realistic' || qs === 'data' ? qs : 'fantasy';
  let layer: LayerId = LAYERS.some((l) => l.id === ql) ? (ql as LayerId) : 'biomes';
  // 卫星画法:网址里有就照它;旧链接的写实按经典;都没有 = 细节(新的默认)
  const sat: SatLook = mapView?.sat ?? (qs === 'realistic' ? 'classic' : 'detail');
  let surface: SurfaceLook = sat;
  if (mapView) {
    const b = baseLook(mapView.base, sat);
    style = b.style;
    if (b.data) layer = b.data;
    if (b.look) surface = b.look;
  }
  // 分享链接:# 后面是整份存档(gen/savefile.ts 的 encodeShare)
  const share = isShareHash(location.hash) ? location.hash : null;
  // 分享短链接(网站/s/<码> 转过来的 ?s=<码>):存档在服务器上,打开时去取;# 后面可以带着"打开时看哪"(#at=…,不经服务器)
  const shortShare = q.get('s');
  const moment = shortShare !== null && isMomentHash(location.hash) ? decodeMomentHash(location.hash) : null;
  // 朋友的预设链接(#preset=…,ui/presetLink.ts):打开就是填好参数的新建弹窗
  const preset = isPresetHash(location.hash) ? location.hash : null;
  // 作品墙(Gallery.tsx):作品墙那一页 / 打开一个作品
  const gallery = galleryOfUrl(q, location.hash);
  // 投影、中央经线(改了就写进网址,刷新、复制网址都还在)
  // 地球仪以前写的是 view=globe,照样认
  const pq = q.get('proj') ?? (q.get('view') === 'globe' ? 'globe' : null);
  const proj: MapProjection = isMapProjection(pq) && (pq !== 'globe' || GLOBE_READY) ? pq : 'equirect';
  const lq = Number(q.get('lon'));
  const lon = q.get('lon') !== null && Number.isFinite(lq) ? wrapLon(lq) : null;
  // 经纬网:grat=1 = 每 30°(旧网址就是这样),grat=10 / 15 / 30 = 每隔几度;没有 = 关
  const gq0 = q.get('grat');
  const grat: number = gq0 === '1' ? 30 : isGraticuleStep(Number(gq0)) ? Number(gq0) : 0;
  // 等值线:iso=elev / temp / precip;没有 = 不画
  const iq = q.get('iso');
  const iso = isContourKind(iq) ? iq : null;
  // 生成器版本(gen=):这个网址是哪一版画出来的世界;和现在的不同,打开时说清变了什么。旧网址没有 = 不知道,不提示;
  // 带了却认不出(不是整数之类)当成第 0 版:认不出的旧版本,照样提示,也不当成没带 gen 的老网址
  const gq = q.get(GEN_KEY);
  const gen = gq === null ? null : /^\d{1,6}$/.test(gq) ? Number(gq) : 0;
  // 推演年数(years=):新建中、还没存下的世界(new=)刷新、后退回来还记得弹窗里开的年数
  const yq = q.get('years');
  const years = yq === null ? undefined : cleanEndYear(Number(yq));
  return { params, style, layer, surface, sat, mapView, share, shortShare, moment, preset, gallery, proj, lon, grat, iso, gen, years };
}

/** 打开网页时从网址读出来的(readUrl) */
export type PageUrl = ReturnType<typeof readUrl>;

/**
 * 换了底图 / 填色 / 卫星画法:写进网址(map=、fill=、sat=;去掉旧的 style=、layer=,civ= 里的国家 / 民族 / 信仰开关交给填色管),
 * 刷新、复制网址都还在
 */
export function writeViewUrl(v: { base: BaseId; fill: FillId; sat: SatLook }) {
  const next = `?${writeMapView(new URLSearchParams(location.search), v)}`;
  if (next !== location.search) navUrl(next);
}

/** 网址里带种子的(别人发的网址、截图脚本):直接看这个世界,先不存,改了才存 */
export function visitTarget(params: WorldParams, gen: number | null = null): Target {
  const t: Target = { id: newWorldId(), kind: 'visit', params, edits: EMPTY_EDITS };
  return gen === null ? t : { ...t, from: 'url', gen };
}

/**
 * 打开网页时去哪(只算一次):
 *   分享短链接(s=)    → 先是一页空白,去服务器取存档;取到了打开那个世界,停了显示"这个分享已经停止了"
 *   作品墙(gallery=)  → 作品墙那一页;带作品编号的先是一页空白,取到了打开那个作品,撤下了显示"这个作品已经撤下了"
 *   分享链接(#)       → 那个世界(先按网址生成,解开以后套上修改)
 *   w=世界编号(存着)   → 这个世界(没建完的回到新建);
 *                        这一步记的就是这个世界(刷新、按后退 / 前进从别的网址回来),现在不在了(在别的页面里删掉了)
 *                        → 我的世界,提示删掉了(gone = 世界名;网址里有 w= 就是存过)
 *   new=1             → 新建(网址里的种子、参数)
 *   new=image         → 我的世界 + 新建弹窗停在照手绘图选图那一步(照图新建还没长出星球时刷新)
 *   带种子的网址       → 直接看这个世界(改版前存过的就回到那个存档)
 *   都没有             → 我的世界(第一次来是空的那一页:一颗地球、一句话、「新建世界」;点了才生成星球);
 *                        # 后面是朋友的预设链接(#preset=)时,上面开着新建弹窗第 2 步、参数照链接填好(presetDialog)
 */
export function firstRoute(init: PageUrl): FirstRoute {
  const q = new URLSearchParams(location.search);
  if (init.shortShare !== null && !init.share) return { stage: 'home', target: null };
  // 作品墙那一页、作品的网址(世界作品只是看看、还没存下时刷新,网址里也是它):先停在我的世界的位置,去服务器取
  if (init.gallery !== null && !init.share) return { stage: 'home', target: null };
  if (init.share) return { stage: 'world', target: visitTarget(init.params) };
  const w = q.get('w');
  const stored = isWorldId(w) ? loadWorld(w) : null;
  // 只存了地图的:不当世界打开,回到我的世界的「地图」页签、选中它
  if (stored?.map) {
    showMapInWorlds(stored.id);
    return { stage: 'home', target: null };
  }
  if (stored) return { stage: stored.draft ? 'draft' : 'world', target: storedTarget(stored, 'restore') };
  const was: unknown = history.state;
  if (isWorldId(w) && isNavState(was) && was.page !== 'home' && was.id === w) return { stage: 'home', target: null, gone: was.title ?? '' };
  // 这一步记的世界存着,网址是存下之前的那一版(开着卡片时改了第一笔才存下,退回来的这一步网址里还没有 w=):打开存着的
  const mine = !isWorldId(w) && isNavState(was) && was.page === 'world' && was.id ? loadWorld(was.id) : null;
  if (mine && !mine.draft) return { stage: 'world', target: storedTarget(mine, 'restore') };
  if (q.get('new') === '1') return { stage: 'draft', target: draftTarget(init.params, null, yearsEdits(init.years)) };
  // 照手绘图新建、还没照图长出星球(图不存,刷新就没了):回到我的世界,弹窗停在照手绘图的第 2 步(参数照网址)重新选图
  if (q.get('new') === 'image') return { stage: 'home', target: null, dialog: { mode: 'image', params: init.params, step: 2, endYear: init.years } };
  if (q.has('seed')) {
    // 改版前自动存的世界:那时的网址只带种子、参数,刷新照旧回到它(带 gen= 的是改版后的网址,不是它)
    const old = init.gen === null ? legacyWorld(init.params) : null;
    if (old) return { stage: old.draft ? 'draft' : 'world', target: storedTarget(old, 'restore') };
    return { stage: 'world', target: visitTarget(init.params, init.gen) };
  }
  return { stage: 'home', target: null };
}
