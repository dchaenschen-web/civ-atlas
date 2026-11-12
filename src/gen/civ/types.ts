/**
 * 文明数据结构(文明生成的各个模块共用)。
 *
 * 规则:
 * - 文明数据单独放在 Civ 里,World 一个字段都不加。
 * - 加新功能时只在**相应接口的末尾**追加可选字段,不改已有字段。
 * - 所有数组都是类型化数组或普通对象,能在 worker → 主线程之间传(类型化数组走 transfer)。
 */
import type { World, Progress } from '../world';
import type { Intervention } from '../edits';
import type { KnobPatch, KnobValue } from './engine/knobs';

/** 文明纪年:0 = 第一批定居者;界面显示方式另定 */
export type Year = number;

/** 地块级:宜居度(habitat.ts) */
export interface Habitat {
  /** 宜居分 0..~40(0 = 不可居;水面为 0) */
  suitability: Float32Array;
  /** 人口上限(相对值,已按地块面积修正:默认精细度下一块普通大小的地块 = 宜居分本身) */
  capacity: Float32Array;
  /** 陆地(含湖):离海岸几块(1 = 海岸块);海:-1 近岸,-2 更远……(饱和在 ±127) */
  coastDist: Int8Array;
  /** 海岸陆地块相邻的海块数;1 = 天然良港(海湾)。其余地块为 0 */
  harbor: Uint8Array;
}

/**
 * 地区级:地块按地形聚成的"州"(regions.ts),生成后不再变。
 * CSR 写法和 Mesh.adjStart/adj 相同:地区 r 的地块是 cells[cellStart[r] .. cellStart[r+1])。
 */
export interface Regions {
  count: number;
  /** 地块 → 地区;水(海、湖)= -1 */
  of: Int32Array;
  /** 地区 → 治所地块(区内最宜居的一块,天然城址) */
  seat: Int32Array;
  cellStart: Int32Array;
  cells: Int32Array;
  /** 地区邻接(CSR),含陆上相邻、海峡、航线;邻居按编号升序 */
  adjStart: Int32Array;
  adj: Int32Array;
  /** 每条邻接边的类型,取值见 AdjKind */
  adjKind: Uint8Array;
  /** 两个治所之间的路程(世界单位,沿地块邻接累加;海上连接含海路) */
  adjLen: Float32Array;
  /** 面积(世界单位²) */
  area: Float32Array;
  /** 区内人口上限之和 */
  capacity: Float32Array;
  /** 主导群落(Biome 枚举) */
  biome: Uint8Array;
  /** 平均海拔(米) */
  elevation: Float32Array;
  /** 所在陆块 / 岛的编号(0 起,按陆块面积从大到小编号) */
  landmass: Int32Array;
  /** 每条邻接边的共享边界长度(世界单位,约等于相邻地块对数 × 地块间距);海上连接为 0 */
  adjBorder: Float32Array;
  /**
   * 海峡、航线(每条邻接边一个):这一侧从哪块海岸地块出海(陆上相邻 = −1)。
   * 航线只在各州的出海口(区内挨着能通航的海、离治所最近的陆地块)之间连;推演里走过的海峡、航线照这两头画出来(routes.ts 的 usedLanes)
   */
  adjCoast: Int32Array;
  /** 州名(按占据它的民族的语感起名;没人住的州为空串,界面上显示"第 N 州") */
  name?: string[];
  /**
   * 地形大事以后(regions.ts 的 reshapeRegions)才有:稳定键(gen/edits.ts 文件头"稳定键")按它定位,大事前后指同一个州。
   * keyOf:地块 → 州,这块地最早属于的那一州(后来沉进海里的也算);keySeat:州 → 治所地块,这州最早时的治所。
   * 没有 = 和 of、seat 一样
   */
  keyOf?: Int32Array;
  keySeat?: Int32Array;
}

/** 地区邻接边的类型 */
export const enum AdjKind {
  Flat = 0,
  River = 1,
  Mountain = 2,
  Strait = 3,
  SeaRoute = 4,
}

export type CultureKind = 'farm' | 'nomad' | 'sea' | 'highland' | 'river' | 'lake' | 'forest';

/** 民族 */
export interface Culture {
  id: number;
  name: string;
  /** 地名语感 id(地名生成器 src/gen/names/ 的语感) */
  style: string;
  /** 按份数配地名风格(CivParams.names)时:自动时会挑的语感(界面上「照自动」按它折份数);自动时不写 */
  autoStyle?: string;
  kind: CultureKind;
  /** 发源地区 */
  hearth: number;
  born: Year;
  expansionism: number;
  color: [number, number, number];
  /**
   * 阶段 3 同化与迁徙(assimilation.ts):最后一州也改换了民族的年份(民族消亡)。还在 = 不给。
   * 发源州在更早的地形大事里沉了、没能兴起的 = 诞生那一年(born,一州也没有过)
   */
  ended?: Year;
  /** 没能兴起(发源州在更早的地形大事里沉了,见 ended):一州也没有过,史书材料、搜索里不列 */
  unborn?: true;
  /**
   * 干预"立国"立在没人住的州时来这里落脚的新民族:那条干预在清理过的干预列表里的下标(cultures.ts 的 planPioneers)。
   * 一开始记作没能兴起(unborn、ended);立国那一刻才兴起(born 改成那一刻,去掉 unborn、ended),没用上的就一直是没能兴起
   */
  pioneer?: number;
  /**
   * 阶段 3 同化与迁徙:成规模的迁徙(按年份排好),每一波一条:年份、方位(迁出地 → 迁入地,屏幕上 y 向下 = 向南)。
   * 迁入了哪些州见史事里同一年、同一民族的 migrate;编年史写"西迁"用
   */
  migrations?: { year: Year; dir: MigrationDir }[];
  /**
   * 民族分化(assimilation.ts 的看分化):从哪个民族分出来的。被海峡、山脉隔开,或分属不同国家几百年的一支渐成一族;
   * 诞生年份 = 分化那一年,发源州 = 分出去的那几州里最宜居的。族名用母族的名字加方位(branch)。自然兴起的不给
   */
  parent?: number;
  /** 分出去的那几州在母族本土的哪个方位(族名"北某某"用) */
  branch?: MigrationDir;
}

/** 迁徙的方位 */
export type MigrationDir = '东' | '南' | '西' | '北';

/**
 * 一次大迁徙(migration.ts):草原、寒地的一个民族分出一支(约三成的人),举族远走,一路走一路抢,
 * 到了落脚地占几州立国、和那里的国家开战。老家照旧。下标 = 史事 trek 的 war 列。
 */
export interface Migration {
  /** 迁徙的民族 */
  culture: number;
  /** 动身那一刻(= years[0]) */
  year: Year;
  /**
   * 路线:依次走过的州。第一个是出发的州(在老家边上集结),最后一个是落脚的州。只走陆路(平地、跨河、翻山),
   * 一般 10–20 州远。队伍不占地,只是路过
   */
  route: number[];
  /** 到 route 里每一州的那一刻(和 route 一样长,严格递增;years[0] = 动身,最后一个 = 落脚) */
  years: Year[];
  /** 一路往哪个方位走:整条路线在地图上的总体走向(各段的经度差、纬度差加起来,哪个大取哪个;见 migration.ts 的 trekDir) */
  dir: MigrationDir;
  /** 这一支有多少人:到了能占几州(本族州数的三成,3–8 州) */
  size: number;
  /** 为什么走(推):crowd 老家挤、famine 灾年、scatter 本族的国刚散回部落 / 亡了 */
  push: 'crowd' | 'famine' | 'scatter';
  /** 冲着什么去(拉):chaos 那边的国家大乱(崩了、动荡高、正打着仗)、plague 疫后空了、rich 富庶、tribal 部落地带 */
  pull: 'chaos' | 'plague' | 'rich' | 'tribal';
  /** 动身时落脚那片地的主人(冲着哪国去;−1 = 部落地带) */
  target: number;
  /** 落脚那一刻(= years 的最后一个;还在路上 = 不给) */
  settled?: Year;
  /**
   * 结局:found 立了国(和那里的国家议和、割据一方,或者仗还没打完)/ conquer 入主(打进那国的国都:小国亡、州归它,
   * 大国大崩解、迁来的占着国都一带)/ rout 败散(立的国亡于到了以后的那一仗,或者根本没立成国),落脚的几州留下一块异族。
   * 还在路上 = 不给。先是 found,入主、败散那一刻改过来(outcomeYear 跟着改)
   */
  outcome?: 'found' | 'conquer' | 'rout';
  /** 结局那一刻(立国 = settled;入主、败散 = 那一仗的那一刻) */
  outcomeYear?: Year;
  /** 立的国(没立成 = 不给) */
  polity?: number;
  /** 到了以后当即开的那一仗(战争编号;没开仗 = 不给) */
  war?: number;
  /** 入主:打进了哪国的国都 */
  stormed?: number;
  /** 到了以后开仗的那国有几州(落脚那一刻、迁来的占走几州以前;没开仗 = 不给) */
  foeSize?: number;
  /**
   * 打进大国:开仗时对方有 25 州以上,打进了它的国都(结局 conquer)。丢国都时那国还有 25 州的大崩解(史事 trek n = 3 后面紧跟着 collapse,
   * 崩得成的话),迁来的占着国都一带;已经被打得只剩不多的整个归它。别的 = 不给
   */
  big?: true;
  /** 落脚时改换成迁来的民族的几州(州号升序;立的国一开始的国土可能多几州:刚改换过民族的、原民族最后一州的,归它但民族不变) */
  lands?: number[];
  /** 作者下令的(干预「大迁徙」):Civ.interventions 里第几条;推演自己起的没有 */
  iv?: number;
}

/** 城镇 */
export interface Settlement {
  id: number;
  cell: number;
  region: number;
  culture: number;
  name: string;
  founded: Year;
  /** 阶段 3:被毁 / 废弃(城市兴衰,cities.ts:战争里攻下时被毁)。这一年起人口为 0,地图上留一处"故城遗址" */
  ended?: Year;
  /** S 形成长的上限 */
  capacity: number;
  /** 成长速度(每年) */
  growth: number;
  port: boolean;
  /** 从哪一年起是国都(国都人口上限更高,见 growth.ts 的 populationAt)。不是国都 = 不给 */
  capitalFrom?: Year;
  /**
   * 阶段 3 城市兴衰:做国都的年份段(按先后;polities.ts 的 addPolity / moveCapital / endPolity 维护)。
   * until 不给 = 现在还是国都;polity = 哪国的国都。populationAt 按它算国都加成:立都后渐渐加上去,
   * 迁都 / 亡国后在 CAPITAL_DECLINE 年里渐渐退掉(旧都衰落)。没有这一项、只有 capitalFrom 的(旧数据)= 从 capitalFrom 起一直是国都
   */
  capitalSpans?: { from: Year; until?: Year; polity: number }[];
  /**
   * 阶段 3 城市兴衰:被洗劫(按先后)。loss = 当时人口折损的比例(0..1),之后按 SACK_RECOVER 年慢慢恢复(见 growth.ts)。
   * 饥荒(unrest.ts)、瘟疫(plague.ts)也记在这里(cause = famine / plague):人口一样掉一截、慢慢长回来;
   * 作者下的天灾(干预 disaster,disaster.ts)里饥荒记 famine、瘟疫记 plague、地震水旱记 quake(from = 震中那州:是地震、大水还是大旱按它定)。
   * 全球大疫(pandemic.ts):染疫记 plague、疫后凋敝里"疫气复作、流亡"记 slump,都带 until = 那场的凋敝结束那年:
   * 无人收拾,凋敝结束以前不长回来,之后照常按 SACK_RECOVER 淡去(growth.ts 的 populationAt);染疫的那条另带 pan = 第几场瘟疫(史事 pandemic 的 war 列)
   */
  sacks?: { year: Year; loss: number; cause?: 'famine' | 'plague' | 'quake' | 'volcano' | 'slump' | 'impact'; from?: number; until?: Year; pan?: number }[];
  /**
   * 阶段 3 城市兴衰:这座城是在哪座被毁的城(Settlement id)的故址上重建的(同一州、同一地块)。
   * 同族重建沿用旧名;换了民族的另起新名。不是重建的 = 不给
   */
  rebuilds?: number;
  /**
   * 地形大事以后城址变了(upheaval.ts 的 reshapeCities;按先后):从 year 那一刻起人口上限换成 capacity、是不是港口换成 port
   * (海水漫到城边成了港口、抬升把港口围成了内陆、州沉掉一块或长出新地)。capacity、port 本身是建城时的;没遇上 = 不给。
   * 按年份取值见 growth.ts 的 capacityAt / portAt
   */
  reshaped?: { year: Year; capacity: number; port: boolean }[];
  /**
   * 人口上限随所在州的生产能力变的倍数(development.ts 推演里每 20 年看一次,变了才记):扁平的 [年份, 倍数, 年份, 倍数, …],年份递增。
   * 建城那一刻记第一对;之后每一对从那一刻起 20 年里从上一个倍数线性变到这个倍数。按年份取值见 growth.ts 的 devFactorAt。
   * 没有发展度的历史(没有 = 不给)倍数一律是 1
   */
  devCap?: number[];
}

/** 国家 */
export interface Polity {
  id: number;
  /** 国名词根;全称 = 词根 + 当年的国号形态 */
  name: string;
  culture: number;
  /** 国都:Settlement id */
  capital: number;
  founded: Year;
  ended?: Year;
  kind: CultureKind;
  expansionism: number;
  color: [number, number, number];
  /** 国号一系(见 growth.ts 的 POLITY_FORMS):农耕一系 / 游牧汗国一系 / 海洋城邦共和一系 */
  lineage?: PolityLineage;
  /** 国号档位的变化("升格"事件写这里;按年份排好序):第一条是立国那年 */
  titles?: { year: Year; tier: number }[];
  /** 东方语感的国家:国号走中式写法("大昌王朝"而不是"昌帝国"),见 growth.ts 的 easternTitles */
  eastern?: boolean;
  /**
   * 国都的变迁(阶段 3;按年份排好序):第一条是立国那年、= capital。迁都就往后加一条。
   * 某一年的国都用 growth.ts 的 capitalAt(p, 年份) 查,别直接读 capital(capital 只是立国时的国都)
   */
  capitals?: { year: Year; settlement: number }[];
  /**
   * 普通国家从哪一刻起能走远洋(海峡、航线):国都所在州的运输能力够了的那一刻(development.ts 推演里每 20 年看一次);
   * 从能远洋的国家分出去、复国的,立国那一刻。海洋国家从来就能,不给;还不能的不给。见 polities.ts 的 sailsOcean
   */
  sail?: Year;
  /**
   * 阶段 3 分合(politics.ts):从哪国分出来的(分裂 / 独立、复国时起兵反抗的那一国)。
   * 分出来的国家没有"立国"史事,只有一条 split(a = 本国,b = parent);立国就不给
   */
  parent?: number;
  /** 阶段 3 分合:复的是哪个亡国(国名沿用故国国名加"后 / 南 / 北…"前缀,编年史写"复国")。不是复国 = 不给 */
  restores?: number;
  /**
   * 宗室争位、据地自立的国家(unrest.ts 的争位;史事 split 的 cause = heir):起兵的那位先君之子的生年。
   * 他就是这国的开国之君(在位表照这个生年算即位的年纪,rulers.ts);别的国家不给
   */
  prince?: Year;
  /**
   * 大迁徙(migration.ts):迁来的一支到了落脚地立的国 —— Civ.migrations 的下标。统治民族在本国只占少数时,
   * 被多数民族同化得快(assimilation.ts)。别的国家不给
   */
  trek?: number;
  /**
   * 宗室摄政篡位(regency.ts;史事 regent n = 3、b = 2):year 那一刻幼主(在位表第 k 位)下台,摄政的叔父接着在位(同一朝,在位表第 k + 1 位):
   * 他的生年、倾向(和摄政时一样)、不被打断时在位到哪年。在位表照它排(rulers.ts);没有 = 不给
   */
  seizes?: { year: Year; k: number; born: Year; until: Year; leanings: RulerLeanings }[];
  /**
   * 边缘立国(politics.ts 的看部落地带):受哪国影响立的国(挨着它的部落地带里提早立国的次生国家)。
   * 国号一系(政体)沿用它的,旗沿用它的样式;史事 found 的 b 也记它。自己立国的、分出来的不给
   */
  mentor?: number;
  /**
   * 阶段 3 王朝更替(dynasty.ts;按年份排好序):第一条 = 立国那年,改朝换代一次往后加一条。没改朝换代过 = 不给。
   * - name:东方语感 = 这一朝的国名词根(大昌 → 大景:地图上的国名跟着年份变,全称仍按当年的国号档位写,见 growth.ts 的 polityName);
   *   西幻语感 = 王室的名字("卡诺",写作"卡诺王朝";国名不变)。推演时留空,推演结束后由起名(naming.ts)填;
   *   第一朝东方 = 国名词根 name,西幻 = 按立国时的国都起
   * - seat:这一朝兴起的城(Settlement id,王室的根据地;第一朝 = 立国时的国都)。西幻的王朝名借它的城名
   * 某一年是哪一朝用 growth.ts 的 dynastyAt(p, 年份) 查
   * - usurper:掌实权的名臣、大臣篡位开的这一朝(regency.ts):他的生年、倾向(和掌权时一样),这一朝的第一位就是他(在位表照它排,rulers.ts);
   *   改制(reform.ts)开的那几段也借它:政变的将军、革命起兵的人、复辟时自立为君的执政 / 将军;别的朝不给
   * - regime:改制(reform.ts)开的一段 —— 不是换了一家王室,是改了政体:republic 共和(议事会推举执政,有任期)、
   *   junta 军政府(将军执政)。这一段没有王室(不结亲、不立储、不摄政),东方语感的国名词根照抄上一段;
   *   王室的那几段(立国那一朝、改朝换代、复辟)不给。某一年是什么政体用 regime.ts 的 regimeAt / lineageAt 查
   * - house:复辟迎回的是第几朝的王室(这一段的国名词根、旗照那一朝);拥立的人自己做君主的复辟、寻常改朝换代不给
   */
  dynasties?: { year: Year; name: string; seat: number; usurper?: { born: Year; leanings: RulerLeanings }; regime?: 'republic' | 'junta'; house?: number }[];
}

/** 国号一系 */
export type PolityLineage = 'realm' | 'khanate' | 'republic';

/** 道路 / 航线 */
export interface Route {
  kind: 'road' | 'trail' | 'sea';
  /** 经过的地块;画的时候再平滑 */
  cells: Int32Array;
  built: Year;
  abandoned?: Year;
}

/**
 * 关隘(Place.kind = 'pass')的地形和来历(passSites.ts):口子多高、两旁山脊、绕开要翻多高、哪几对州之间、
 * 大路哪年修通、哪年在这里据险断后。从哪年起画在地图上见 since
 */
export interface PassInfo {
  /** 翻过口子要爬多高(米) */
  height: number;
  /** 交界的山脊(米,中位数) */
  ridge: number;
  /** 口子附近绕开它最低要翻多高(米);附近根本绕不过去 = 不给 */
  detour?: number;
  /** 两边的州 [a0, b0, a1, b1, …](同一处被几对州认出来的都记上) */
  regions: number[];
  /** 大路最早哪年修过这个口子 */
  road?: number;
  /** 第一次在这里据险断后的年份 */
  stand?: number;
  /** 在这里据险断后的史事(civ.annals 的下标,按先后):编年史写关名、导播的圆环落在关口按它认 */
  stands?: number[];
  /** 名关(挑进名额、大路修通起就画的那些);不是 = 只因为打过守关战才画 */
  named: boolean;
  /** 从哪年起画在地图上(名关:大路修通那年;打过守关战的:那一仗那年;取早的) */
  since: number;
}

/** 地理实体:山脉 / 海域 / 大河 / 湖泊 / 岛屿 / 荒漠 / 关隘…… */
export interface Place {
  kind: 'sea' | 'mountains' | 'river' | 'lake' | 'island' | 'desert' | 'pass';
  name: string;
  /** 按哪个民族的语感起名(海洋为 -1) */
  culture: number;
  /** 标注用的锚点路径 x,y,x,y…(山脊线、河道、海域中心弧) */
  path: Float32Array;
  /** 重要度,决定字号和从哪一级缩放开始显示 */
  rank: number;
  /**
   * 实体大小(世界单位):海域 = 离岸最远距离;山脉 = 山脊长;河 = 半河宽(标注要让开);
   * 湖 / 岛 / 荒漠 = 等面积圆的半径
   */
  size?: number;
  /** 锚点地块(以后悬停、按民族换语感用) */
  cell?: number;
  /**
   * 地形大事以后还是同一处的(keepPlaceNames 认出来的):稳定键按第一件大事以前那一处的锚点地块算,
   * 锚点跟着地形挪了也是同一个键(改的名在大事前后都认得)。没有这一项 = 按 cell
   */
  keyCell?: number;
  /** 西幻风地名的拉丁原形(如 "Aldor Mountains");湖、岛、荒漠借用的是别的名字的原形,仅供参考 */
  latin?: string;
  /** 关隘(kind = 'pass')才有 */
  pass?: PassInfo;
  /**
   * 阶段 4 改名(gen/edits.ts 的 applyNames 填):用户改过名时,原来的名字。生成出来的没有这一项。
   * 画风按它分大洋 / 海 / 海湾的字号("北大洋"改成"饕餮海",字照旧按大洋写)
   */
  defaultName?: string;
}

/**
 * 史事的种类(阶段 3):编年史的原料。字段的含义按种类不同,没用到的字段为 −1:
 *
 * 每种的说明和 a、b、region、settlement、war 各列的含义登记在 annals.ts 的 ANNAL_KINDS(一种一条;新种类在那里和下面的 AnnalKind 一起加)。
 *
 * 洗劫、毁城和那一次攻占同一刻,记在那条 conquer **前面**(conquer、被迫迁都、灭亡照旧紧挨着,编年史里排回攻占后面)。
 * 议和割让的州也各记一条 conquer(a = 得到的一方,b = 割出的一方),连着记在那条 peace 前面,条数记在 peace 的 region 列。
 *
 * migrate / assimilate / vanish(阶段 3 同化与迁徙,assimilation.ts)的 a、b 是民族编号,不是国家。
 * intervene(阶段 4 干预)各种类的字段:
 *   不许灭 / 禁止分裂 / 不许扩张:a = 国家,b = −1,region / settlement = A 当时的国都所在州 / 国都
 *   结盟 / 宣战:a = 国家 A,b = 国家 B(键指不到 = −1),region / settlement = A 当时的国都所在州 / 国都
 *   划州:a = 得到它的国家,b = 原主(−1 = 部落地带;**−2 = 州里没人住,没划成**),region = 州,settlement = 州里的城(没有 = −1)
 *   立国:a = 新国家(**−1 = 州里没人住,没立成**),b = 原主(新国从哪国分出来;−1 = 部落地带),region = 州,settlement = 新国都
 *   迁都:a = 国家,b = 城所在州此刻的主人(**= a 才迁得成**;−1 = 部落地带;−2 = 城已毁),region / settlement = 那座城所在州 / 那座城
 *     (新历史里还没有这座城 = −1 / −1)
 *   即位:a = 国家,b = −1(**即位了**)/ −2(这个人物那一年还没出生,没即位)/ −3(那一年这国已亡,没即位),
 *     region / settlement = A 当时的国都所在州 / 国都(作者的君主见 Civ.people 里 author 是那个人物、即位年份是这一年的那位)
 *   宣战的干预打成了,紧跟在它后面(同一刻)记一条 war;没有 = 没打成(两国不接壤 / 已在交战 / 有一方已亡)。
 *   结盟时两国正在交战、不许扩张的国家正在打它挑起的仗,紧跟着记议和(peace)。
 *   立国紧跟着记一条 found(新国家;编年史并进干预那一条),原主的国都在这州就再记原主迁都(capital,war = −1)或亡国(fall,b = 新国家);
 *   划州同样(原主迁都 / 亡国);迁都迁成了紧跟着记一条 capital(war = −1;编年史并进干预那一条)。
 *   方针:a = 国家,b = −1(定了)/ −3(那一年这国已亡)。
 *   灭国:a = 国家,b = 并入的国家(−1 = 散成无主;−3 = 那一年这国已亡,没灭成;−7 = 那一刻有后下的"不许灭"护着,没灭成),
 *     region / settlement = A 当时的国都所在州 / 国都;灭成了紧跟着记 fall(b 同上;散成无主 = −1)
 *   即位(等此刻在位的那位下台再即位):下令那一年记 b = −6(登记了),真即位的那一刻另记一条 b = −1(同一条干预)
 *   让人物去世 / 改君主倾向:a = 国家,b = −1(生效了)/ −3(那一年这国已亡)/ −4(此刻在位的不是他)/ −5(将领、名臣:推演里不管,
 *     生没生效看人物的 killed),region / settlement = A 当时的国都所在州 / 国都
 *   天灾:见 disaster.ts(b = 受灾的州数,瘟疫 1 = 起了一场新的 / 2 = 并进正在传的那一场,0 = 没生效);紧跟着记它引起的 plague / famine
 *   大迁徙、不许迁:a = −1(不是国家),**民族在 n**;大迁徙 b = −1 动身了(region / settlement = 目的地那州和它的城,紧跟着记 trek n = 0)/
 *     −3 那一刻这一族已消亡 / −18 走不成(陆路走不到指定的那一州、推演挑没有可去的地方;region = 出发的州,没给 = −1);
 *     不许迁 b = −1 登记了 / −3 这一族已消亡(见 migration.ts)。民族键指不到就不记
 *   推一把发展:见 boost.ts(b = −1 生效了 / −3 那一年这国已亡 / −17 直接进时国都已在最后一个时代;n = 推了几州 × 16 + 直接进到第几个时代)
 *   国家 A 的键指不到(新历史里没有这国 / 那一刻还没立国)就不记(立国、天灾除外:立国一定记;天灾只有饥荒选的那国指不到时不记)。
 * battle(人物与战役,wars.ts 的战役):每一仗都算过胜负,打下来的记 conquer,没打下来的(攻方败退、守方反攻没夺回)记一条 battle;
 *   攻方从哪种边打过去记在 Annal.via。不改归属,只是让编年史写得出"某某之战"。
 * upheaval 之后紧跟着(同一刻)记这件大事的后果:sunk(没了的城,国都在前)、迁都(capital,war = −1)、亡国(fall,b = −2),
 * 编年史并进 upheaval 那一条。
 * 邦交(diplomacy.ts):
 *   alliance 的 Annal.foe = 共御的强邻;unally 的 Annal.cause = 怎么断的:lapse 强邻已衰 / 已亡,盟约渐废;abandon 盟国被打时坐视不救;
 *   betray 背盟来攻(紧跟着记 war,cause 也是 betray);vassal 一方称臣,它的盟约随之作废(紧跟在 submit 后面)。
 *   war 的 Annal.cause = 为什么打(见 WarCause);援盟、救藩的 settlement 列 = 援的是哪国。
 *   宗主收藩属的国土记 merge(编年史写"纳土归附");藩属、盟约在任一方亡国 / 被并时随之了结,不另记。
 *   某一年谁是谁的藩属、谁和谁结着盟,按这几条推(diplomacy.ts 的 relationsAt)。
 * 动荡、饥荒、民变、大崩解(unrest.ts):民变被讨平 = 起事的国家亡于讨伐它的那场战争(fall,b = 原来的国家);
 *   民变打下原来国家的国都 = 原来的国家余下的州一并归起事的国家、亡国(fall,b = 起事的国家,war = 讨伐的那场战争)。
 * 以后再有新种类在末尾往下加。
 */
export type AnnalKind =
  | 'found'
  | 'rank'
  | 'war'
  | 'conquer'
  | 'peace'
  | 'fall'
  | 'capital'
  | 'split'
  | 'merge'
  | 'dynasty'
  | 'migrate'
  | 'assimilate'
  | 'vanish'
  | 'sack'
  | 'ruin'
  | 'rebuild'
  | 'decline'
  | 'intervene'
  | 'battle'
  | 'upheaval'
  | 'sunk'
  | 'alliance'
  | 'unally'
  | 'submit'
  | 'defect'
  | 'diverge'
  | 'famine'
  | 'revolt'
  | 'collapse'
  | 'plague'
  | 'warlord'
  | 'reclaim'
  | 'defy'
  | 'fiscal'
  | 'council'
  | 'stand'
  | 'regent'
  | 'marry'
  | 'pandemic'
  | 'desolate'
  | 'treaty'
  | 'breach'
  | 'expire'
  | 'neutral'
  | 'exile'
  | 'keep'
  | 'trek'
  | 'winter'
  | 'reform';

/**
 * 战争的起因(史事 war 的 cause;阶段 4 干预的强制宣战不给)和盟约怎么断的(unally 的 cause):
 *   expand 争边地(没有别的由头)/ claim 收复故土(对方手里有原属本国的州)/ chaos 乘对方之乱(对方正和别国交兵、刚丢了国都、刚改朝换代)/
 *   prey 吞并小国 / betray 背盟来攻 / punish 讨伐自立的藩属 / ally 应盟国之约 / rescue 宗主救藩属 / quell 讨伐起事的饥民(民变);
 *   collapse:大崩解里自立的那几块(史事 split 的 cause);heir:宗室争位、据地自立(史事 split 的 cause)和讨伐他的那场仗(war 的 cause);broke:国用不足才议直征(史事 council 的 cause);warlord:割据的地方起兵自立(史事 split 的 cause,control.ts);great:大瘟疫(史事 plague 的 cause);
 *   pandemic:全球大疫(史事 plague 的 cause,pandemic.ts);
 *   lapse 盟约渐废 / abandon 坐视不救 / vassal 一方称臣;
 *   slain / captured / withdrew:据险断后的守将力战而死 / 力竭被擒 / 全师而退(史事 stand 的 cause);
 *   立约与中立地(treaties.ts):breach 背约来攻(war 的 cause);peace 议和时顺带立约 / 划缓冲中立地(treaty、neutral 的 cause);
 *   renew 约满续约(treaty 的 cause);lapse 约里剩不到两国、约废(expire)/ 中立地撤销(neutral);
 *   heir / deposed / fled 放逐到中立地的是争储失势的宗室 / 被废的末代之君 / 出奔(中立地、邻国)的亡国之君(exile 的 cause);
 *   decree 作者下令立的约、划的中立地(干预「立约」「划中立地」;treaty、neutral 的 cause);
 *   开战看内政(wars.ts,war 的 cause):divert 国中动荡、对外开战以安内(转移矛盾)/ unrest 乘对方内乱(动荡高或有割据;region 列 = 割据的那州,没有 = −1)/
 *   plagued 乘对方大疫之后 / minor 乘对方幼主在位 / regent 乘对方权臣当政 / plunder 国库空竭、为掠夺而战(region 列 = 边境上最富的那州);
 *   trek:大迁徙(migration.ts)迁来的一支落脚立的国(史事 found 的 cause)和它到了以后当即开的那一仗(war 的 cause);
 *   spring:冬夏分明的地方闹的春荒(史事 famine 的 cause,unrest.ts);
 *   revolution:议立宪 / 废君谈崩、起兵的人打不进国都,据地自立为共和国(史事 split 的 cause,reform.ts;紧跟在那条 council 后面);
 *   surrender 强国打下国都,余下的州一并归降、亡国(破都纳降,wars.ts;fall 的 cause)
 */
export type AnnalCause = 'expand' | 'claim' | 'chaos' | 'prey' | 'resource' | 'betray' | 'punish' | 'ally' | 'rescue' | 'lapse' | 'abandon' | 'vassal' | 'quell' | 'collapse' | 'great' | 'quake' | 'volcano' | 'impact' | 'warlord' | 'broke' | 'heir' | 'slain' | 'captured' | 'withdrew' | 'pandemic' | 'breach' | 'peace' | 'renew' | 'deposed' | 'fled' | 'decree' | 'divert' | 'unrest' | 'plagued' | 'minor' | 'regent' | 'plunder' | 'trek' | 'spring' | 'revolution' | 'surrender';

/**
 * 一条史事(阶段 3):推演里各事件处理函数用 CivSim.record 往 Civ.annals 里记,编年史(界面上的事件列表)只读它。
 * 和变化日志的分工:日志记"哪一州归了谁"(画图用,回放按它翻),史事记"发生了什么事"(讲故事用)。
 */
export interface Annal {
  year: Year;
  kind: AnnalKind;
  a: number;
  b: number;
  region: number;
  settlement: number;
  war: number;
  /** 战役(battle)才有:攻方从哪种边打过去(AdjKind:平地、跨河、翻山、海峡、航线) */
  via?: AdjKind;
  /** 宣战(war)为什么打、盟约(unally)怎么断的(见 AnnalCause);自立(defect)的 betray = 宗主先动的兵;合并(merge)的 vassal = 藩属纳土归附 */
  cause?: AnnalCause;
  /**
   * 结盟(alliance)才有:共御的强邻(−1 = 没有);据险断后(stand)借用:大军退保的那一州;
   * 掌实权(regent,n = 0 掌权那一条)借用:作者下令"让他掌权"的第几条干预(推演里自己出的不给)
   */
  foe?: number;
  /**
   * 干预灭国(intervene,灭成了)才有:亡时国土几州;为夺物产的宣战(war,由头 resource)才有:想要的物产(按位,下标见 development.ts 的 RESOURCES);议事(council)才有:结果;
   * 掌实权(regent)才有:哪一步;结亲(marry)才有:娶亲的是谁 = 那一刻在位的君主在在位表里第几位 × 16 + 他的第几个儿子
   * (0 = 预定的继承人,1–14 = royals.ts 的 Brood.extra 里那一个的 s,15 = 君主本人);立约与中立地见 AnnalKind 的表
   */
  n?: number;
  /** 立约 / 约满(treaty、expire)、设中立地(neutral)才有:立约 / 续约 / 还在约里 / 共建的几国(按入约先后) */
  ps?: number[];
  /** 立约(treaty)才有:居间的国家(−1 = 没有;它当时在朝的名臣出使,见 treatyInfo.ts 的 envoyOf) */
  by?: number;
  /**
   * 作者下令立的约、划的中立地(cause = decree)才有:几样选项按位(见 AnnalKind 的表;treaties.ts 的 OPT_*);
   * 改制借用(议事 council 的废君立共和办成、史事 reform 的革命):之后能议政的有几档(参与,councilRules.ts 的 Rules.franchise)
   */
  opt?: number;
  /** 作者下令划的中立地(neutral,cause = decree)选了"到某一年":那一年撤销;顿兵过冬(winter)借用:开春再打的时刻 */
  until?: number;
}

/** Annal 里可有可无的几列:官方推演登记给引擎(events.ts 的 CIV_ANNALS),记史事时照这个次序抄进去;Annal 加了新的可选列,这里跟着加 */
export const ANNAL_EXTRAS = ['via', 'cause', 'foe', 'n', 'ps', 'by', 'opt', 'until'] as const satisfies readonly (keyof Annal)[];
/** 编译期核对:Annal 的可选列都在 ANNAL_EXTRAS 里(漏了这里报错) */
type AnnalOptional = { [K in keyof Annal]-?: undefined extends Annal[K] ? K : never }[keyof Annal];
const ANNAL_EXTRAS_COMPLETE: [Exclude<AnnalOptional, (typeof ANNAL_EXTRAS)[number]>] extends [never] ? true : false = true;
void ANNAL_EXTRAS_COMPLETE;

/** 变化日志里的"哪一层" */
export const enum Layer {
  Culture = 0,
  Polity = 1,
}

/** 变化日志(按时间排序;结构数组,可增长;只用前 size 条) */
export interface ChangeLog {
  size: number;
  year: Float32Array;
  region: Int32Array;
  layer: Uint8Array;
  /** 新归属;-1 = 无 */
  value: Int16Array;
  /** 事件类型(编号表在 sim.ts) */
  cause: Uint8Array;
}

export interface Checkpoint {
  year: Year;
  culture: Int16Array;
  polity: Int16Array;
}

export interface Civ {
  seed: number;
  endYear: Year;
  habitat: Habitat;
  regions: Regions;
  cultures: Culture[];
  settlements: Settlement[];
  polities: Polity[];
  routes: Route[];
  places: Place[];
  /** endYear 时各地区的民族(-1 = 无) */
  culture: Int16Array;
  /** endYear 时各地区的国家(-1 = 无) */
  polity: Int16Array;
  log: ChangeLog;
  checkpoints: Checkpoint[];
  /** 史事(阶段 3):立国、升格、战争、攻占、灭亡、迁都、分裂、合并……按年份排好序,同一年按发生先后 */
  annals: Annal[];
  /**
   * 这颗星球能不能有文明。false = 可居的地方太少(比如几乎全被冰雪覆盖),
   * 这时只有宜居度和州(地理),民族 / 城镇 / 国家 / 道路都是空的。
   */
  viable: boolean;
  /** 整个世界的地名风格(CivParams.names,清理过的:语感 → 份数);自动 = 不写 */
  names?: import('../names').NameMix;
  /**
   * 民族扩张的时间标定:走一个"标准路程"(平地、普通地形、扩张性 1)要多少年。
   * 按世界自动标定(默认到第 3000 年约九成可居州有人住;改过地形的世界按没改地形时的同一颗星球标定,见 index.ts 的 planetTempo),
   * resumeCiv 接着推时要用。
   */
  spreadYears?: number;
  /**
   * 城的人口上限按哪个数折算(polities.ts 的 capacityNorm:可居州人口上限的第 90 百分位折算)。
   * 改过地形的世界沿用没改地形时的同一颗星球的(见 index.ts 的 planetTempo)。resumeCiv 接着推时要用
   */
  capNorm?: number;
  /**
   * 国家扩张的快慢:国家在国都旁边走一个"标准路程"要多少年(见 polities.ts,离国都越远越慢)。
   * resumeCiv 接着推时要用
   */
  polityYears?: number;
  /**
   * 国都彼此至少隔几跳(polities.ts 的 capitalSpacing,按 CivParams.polities 定)。resumeCiv 接着推时要用;
   * 没有(旧版本的历史)= 按"自动"的国家数重算
   */
  capSpacing?: number;
  /** 全世界统一的航海时代从哪一刻起(旧版本的历史;现在各国自己进,见 Polity.sail,这里是 Infinity。polities.ts 的 sailsOcean;接着推时沿用) */
  sailFrom?: Year;
  /** 拓荒设定(CivParams.frontier,清理过的;默认 = 不写)。resumeCiv 接着推时要用 */
  frontier?: import('./frontier').Frontier;
  /** 「天灾」设定(CivParams.calamity;平常 = 不写)。resumeCiv 接着推时要用 */
  calamity?: import('./calamity').Calamity;
  /**
   * 这个世界用的一套数(CivParams.knobs,清理过的;官方 = 不写)。接着推、讲故事、界面里现算的(人物的岁数、在位年数……)都按它取
   * (civ/knobs.ts 的 knobsOf)
   */
  knobs?: KnobPatch;
  /** 推不下去:推到第 at 年算不下去了,历史停在 endYear;本来要推到第 to 年。推完的 = 不给(stuck.ts) */
  stuck?: { at: number; to: number };
  /**
   * 大迁徙(migration.ts):按动身先后,每一次一条(下标 = 史事 trek 的 war 列)。还在路上的那支,路线和到每一州的年份
   * 动身时就定了(可能比 endYear 晚);落脚、结局到了那一刻才填。resumeCiv 接着推时要用。旧版本的历史、没有文明 = 不给
   */
  migrations?: Migration[];
  /**
   * 阶段 4 干预:这份历史是带着哪些干预推出来的(清理过的列表,见 gen/edits.ts;史事 intervene 的 war 列是它的下标)。
   * 没有干预 = 不给。resumeCiv 接着推时默认带着它
   */
  interventions?: Intervention[];
  /**
   * 作者的人物叫什么(gen/characters.ts 的 applyCharacters 写入:人物编号 → 名字;只有带"即位"干预的历史才有)。
   * 编年史写"某某即某国君位"、没即位成的原因时用;生成的 Civ 里没有
   */
  authorNames?: Record<number, string>;
  /**
   * 作者的人物里哪些是女的(编号,从小到大;applyCharacters 写入,同 authorNames;一个女的都没有 = 不给)。
   * 编年史写没即位成的原因("她第 N 年才出生")时用;生成的 Civ 里没有
   */
  authorFemale?: number[];
  /**
   * 用户改过的州名(阶段 4,gen/edits.ts 的 applyNames 写入;下标 = 州编号,空串 = 用 regions.name)。
   * 不改 regions 本身:画国土、国界的缓存按 civ.regions 存,改州名不用重画
   */
  regionNames?: string[];
  /**
   * 用户改过的约名(gen/edits.ts 的 applyNames 写入;约的编号 → 新名字,没改过的不在里面)。
   * 没改过的约名照会盟的城起("丹枫关之约",treatyInfo.ts 的 treatyName)
   */
  treatyNames?: Record<number, string>;
  /**
   * 人物(people.ts):各国的历代君主和战争里的统帅。推演结束后按历史"贴"上去,国界、兴亡、战争胜负一个都不变。
   * 下标 = Person.id;先是君主(按国家编号、即位先后),再是统帅(按第一次领兵的先后)。没有文明 = 空
   */
  people?: Person[];
  /**
   * 信仰(religion.ts):各族的民间信仰、几个大教的创立和传播、各国的国教、教派分立。
   * 推演里每 5 年算一步(别的规则还不读它,国界、兴亡、战争、人物一个都不变),推完补上名字和皈依的国君。没有文明 = 不给
   */
  religion?: Religion;
  /**
   * 发展度(development.ts):各州的物产、五种能力和时代。推演结束后按历史算出来,国界、兴亡、战争、人物一个都不变。
   * 没有文明 = 不给
   */
  development?: Development;
  /**
   * 思潮(ideology.ts):各州、各国各说的接受度,各说世上头一处冒在哪。推演里每 20 年算一步,只算不用:国界、兴亡、战争、人物一个都不变。
   * 没有文明 = 不给
   */
  ideology?: Ideology;
  /**
   * 商道(trade.ts):要紧的货从哪个产地沿哪条路运到哪国国都、哪年通哪年断。推演里每 20 年算一步,只读推演,历史一个字都不变。
   * 没有文明 = 不给
   */
  trade?: import('./trade').Trade;
  /**
   * 地形大事(upheaval.ts;gen/edits.ts 文件头"地形大事"):按年份排,同一年的合成一件。下标 = 史事 upheaval 的 a。
   * 没有 = 不给。regions、places、routes 是最后一件大事以后的;更早的各段见 eras
   */
  upheavals?: UpheavalFact[];
  /**
   * 地形大事以前的各段(和 upheavals 一一对应):第 i 段到 upheavals[i].year 为止(不含),那段时间的宜居度、州、地名、道路。
   * 州的编号各段一样(后面的段只多出新冒出来的州);归属数组(culture、polity、检查点、日志)按最后一段的州数。没有地形大事 = 不给
   */
  eras?: CivEra[];
  /**
   * 只有地图上画的是更早一段时才有(ui/eras.ts):整段历史那一份(最后一段的州、地名,套好改名)。
   * 编年史这类按整段历史算的用它(后面才冒出来的州也认得),地图用这一份本身
   */
  history?: Civ;
}

/** 地形大事以前的一段:到 until 年为止(不含) */
export interface CivEra {
  until: Year;
  habitat: Habitat;
  regions: Regions;
  places: Place[];
  routes: Route[];
}

/** 一件地形大事在这份历史里的经过(地块、州按大事前后比出来;国家是那一刻、变化之前的主人) */
export interface UpheavalFact {
  year: Year;
  /** 有哪几种修改(火山喷发 volcano、地震抬升 raise、海水漫进来 sink;按第一次出现的先后) */
  kinds: ('volcano' | 'raise' | 'sink')[];
  /** 合进这一件的是作者列表(WorldEdits.upheavals)里的哪几件(下标) */
  items: number[];
  /** 变成水 / 变成陆地的地块数 */
  sunk: number;
  risen: number;
  /** 受灾最重的州(火山 = 火山所在的州)和受灾最重的国家:那州当时的主人;那州无主 = 沉没、沉掉一块、长出新陆地的州最多的国家(火山不算;都无主 = −1) */
  region: number;
  polity: number;
  /** 一块陆地也不剩的州、当时各自的国家(−1 = 无主) */
  drowned: number[];
  drownedBy: number[];
  /** 沉掉一块、还剩陆地的州 */
  shrunk: number[];
  /** 新陆地:并进的老州、新划出来的州(编号接在大事前的州后面) */
  grown: number[];
  added: number[];
  /** 隆起的新陆地连起了大事前分开的两块陆地:两边挨着新陆地的州、当时各自的国家;没有 = 不给 */
  joined?: [number, number];
  joinedBy?: [number, number];
  /** 早先毁了的城(遗址)、城址这回成了海、湖的(城的编号;没有 = 不给) */
  ruins?: number[];
}

/** 信仰的种类:民间信仰(每个民族自带)、大教、从大教分出的教派 */
export type FaithKind = 'folk' | 'great' | 'sect';
/** 大教 / 教派的类型 */
export type FaithForm = '一神' | '多神' | '二元' | '哲理' | '修行';

/** 一种信仰。下标 = Faith.id:先是各族的民间信仰(编号 = 民族编号),再是大教和教派(按创立先后) */
export interface Faith {
  id: number;
  kind: FaithKind;
  /** 教名;民间信仰 = 族名 + 祖灵(东方)/ 旧神(西幻) */
  name: string;
  /** 大教 / 教派 */
  form?: FaithForm;
  /** 民间信仰:哪个民族的 */
  culture?: number;
  /** 教派:从哪个大教分出来 */
  parent?: number;
  /** 大教 / 教派:创立(分出)的年份 */
  founded?: Year;
  /** 大教:圣城(Settlement 编号,创教的那座城) */
  holy?: number;
  /** 大教:创教者 */
  founder?: { name: string; born: Year; died: Year };
  /** 教派:在哪一国分出来的(Polity 编号) */
  polity?: number;
  /** 教派:分出时那国的国都(Settlement 编号) */
  seat?: number;
  color: [number, number, number];
}

/** 信仰的大事:创教、传入一国、立为国教、教派分立、圣城被异教之国夺取 */
export type FaithEventKind = 'found' | 'enter' | 'state' | 'schism' | 'holy';

export interface FaithEvent {
  year: Year;
  kind: FaithEventKind;
  /** 哪种信仰(教派分立 = 新的教派) */
  faith: number;
  /** 哪一国(创教 = 圣城当时的主人;没有 = −1) */
  polity: number;
  /** 事发的州(−1 = 没有) */
  region: number;
  /** 事发的城(−1 = 没有) */
  settlement: number;
  /** 立国教、教派分立:当时在位的君主(Person 编号) */
  ruler?: number;
  /** 圣城易手:从哪国手里夺来 */
  from?: number;
}

/** 一国奉某种信仰为国教的一段时间 */
export interface StateFaith {
  polity: number;
  faith: number;
  from: Year;
  /** 结束的年份(改奉别的、分出教派、亡国);到结束年份还奉着 = 不给 */
  until?: Year;
}

export interface Religion {
  faiths: Faith[];
  /** 按年份排好 */
  events: FaithEvent[];
  states: StateFaith[];
  /** 各州信仰的变化日志(年份、州、新的信仰;−1 = 没人住),按年份排好 */
  log: { size: number; year: Float32Array; region: Int32Array; value: Int16Array };
  /** 每 100 年一份各州的信仰(按年份递增;那一年的变化已经算进去) */
  checkpoints: { year: Year; faith: Int16Array }[];
}

/**
 * 各国的账本(fiscalBook.ts):size 行,第 i 行是 polity[i] 国第 year[i] 年的账,data 里 BOOK_COLS 个数一行(千石);行按年份不减排
 */
export interface FiscalBook {
  size: number;
  year: Int32Array;
  polity: Int32Array;
  data: Float32Array;
}

/** 发展度(development.ts) */
export interface Development {
  /** 各州物产的底子(储量):州 × RESOURCE_COUNT 样(见 development.ts 的 RESOURCES),0 没有 / 1 少 / 2 中 / 3 多;开局按地形定,不变
   * (有地形大事的:最后一件大事以后的地形重新分的档;大事以前的 avail 按当时的档,可能比这里多) */
  resources: Uint8Array;
  /** 各州物产哪一年被发现(州 × RESOURCE_COUNT;一直没发现 = Infinity;地形大事后没有了的留着以前发现的年份) */
  found: Float64Array;
  /** 各州物产眼下能用多少:每份 = 州 × RESOURCE_COUNT 样,存的是 0–3 档 × AVAIL_SCALE(没发现 = 0);和 snapYears 一一对应 */
  avail: Uint8Array[];
  /** 各州的五种能力:每份 = 州 × 5 样(见 CAPS),存的是能力 × LEVEL_SCALE;和 snapYears 一一对应 */
  snaps: Uint8Array[];
  /** 每份快照的年份(递增;最后一份是结束那年) */
  snapYears: Year[];
  /**
   * 中央管到什么程度(control.ts):每 20 年一份,每份 = 州数个字节(0 = 不在国家里;1–101 = 1 + 管得到几成 × 100;200 = 割据)。
   * 和 controlYears 一一对应;旧版本的历史没有
   */
  control?: Uint8Array[];
  controlYears?: Year[];
  /**
   * 各州的乡村人口(千人;population.ts 的数表):每 RURAL_SNAP(10)年一份,每份 = 州数个数;和 ruralYears 一一对应。
   * 最后一份是最后算的那一年的(不在整 10 年上时是补的,接着推时去掉);旧版本的历史没有(界面照 S 形曲线现算)
   */
  rural?: Float32Array[];
  ruralYears?: Year[];
  /** 各国的账本(钱粮;fiscalBook.ts 记、读);旧版本的历史没有 */
  fiscal?: FiscalBook;
  /** 按年份排好 */
  events: DevEvent[];
  /**
   * 推演到结束那一刻的内部状态(全精度),接着推(resumeCiv)时从这里接着算;界面不用。
   * 最后一份快照不在整百年上时(结束年份不是整百年)它是补的,接着推时去掉(见 tail)
   */
  state?: DevState;
}

/** 发展度推演的内部状态(development.ts;字段含义见那里的 DevModel) */
export interface DevState {
  /** 上一步算到哪一年 */
  last: Year;
  /** 史事读到第几条 */
  annals: number;
  /** 快照里最后一份是补的(结束那年不在整百年上) */
  tail: boolean;
  cur: Float64Array;
  best: Float64Array;
  war: Float64Array;
  era: Float64Array;
  flags: Uint8Array;
  pop: Float64Array;
  city: Float64Array;
  road: Uint8Array;
  stock: Float64Array;
  availNow: Float64Array;
  depleted: Uint8Array;
  /** 旧版本存的没有(当作一直有) */
  resFrom?: Float64Array;
  polityEra: number[];
  worldEra: number;
  invented: Uint8Array;
  /** 各国的军力系数(PolityModel.military) */
  military: number[];
  /** 政局的数表(control.ts:管得到几成、离国都多远、动荡;旧版本存的没有,接着推时现算一次) */
  tables?: TablesState;
}

/** 一组数表存下来的状态:最后算的是哪一年;各张表的值(表名 → 格 × 栏) */
export interface TablesState {
  last: Year;
  data: Record<string, Float64Array>;
}

/**
 * 发展度的大事:first = 世界上第一次有州进入这个时代;enter = 这个国家的国都所在的州第一次进入这个时代(立国时已在的不记);
 * discover = 储量多的州第一次发现这样矿;deplete = 储量多的州这样物产采空(矿:能用的跌到两成以下)、吃空(林、渔、田、牧:跌到四成以下);
 * invent = 世界上第一次有州的某样能力到了某样发明那一档(文字、冶铁、印刷……);
 * regress = 全球大疫的凋敝里,这个国家的国都所在的州退回这个时代(从上一个时代跌下来;只有全球大疫会记,见 pandemic.ts)。
 * era = 那一刻那州在第几个时代(见 development.ts 的 ERAS);culture、polity、settlement = 那一刻那州的民族、国家、城(−1 = 没有)
 */
export interface DevEvent {
  year: Year;
  kind: 'first' | 'enter' | 'discover' | 'deplete' | 'invent' | 'regress';
  era: number;
  /** invent:哪样发明(见 development.ts 的 INVENTIONS) */
  invention?: number;
  /** discover / deplete:哪样物产(见 development.ts 的 RESOURCES) */
  resource?: number;
  region: number;
  culture: number;
  polity: number;
  settlement: number;
}

/** 思潮(ideology.ts;说的下标见那里的 THOUGHTS) */
export interface Ideology {
  /** 各州各说的接受度:每份 = 州 × 说数,存的是接受度 × IDEO_SCALE;和 snapYears 一一对应 */
  snaps: Uint8Array[];
  /** 每份快照的年份(递增;每 20 年一份,最后一份是结束那年) */
  snapYears: Year[];
  /** 各国各说的接受度(按人口加权):下标 = 国家编号;那国从没在整 20 年上在过 = null */
  polities: (IdeoSeries | null)[];
  /** 各国各说传进本国的年份:国 × 说数(没传进 = NaN) */
  arrive: Float64Array;
  /** 按年份排好 */
  events: IdeoEvent[];
  /** 推演到结束那一刻的内部状态(全精度),接着推(resumeCiv)时从这里接着算;界面不用 */
  state?: IdeoState;
}

/** 一国各说的接受度:from 年起每 20 年一份,每份说数个字节(接受度 × IDEO_SCALE);中间亡过国的那几份是 0 */
export interface IdeoSeries {
  from: Year;
  v: Uint8Array;
}

/** 思潮的大事:origin = 这一说世上头一处冒出来(那州、那城、那族、那国;那一刻的) */
export interface IdeoEvent {
  year: Year;
  kind: 'origin';
  thought: number;
  region: number;
  settlement: number;
  culture: number;
  polity: number;
}

/** 思潮推演的内部状态(ideology.ts) */
export interface IdeoState {
  /** 上一步算到哪一年;史事读到第几条 */
  last: Year;
  annals: number;
  /** 快照里最后一份是补的(结束那年不在整 20 年上) */
  tail: boolean;
  /** 数表:合、思潮(州 × 说数)、国中(国 × 说数) */
  tables: TablesState;
}

/**
 * 人物:君主或统帅。名字、生卒、在位都是推演结束后按国家的兴亡、王朝更替、战争排出来的(people.ts),
 * 随机数按国家的位置锚 + 第几位取:干预某一年之前已经下台的君主和不干预时一样(称号、编号可能变,见 people.ts)。
 */
export interface Person {
  id: number;
  /**
   * ruler 君主、general 将领、prince 没即位的宗室(君主的诸子、养子见 royals.ts,世系里补出来的见 lineage.ts)、minister 名臣(文臣,见 officials.ts)、
   * consort 后妃(consorts.ts:联姻嫁来的宗室女、临朝的太后;都是女的)
   */
  role: 'ruler' | 'general' | 'prince' | 'minister' | 'consort';
  /** 哪国的人 */
  polity: number;
  /** 本名:东方中式 = 姓 + 名("李昭");东方边塞、山海和西幻 = 名("咄苾""阿尔德里克") */
  name: string;
  /**
   * 女的 = true;男的不给(旧存档、旧链接里的人物没有这一项,一律当男的)。称呼里分男女的字(他 / 她、君号、身份词、亲属词、
   * 身后称号、嫁娶)都照它取,见 gender.ts
   */
  female?: true;
  /**
   * 女的:推演里先按男的给这个位置起的名字(civ/women.ts;不显示)。头像的长相按它一代代往下传,换成女的以后她的后人长相不变。
   * 男的不给
   */
  maleName?: string;
  born: Year;
  /** 卒年;到结束年份还在世 = 不给 */
  died?: Year;
  /** 结局(君主:怎么失去君位的;统帅:寿终还是战死)。还在位 / 还在世 = 不给 */
  fate?: PersonFate;
  /** 君主:即位的年份;名臣:入仕的年份;作者的将领(任将):上任的年份 */
  from?: Year;
  /** 君主:失去君位(去世、被废、亡国)的年份;名臣:去职的年份;作者的将领:卸任的年份;到结束年份还在位 / 在朝 = 不给 */
  until?: Year;
  /** 君主、名臣:第几朝(Polity.dynasties 的下标;没改朝换代过 = 0) */
  dynasty?: number;
  /** 君主:怎么即位的 */
  rise?: RulerRise;
  /** 君主的倾向(扩张、好战、重商,各 0–100,见 rulers.ts;推演里扩张、议和、称臣、亲征看它);将领、宗室不给。作者改过的,这里是他原来的 */
  leanings?: RulerLeanings;
  /** 作者改过他的倾向(干预"改君主倾向",按先后):year 那一年年初改的,下一刻起照 leanings;iv = 第几条干预。没改过 = 不给 */
  moods?: { year: Year; leanings: RulerLeanings; iv: number }[];
  /** 作者让他去世(干预"让人物去世"):第几条干预;卒年 = died。君主改了历史,将领、名臣只改人物(他后来该领的仗、该经手的事换了人) */
  killed?: number;
  /**
   * 作者的人物(干预"即位"立的君主、干预"让他掌权"掌了权的名臣、干预"任将 / 任臣"任了的将领名臣,见 gen/edits.ts):作者人物的编号(AuthorCharacter.id)。
   * 这样的人物 name 是空串(界面按编号填上人物卡的名字,见 gen/characters.ts 的 applyCharacters)、born 照干预里写的、
   * 不写 died(生死归人物卡管)、没有称号;别的人物不给。同一个作者人物可以有几位(为将一位、为相一位、即位一位……),按编号合起来看。
   * 任将任臣的:from / until = 任期(到结束年份还在任 = until 不给),fate = 怎么卸任的(见 PersonFate)
   */
  author?: number;
  /**
   * 君主的称号(去世以后才有;还在位 = 空串):东方 = 庙号("太祖""世宗")或谥号 + 爵("穆公""庄王",亡国之君"哀帝");
   * 西幻 = 同名君主的序数("三世")或"大帝"。称呼的写法见 peopleText.ts
   */
  title?: string;
  /**
   * 领兵打过的仗(君主亲征也记在这里)。作者的将领(任将):他挂帅的那几段 —— 同一场仗那一方推演原来派的统帅照旧在,编年史写成副将;
   * 那一刻统帅是亲征的君主的,君主为帅、他随驾(chronicle.ts 的 commander)
   */
  commands?: PersonCommand[];
  /**
   * 父亲(Person.id;女的父辈也记在这里,界面上写"母亲"):君主和宗室按世系(lineage.ts;一朝的第一位、共和国执政官没有,
   * 复国之君的是故国的宗室或末帝);将门、世家的将领、名臣是本国先前的一位将领、名臣(kin.ts);别的没有
   */
  parent?: number;
  /**
   * 复国之君出自故国哪位君主(from = Person.id,一般是末帝)、是他的第几代孙(gen:1 = 子、2 = 孙、3 = 曾孙……)。
   * 中间几代都在世系里(Person.parent 一路连上去)的和隔得太远、只补了一位父亲的(宗室远支)都记;别的人没有
   */
  descent?: { from: number; gen: number };
  /** parent 是养父(这人是收养的 / 过继的养子,见 royals.ts、lineage.ts);亲生的不给 */
  adopted?: true;
  /** 宗室在争储里被杀(fate purged):杀他的那位新君(Person.id) */
  rival?: number;
  /**
   * 君主:即位时诸子争储怎么了的(见 royals.ts),没争的不给。how:merit 以战功越过兄长得立、coup 举兵夺位杀了对手、
   * revolt 对手拥兵争位、兵败被杀,intrigue 谮杀对手得立、usurp 先君的儿子还在、他(兄弟、叔侄)杀了太子自立;
   * 宗室争位、据地自立的开国之君:secede(rivals = 即位的那位)。
   * 掌实权(regency.ts)来的:march 先君在位时引兵入朝、杀了对手掌权,先君去世后即位(rivals = 那时杀掉的兄弟;即位那一刻不另争储);
   * seize 摄政的叔父废了幼主自立(rivals = 被废的幼主)。
   * rivals = 越过的兄长 / 杀掉的对手 / 争位的对手(Person.id)
   */
  claim?: { how: 'merit' | 'coup' | 'revolt' | 'intrigue' | 'usurp' | 'secede' | 'march' | 'seize'; rivals: number[] };
  /** 掌过实权的几段(regency.ts;按先后):名义上的君主照旧在位,推演照他的倾向。没有 = 不给 */
  regencies?: PersonRegency[];
  /** 联姻娶的宗室女(marriage.ts;按先后)。没有 = 不给 */
  spouses?: PersonSpouse[];
  /**
   * 母亲(Person.id;consorts.ts):联姻嫁来的宗室女所生(父亲娶她以后出生、生在她 16–45 岁之间的子女),临朝的太后所辅的幼主。
   * 别的不给(世系只按父亲连,Person.parent)
   */
  mom?: number;
  /** 后妃:丈夫(Person.id;嫁来的宗室女 = 娶她的人,太后 = 幼主的父亲;找不到 = 不给)。临朝篡位做了女君的也有。别的不给 */
  husband?: number;
  /** 放逐到中立地 / 出奔中立地 / 出奔邻国(史事 exile;people.ts 照它填):没有 = 不给 */
  exile?: PersonExile;
  /** 作者改过名时,生成时的名字(稳定键按它算,见 gen/edits.ts 的 personKey);没改过 = 不给 */
  defaultName?: string;
  /** 字(名臣、将领;东方带姓的语感才有,见 officials.ts) */
  courtesy?: string;
  /** 号的后半("居士""山人";前半是籍贯的城名,officialText.ts 的 personArt 现拼:作者改了城名跟着变)。一部分名臣、将领有 */
  art?: string;
  /** 籍贯:生在哪座城(Settlement id;名臣、将领) */
  home?: number;
  /** 官职(名臣、将领;按先后,一直任到下一个的 from) */
  posts?: PersonPost[];
  /** 名臣经手的事(按先后,见 officials.ts) */
  deeds?: PersonDeed[];
}

/**
 * 掌实权的一段(regency.ts):
 * - kind:march 引兵入朝(先君在位、太子掌权)、heir 太子监国、uncle 宗室摄政(幼主的叔父)、minister 名臣辅政(幼主)、
 *   dowager 太后临朝(幼主的母亲;推演里是名臣辅政那一段,掌权的人换成了她,consorts.ts)、chancellor 大臣专权、general 大将专权
 * - from / until:从哪年到哪年(到结束年份还在掌权 = until 不给)
 * - ruler:名义上的君主(掌权开始时在位的那位,Person.id);大臣、大将专权跨了几位君主的,后几位按年份查在位表
 * - end:怎么结束的 —— succeed 先君去世、他即位(引兵入朝、太子监国)/ return 还政 / purged 伏诛 / usurp 篡位 /
 *   died 卒于位 / ruler 名义君主先去世、被废(掌权随之了结)/ fallen 改朝换代、亡国。还在掌权 = 不给
 * - annal:掌权那一条史事(regent,n = 0)的下标;endAnnal:还政、伏诛、篡位、卒那一条的下标(没有 = 不给)
 */
export interface PersonRegency {
  kind: 'march' | 'heir' | 'uncle' | 'minister' | 'dowager' | 'chancellor' | 'general';
  from: Year;
  until?: Year;
  ruler: number;
  end?: 'succeed' | 'return' | 'purged' | 'usurp' | 'died' | 'ruler' | 'fallen';
  annal: number;
  endAnnal?: number;
}

/**
 * 联姻的一门亲(marriage.ts;记在娶亲的人身上):
 * - polity:她出自哪国;father:她的父亲(那一刻那国在位的君主,Person.id;没有人物 = −1)
 * - name:东方带姓的语感 = 父姓 + 氏("风氏");别的语感 = 空串(界面写"某国公主")。有 person 的界面写她的名字
 * - year:结亲那年;peace:议和时以和亲作结的那场战争(没有 = 不给)
 * - annal:那条史事 marry 的下标
 * - person:嫁来的宗室女本人(后妃,Person.id;consorts.ts)。娶亲的是女的(她嫁过去,对方是宗室子,只记一行)、作者立的君主 = 不给
 */
export interface PersonSpouse {
  polity: number;
  father: number;
  name: string;
  year: Year;
  peace?: number;
  annal: number;
  person?: number;
}

/**
 * 人物被放逐到中立地 / 出奔中立地 / 出奔邻国(treaties.ts、exile.ts):
 * how:heir 争储失势的宗室,新君把他徙过去;deposed 被废的末代之君徙过去;fled 国亡、亡国之君出奔过去。
 * annal = 那条史事 exile 在 Civ.annals 里的下标;zone = 中立地的编号(史事 neutral 的 war 列;出奔邻国的 = −1);
 * region = 中立地那州(出奔邻国的:那国当时的国都所在州);
 * year = 放逐 / 出奔的年份;by = 徙他的君主(Person.id;出奔、找不到 = 不给);
 * until = 中立地撤销的年份(那时还活着的回本国;撤销以前去世的是卒于中立地;到结束年份还在 = 不给;出奔邻国的不给,他在那国终老);
 * to = 出奔去的国家(Polity.id;只有出奔邻国的给);tie = 投奔那国的缘由(见 ExileTie;只有出奔邻国的给)
 */
export interface PersonExile {
  how: 'heir' | 'deposed' | 'fled';
  annal: number;
  zone: number;
  region: number;
  year: Year;
  by?: number;
  until?: Year;
  to?: number;
  tie?: ExileTie;
}

/**
 * 亡国之君投奔邻国的缘由(exile.ts 按这个先后挑):kin 两国结着亲(姻亲)、ally 结着盟、pact 同在一份约里、folk 同族(立国的民族相同)、
 * foe 那国和灭他的国家敌对(正交战、近年打过仗、方针里当它仇国)、near 别的邻国
 */
export type ExileTie = 'kin' | 'ally' | 'pact' | 'folk' | 'foe' | 'near';
/** 史事 exile(出奔邻国)的 Annal.n 是这里的下标 */
export const EXILE_TIES: readonly ExileTie[] = ['kin', 'ally', 'pact', 'folk', 'foe', 'near'];

/** 一任官职:官名、哪一年起 */
export interface PersonPost {
  title: string;
  from: Year;
}

/**
 * 名臣经手的一件事(officials.ts):kind 见那里的文件头;
 * annal = 史事下标(劝进、迁都、议和);person = 相关的君主(佐命的开国之君、辅政的幼主、专权时在位的、劝进时在位的、拥立的新君);
 * until = 辅政、专权到哪一年;upheaval = 第几件地形大事(赈灾)
 */
export interface PersonDeed {
  kind: 'found' | 'regent' | 'rank' | 'enthrone' | 'capital' | 'relief' | 'peace' | 'war' | 'defend' | 'power';
  year: Year;
  annal?: number;
  person?: number;
  until?: Year;
  upheaval?: number;
}

/** 一次领兵:哪场战争、哪一方、任期 */
export interface PersonCommand {
  war: number;
  /** 0 = 攻方(宣战的一方),1 = 守方 */
  side: 0 | 1;
  from: Year;
  until: Year;
  /**
   * 经手的第一件、最后一件事在 Civ.annals 里的下标(宣战,或者那场战争里的战役、攻占)。
   * 同一刻接连几件事中途换了人(上一位战死)时,靠它分清哪一件是谁打的
   */
  first: number;
  last: number;
  /**
   * 据险断后(史事 stand,first = last = 那一条):这一回不是统帅,是败退时留下守关隘的那支兵的守将。
   * 编年史找统帅时不算它;不是 = 不给
   */
  rear?: true;
}

/**
 * 人物的结局:
 * - 君主:died 寿终、murdered 遇弑、deposed 被权臣所废(改朝换代)、overthrown 新朝起兵、死于兵乱、
 *   fell 亡国殉国、surrendered 亡国出降、fled 亡国出奔(国家瓦解也算)、merged 国并入他国(归附)、retired 共和国执政官任满、
 *   yielded 让位给作者立的君主(干预"即位")
 *   作者立的君主(Person.author):到期下台写 retired(退位),在位时改朝换代写 deposed,亡国只写 surrendered / fled,
 *   被后来作者立的君主取代写 yielded
 * - 统帅:died 寿终、battle 战死;掌实权的大将伏诛 purged(Person.rival 是诛他的君主)
 * - 宗室:died 寿终、battle 领兵战死、purged 争储被杀(Person.rival 是杀他的新君)/ 摄政的叔父伏诛(Person.rival 是亲政的幼主)
 * - 名臣:掌实权伏诛 purged
 * - 君主:被摄政的叔父废了(regents.ts)也是 deposed
 * - 作者的将领、名臣(干预"任将 / 任臣",Person.author;不写卒年,结局只说怎么卸任的):retired 到期卸任(卸任年、卸甲致仕的岁数)/
 *   died 到人物卡的卒年(卒于任上、卒于军中)/ surrendered 亡国出降 / fled 亡国出奔 / merged 随国归附 / deposed 改朝换代去职(名臣)/
 *   yielded 又任了别的、即了位
 */
export type PersonFate = 'died' | 'murdered' | 'deposed' | 'overthrown' | 'fell' | 'surrendered' | 'fled' | 'merged' | 'retired' | 'battle' | 'yielded' | 'purged';

/**
 * 君主的倾向(rulers.ts):各 0–100,50 是寻常,越高越容易做对应的事 ——
 * expand 开拓(偏远、贫瘠的地方也去开垦)、war 好战(容易开战、仗打得久、不肯称臣、亲征)、
 * develop 发展(重视领地内的建设;还不影响推演)、trade 重商(看重沿海、大河、港口)
 */
export interface RulerLeanings {
  expand: number;
  war: number;
  develop: number;
  trade: number;
}

/**
 * 君主怎么即位的:found 立国、rebel 叛离自立(分裂)、restore 复国(故国王室之后)、usurp 权臣篡位、rise 起兵代之(改朝换代)、heir 继位、
 * crown 作者立的(干预"即位",Person.author 是那个人物)、reform 改制(reform.ts)开的那一段的第一位:改共和后的首任执政、
 * 政变的将军、革命起兵的人、复辟迎立的君主 / 自立为君的执政
 */
export type RulerRise = 'found' | 'rebel' | 'restore' | 'usurp' | 'rise' | 'heir' | 'crown' | 'reform';

/**
 * 一颗星球(没改地形)定下的、改过地形的世界沿用的两个数(index.ts 的 planetTempo):
 * 按整个世界标定的数要是按改后的地形重算,远海放一座小岛也会让全世界的历史错开
 */
export interface PlanetTempo {
  /** 扩张节拍:民族走一个"标准路程"要几年(不含 pace;cultures.ts 的 calibrate) */
  spread: number;
  /** 城的人口上限按这个数折算(polities.ts 的 capacityNorm) */
  capNorm: number;
}

/**
 * 推文明的底子:宜居度和州(index.ts 的 civBase;generateCiv 的头两步)。
 * 只跟地形(world)、文明种子、每州目标面积有关,和干预、拓荒、起源、地名风格、推演年数……都无关:
 * 调用方留着一份,改了这些重推时经 CivParams.base 传回去,省得每次重算
 */
export interface CivBase {
  /** 按哪个世界算的(generateCiv 只在传进来的是同一个世界对象时用它) */
  world: World;
  /** 划州用的文明种子(CivParams.civSeed;没给 = 地图种子) */
  seed: number;
  /** 划州用的每州目标面积(CivParams.regionArea) */
  regionArea: number;
  /** 划州用的那张旋钮表(regions.ts 的 REGIONS_KNOBS 在这个世界的那套数里的值;对不上也不用) */
  regionKnobs: Readonly<Record<string, KnobValue>>;
  habitat: Habitat;
  regions: Regions;
}

export interface CivParams {
  /** 文明史长度(年),默认 3000 */
  endYear: Year;
  cultures: number | 'auto';
  polities: number | 'auto';
  /** 每州目标面积(世界单位²)。默认约 900 个州(陆地比例 33% 时) */
  regionArea: number;
  /** 扩张快慢总系数 */
  pace: number;
  /** 民族诞生年份的跨度(年):第一个民族在第 0 年,其余在这么多年里陆续出现。默认 400;0 = 同时诞生 */
  birthSpan?: number;
  /** 阶段 4 干预(gen/edits.ts 的 Intervention;推演前先清理)。不给 / 空 = 不干预 */
  interventions?: readonly Intervention[];
  /**
   * 改过地形的世界用的扩张节拍和城的人口折算:planetTempo(同样的世界参数)的结果,调用方缓存了传进来,省得每次多生成一遍没改过的地形;
   * null = 没改过的星球长不出文明(按这个世界自己标定)。不给 = 现算。没改地形的世界不看它
   */
  tempo?: PlanetTempo | null;
  /**
   * 地形大事(upheaval.ts 的 upheavalSteps 排好、生成好的):按年份排(同一年已合成一件),各带改后的世界
   * (第 k 件 = 原来的地形套上前 k 件大事的修改)。不给 / 空 = 没有。年份不在 (0, endYear) 里的不算
   */
  upheavals?: readonly import('./upheaval').UpheavalStep[];
  /**
   * 整个世界的地名风格(gen/names 的 NameMix):每种语感占几份,各民族只在有份的几种里挑、占的地方尽量合比例。
   * 不给 / 一份都没有 = 自动:每个民族按发源地从全部语感里挑(和没有这一项逐字节一样)。只管起名,不改历史
   */
  names?: import('../names').NameMix;
  /** 拓荒:民族扩散、国家扩张快慢,各种地形难走的程度(frontier.ts;推演前先清理)。不给 = 默认(和没有这一项逐字节一样) */
  frontier?: import('./frontier').Frontier;
  /** 自选的文明起源(frontier.ts 的 Origins;推演前先清理)。不给 = 自动挑发源地(和没有这一项逐字节一样) */
  origins?: import('./frontier').Origins;
  /**
   * 「天灾」:多 / 很多(calamity.ts):瘟疫、饥荒更多更重,各国会自己闹地震水旱,世上有国家能远洋以后会自己起全球大疫(pandemic.ts)。
   * 不给 = 平常(和没有这一项逐字节一样)
   */
  calamity?: import('./calamity').Calamity;
  /**
   * 文明种子:推演里的随机数(州、民族、国家、人物、名字、旗……)都从它取,地图的随机数照旧从 world.params.seed 取。
   * 不给 = 等于地图种子(和没有这一项逐字节一样)。
   * 给了的是"在一张地图上新开的一段历史":改过地形的世界,扩张节拍和城的人口折算也按这张地图本身标定(不看 tempo,不另生成没改地形的星球)
   */
  civSeed?: number;
  /**
   * 预先算好的宜居度和州(index.ts 的 civBase):世界、文明种子、每州面积都对得上才用(用的是复制的一份,传进来的不改,
   * 也不会出现在推出来的 Civ 里);对不上 / 不给 = 现算。用不用结果都逐字节一样,只省时间
   */
  base?: CivBase;
  /**
   * 改过地形的世界,山海湖岛的地名照没改过地形的同一颗星球起(official.ts 的 nameRefOf)。false = 不照着起:
   * 照原样打开的旧版本世界,按现在的生成器生成的"没改过的星球"不一定是它原来那一颗。不给 = 照着起;没改过地形的世界不看它
   */
  placeRef?: false;
  /**
   * 这个世界的一套数(engine/knobs.ts):推演里各子系统"调参"那一段的数,只写和官方不一样的项(表 id → 项名 → 值;推演前先清理,
   * 认不出的表、项,值不合用的当没有)。不给 / 清理完是空的 = 官方(和没有这一项逐字节一样)。
   * 接着推(continueCiv、startContinue)时不给 = 照 civ 带着的那一套
   */
  knobs?: KnobPatch;
}

/**
 * 推演之后定下的名字、配色里要"钉住"的(地形大事,见 upheaval.ts):大事那一年以前已经有的民族、州、国家、城、王朝,
 * 名字和配色照没有这件大事时的那份历史 —— 起名、配色本来看整段历史(结束时的疆域、历来的邻国),不钉住的话,
 * 大事之后的历史一变,之前的名字也会跟着变。钉住的先占上,新出现的照常起名、配色,不和它们撞
 */
export interface NamePins {
  /**
   * 民族:族名、语感、配色(推演前就定了的整份钉住;推演中分化出来的,大事以前就有的才钉)。
   * 键是 cultureKey(不是编号:大事以后分化出几支不一定,排在后面的干预立国民族编号会跟着挪)
   */
  cultures?: Map<string, { name: string; style: string; autoStyle?: string; color: [number, number, number] }>;
  /** 州名(下标 = 州;没有 = 不钉) */
  regionNames: (string | undefined)[];
  /** 国家:国名词根、配色、东方语感;dynasties = 各朝的朝名(下标 = Polity.dynasties 的下标;没有 = 不钉) */
  polities: Map<number, { name?: string; color?: [number, number, number]; dynasties: (string | undefined)[] }>;
  /** 城名 */
  settlements: Map<number, string>;
}

// ---- 对外函数的签名(实现分别在 index.ts / timeline.ts / polities.ts) ----

export type GenerateCiv = (world: World, p?: Partial<CivParams>, progress?: Progress) => Civ;
/** 任意年份的归属(最近检查点 + 补日志);out 可复用,避免分配 */
export type OwnersAt = (
  civ: Civ,
  year: Year,
  out?: { culture: Int16Array; polity: Int16Array },
) => { culture: Int16Array; polity: Int16Array };
export type PopulationAt = (s: Settlement, year: Year) => number;
