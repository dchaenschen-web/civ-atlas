/**
 * 官方推演的事件种类:编号(变化日志的 cause 用同一套编号)、名字、要不要核对版本号、同一刻里排在哪。
 * 引擎(engine/sim.ts)不认识这些种类,一口气推、接着推时把 CIV_EVENTS 登记给它。
 * 编号和同一刻的次序是历史的一部分:改了,同一种子的历史就变了。
 */
import type { AnnalSchema, EventKind } from './engine/sim';
import { ANNAL_EXTRAS } from './types';

// ---------------------------------------------------------------------------
// 事件类型编号表(变化日志的 cause 用同一套编号;阶段 3 从 7 往下接着编:战争 7–9,分合 10–14,王朝更替 15–19(新君即位 16),
// 民族同化与迁徙 20–24,城市兴衰 25–29;阶段 4 干预 30–35;邦交 40–44)

export const enum Ev {
  /** 没有原因(初始状态) */
  None = 0,
  /** 民族诞生:a = 发源州,b = 民族。发源州已被别族占了,就近找一个空的可居州 */
  CultureBorn = 1,
  /** 民族到达:a = 州,b = 民族。州还没人住就归属这个民族;不可居的州只是路过 */
  CultureArrive = 2,
  /** 建城(polities.ts):a = 州,b = 城镇 */
  SettlementFound = 3,
  /** 立国(polities.ts):a = 国都所在州,b = 国家 */
  PolityFound = 4,
  /** 国家到达(polities.ts):a = 州,b = 国家。州有人住、还没归别国,就归这个国家 */
  PolityArrive = 5,
  /** 升格(polities.ts):a = 国都所在州,b = 国家。国土跨过一档(部 → 国 → 王国 → 帝国),国号升一级,记进 Polity.titles */
  PolityRank = 6,
  /**
   * 看邻国(阶段 3 战争,wars.ts):a = 立国后第几次看(按年份段编号),b = 国家。
   * 国家隔几十年看一眼接壤的邻国:国力比、扩张性、是不是异族、上次议和过了多久,决定要不要宣战
   */
  WarCheck = 7,
  /**
   * 战役(wars.ts):a = 这场战争的第几仗,b = 战争编号。攻方打一个和自己国土接壤的敌州,
   * 打不下来守方可能反攻、夺回这场战争里丢的州;打完看要不要议和,不议和就预约下一仗
   */
  Campaign = 8,
  /** 攻占(wars.ts):不单独预约,是战役里改归属(setOwner)时变化日志记的原因 */
  Conquer = 9,
  /**
   * 看内政(阶段 3 分合,politics.ts):a = 立国后第几次看(按年份段编号),b = 国家。
   * 国家隔几十年看一眼自己:边远的州会不会起兵自立(分裂)、国都要不要迁到国土中部(主动迁都)、
   * 小国会不会并入接壤的同族大国(合并)
   */
  PoliticsCheck = 10,
  /** 分裂 / 复国(politics.ts):不单独预约,是起兵自立的州改归新国家时变化日志记的原因 */
  Split = 11,
  /** 合并(politics.ts):不单独预约,是小国的州并入大国时变化日志记的原因 */
  Merge = 12,
  /**
   * 看复国(politics.ts):a = 亡国后第几次看,b = 亡国的国家。故国国都一带仍是同族人住、
   * 当前的宗主又弱(在打仗 / 刚分裂 / 刚迁都)时,遗民举旗复国
   */
  RestoreCheck = 13,
  /**
   * 看部落地带(politics.ts):a = 第几次看。阶段 2 里因为离别国国都太近没能立国的城,
   * 那个国都灭亡 / 迁走以后,在这里再试一次立国
   */
  TribalCheck = 14,
  /**
   * 看王朝(阶段 3 王朝更替,dynasty.ts):a = 立国后第几次看(按年份段编号),b = 国家。
   * 大国隔几十年看一眼:当朝立了多久(越久越容易亡)、国势动荡(战败失地、国都失守、刚分裂),决定会不会改朝换代。
   * 改朝换代不改归属(同一个国家编号),新朝定都根据地时迁都
   */
  DynastyCheck = 15,
  /**
   * 新君即位(polities.ts;在位表见 rulers.ts):a = 本国第几位君主,b = 国家。门槛比上一位低的(扩张算账),
   * 从现有国土往外重新看一遍边上的部落地带;再预约下一位。改朝换代后在位表重排,对不上的丢掉
   */
  Reign = 16,
  /** 迁都的下一刻(polities.ts 的 moveCapital):b = 国家。按新国都的路程从现有国土往外重新预约扩张 */
  Respread = 17,
  /**
   * 航海时代(polities.ts):这一刻起,有港口的普通国家也能沿航线往海外扩张(海洋国家从来就能)。
   * 在世的普通国家这一刻从现有国土往外重新预约一遍扩张(同一刻里排在地形大事后面、别的事件前面)
   */
  AgeOfSail = 18,
  /**
   * 看民族(阶段 3 同化与迁徙,assimilation.ts;编号 20–24):a = 立国后第几次看(按年份段编号),b = 国家。
   * 国家隔几十年看一眼治下的各州:异族州被统治久了、离核心近、四周同族多,就改换成统治民族(同化);
   * 统治民族太少时反过来被多数民族同化;这些年打下来的州,游牧民族会迁人进来,被征服的民族会外迁
   */
  CultureCheck = 20,
  /** 同化(assimilation.ts):不单独预约,是一州改换民族时变化日志记的原因 */
  Assimilate = 21,
  /** 迁徙(assimilation.ts):不单独预约,是迁入的州改换民族时变化日志记的原因 */
  Migrate = 22,
  /**
   * 看孤地(assimilation.ts):a = 第几次看。每隔几十年看一眼部落地带(没有国家的州)里被别族团团围住的孤地:
   * 久了会被四邻同化(日志原因记 Assimilate)
   */
  EnclaveCheck = 23,
  /**
   * 看重建(阶段 3 城市兴衰,cities.ts):a = 城被毁后第几次看,b = 被毁的城。
   * 州里有人住、战火已息,就有机会在故址上重建一座新城;看够次数都没建 = 就此荒废
   */
  CityRebuild = 25,
  /**
   * 看旧都(cities.ts):a = 这座城的第几段国都(Settlement.capitalSpans 的下标),b = 城。
   * 失去国都之位约一百多年后,人口明显回落的记一条"旧都渐衰"
   */
  CityDecline = 26,
  /**
   * 干预(阶段 4,interventions.ts;编号 30–35):a = 第几条干预(干预列表的下标)。在它的年份(from)那一刻生效:
   * 记一条史事 intervene,结盟时正在交战的两国当即议和,宣战的强制开战,划州、立国、迁都当即改归属 / 国都,
   * 不许扩张的国家挑起的战争当即议和。在所有别的事件之前预约(同一刻里只排在 earlyOrder 那几类后面)
   */
  Intervene = 30,
  /** 划州(interventions.ts):不单独预约,是干预"划州"(和立国时带走的余州)改归属时变化日志记的原因 */
  Cede = 31,
  /**
   * 不许扩张到期(interventions.ts):a = 第几条干预。到 until 那一刻,这国从现有国土重新预约往外扩张
   * (禁令期间的"国家到达"都丢掉了)。在所有别的事件之前预约(同一刻里比干预事件还早)
   */
  HaltEnd = 32,
  /**
   * 地形大事(upheaval.ts):a = 第几件大事。在它的年份那一刻(同一刻里最先)处理后果:城沉入海 / 毁于火山,
   * 淹掉的州国家和民族撤出(变化日志原因也记这个),国都没了的迁都、亡国
   */
  Upheaval = 33,
  /**
   * 多看一眼(interventions.ts):a = 第几条干预(照大纲顺着引的方针,带 look),b = 它的第几眼。
   * 到那一年的年中替那国多看一眼邻国 / 内政 / 王朝(随机数按 LOOK_K 往上的"第几次"取,不接着预约)。装各层时就预约
   */
  Look = 34,
  /**
   * 看邦交(diplomacy.ts;编号 40–44):a = 立国后第几次看(按年份段编号),b = 国家。
   * 国家隔几十年看一眼:藩属要不要自立、宗主收不收藩属的国土、盟约废不废、畏不畏强邻(称臣 / 结盟)
   */
  DiplomacyCheck = 40,
  /**
   * 约满(立约,treaties.ts):a = 约的编号。立约 / 续约那一刻预约在期满那一刻:看几国续不续约,不续就约废、中立地撤销
   */
  TreatyEnd = 41,
  /** 中立地(treaties.ts):不单独预约,是一州划为中立地(归属 → −1)、中立地撤销还给原主时变化日志记的原因 */
  Neutral = 42,
  /** 中立地到期(treaties.ts):a = 中立地的编号。作者下令划的中立地选了"到某一年",划的那一刻预约在那一年:撤销 */
  ZoneEnd = 43,
  /**
   * 看分化(民族分化,assimilation.ts;编号 45–49):a = 第几次看。每隔一百年看一眼各民族:被海峡、山脉隔开,
   * 或分属不同国家几百年的一支,有机会分化成新民族(亲缘民族,族名带母族的名字)
   */
  DivergeCheck = 45,
  /** 分化(assimilation.ts):不单独预约,是分出去的州改换成新民族时变化日志记的原因 */
  Diverge = 46,
  /**
   * 发展度(development.ts;编号 50):每 20 年一刻,算各州的五种能力、时代、物产,再让它们影响推演
   * (城的人口上限、打仗的军力、普通国家能不能远洋)。同一刻里排在地形大事、航海时代后面,别的事件前面(见 earlyOrder)
   */
  DevTick = 50,
  /**
   * 政局的数表(control.ts;编号 51):每年一刻,按此刻的归属、国都、行政能力、危机……算各州管得到几成、离国都多远、各国的动荡,
   * 这一年里的事件读它。同一刻里排在发展度后面(读这一刻刚算的行政能力),别的事件前面(见 earlyOrder)
   */
  TableTick = 51,
  /**
   * 掌实权(regency.ts;编号 52):b = 国家。到那一刻办这国的事:掌着权的人到期了办结局(还政、伏诛、篡位、卒),
   * 君主晚年该有的引兵入朝、太子监国看成不成。重复预约、预约了却对不上的什么都不做。
   * 同一刻里排在看王朝、新君即位、迁都后重看边地后面(同一国),别的事件前面(见 earlyOrder)
   */
  Regency = 52,
  /**
   * 看年景(动荡、饥荒、民变、大崩解,unrest.ts;编号 55–57):a = 第几次看。每隔十来年,世上几处闹灾年(干旱、寒冷的地方多),
   * 人口顶到上限的城闹饥荒、人口掉一截;闹了饥荒又动荡的大国,饥民可能起事(民变)
   */
  FamineCheck = 55,
  /** 散回部落(unrest.ts 的大崩解):不单独预约,是大国崩解时散回部落地带的州(国家归属 → −1)变化日志记的原因 */
  Collapse = 57,
  /**
   * 看疫情(瘟疫,plague.ts;编号 58–59):a = 第几次看。每隔几十年看一次,偶尔从一座大城或港口起疫
   */
  PlagueCheck = 58,
  /** 疫情传开(plague.ts):a = 第几场瘟疫(起疫那次看疫情的编号),b = 起疫后第几年。染疫的州往外传一圈,预约下一年 */
  PlagueStep = 59,
  /**
   * 看全球大疫(pandemic.ts;编号 60–62):a = 第几次看。只有「天灾」设成多、很多的世界才有:世上有国家能远洋以后,
   * 隔几十年看一次,偶尔从一座大港起一场全球大疫
   */
  PandemicCheck = 60,
  /** 疫后凋敝(pandemic.ts):这一刻有全球大疫"疫气复作"(人口再掉一截、村镇荒废)。同一刻几场一起处理 */
  SlumpStep = 61,
  /** 看地震水旱(pandemic.ts):a = 第几次看。只有「天灾」设成多、很多的世界才有:各国偶尔闹一场地震、大水、大旱 */
  QuakeCheck = 62,
  /**
   * 看大迁徙(migration.ts;编号 63–64):a = 第几次看。每隔几十年看一眼草原、寒地的民族:老家挤、闹灾年、本族的国刚散了(推),
   * 走得到的地方有大乱、疫后空了、富庶的地(拉),就可能分出一支举族远走(一次看最多走一支)
   */
  TrekCheck = 63,
  /** 迁徙的队伍走到路线上的下一州(migration.ts):a = 第几次大迁徙(Civ.migrations 的下标),b = 路线上的第几州;最后一州 = 落脚立国 */
  TrekStep = 64,
  /** 落脚(migration.ts):不单独预约,是大迁徙落脚的几州改换成迁来的民族时变化日志记的原因 */
  TrekSettle = 65,
  /**
   * 看地质(geoEvents.ts):按板块边界的活跃度掷地震 / 火山。只在开了星球系或改了地质活跃度的世界才装;
   * 默认参数的世界不装这个模块,历史逐字节不变
   */
  GeoCheck = 66,
  /** 看陨星撞击(impactEvents.ts):C 方案——推演里只记效应,地形结算在推演后。默认不装 */
  ImpactCheck = 67,
}

/**
 * 官方推演里同一刻排在最前面的几类(登记在下面 CIV_EVENTS 的 order 里;引擎怎么排见 engine/sim.ts 的 EventOrder):
 * - 地形大事 = 0:同一刻的别的事都按大事以后的地形和归属算(一次推演里只有一件,见 run.ts)
 * - 航海时代 = 1:同一刻的别的事都按"已经能走航线"算(polities.ts 的 sailsOcean)
 * - 发展度 = 2:只读这一刻以前的事;它改的人口上限、军力、远洋,同一刻的别的事都按改过的算(接着推时按 Civ 里存的状态接上)
 * - 政局的数表 = 3:按发展度刚算的行政能力算;同一刻的别的事都读它算出来的值
 * - 看王朝、新君即位、迁都后重看边地、掌实权 = 4 起:按国家号,同一国依次是看王朝、即位、重看、掌实权。
 *   看王朝在前:同一刻改朝换代了,旧朝原定这一刻即位的那位就不即位了(在位表重排,Ev.Reign 对不上就丢掉);
 *   即位、重看只从现有国土往外预约扩张、不改归属,排在别的事件前面 —— 接着推时 resumePolities 也是在同一刻的日志
 *   (大事改的归属除外)之前重放。掌实权的事从下一刻起才算数(regents.ts),同一国同一刻预约几次也只办一回
 * - 看地震水旱、看全球大疫、疫后凋敝、看疫情、疫情传开 = EARLY_SPAN − 5 … − 1(这几类之后、别的事件之前):接着推时它们最后才补进引擎,
 *   排在固定的位置,同一刻的别的事件(攻占、毁城)在它前还是在它后,和一口气推完一样(同一刻每类至多一件)
 * 不是这几类的,按预约先后;民族、国家到达(CultureArrive、PolityArrive)排在同一刻最后,民族先、国家后,再按州号、民族 / 国家号
 */
export const CIV_EVENTS: readonly EventKind[] = [
  { id: Ev.None, name: '无', watch: false },
  { id: Ev.CultureBorn, name: '民族诞生', watch: false },
  { id: Ev.CultureArrive, name: '民族到达', watch: true, order: { arrival: 0 } },
  { id: Ev.SettlementFound, name: '建城', watch: false },
  { id: Ev.PolityFound, name: '立国', watch: false },
  { id: Ev.PolityArrive, name: '国家到达', watch: true, order: { arrival: 1 } },
  { id: Ev.PolityRank, name: '升格', watch: false },
  { id: Ev.WarCheck, name: '看邻国', watch: false },
  { id: Ev.Campaign, name: '战役', watch: false },
  { id: Ev.Conquer, name: '攻占', watch: false },
  { id: Ev.PoliticsCheck, name: '看内政', watch: false },
  { id: Ev.Split, name: '分裂', watch: false },
  { id: Ev.Merge, name: '合并', watch: false },
  { id: Ev.RestoreCheck, name: '看复国', watch: false },
  { id: Ev.TribalCheck, name: '看部落地带', watch: false },
  { id: Ev.DynastyCheck, name: '看王朝', watch: false, order: { perPolity: 0 } },
  { id: Ev.Reign, name: '新君即位', watch: false, order: { perPolity: 1 } },
  { id: Ev.AgeOfSail, name: '航海时代', watch: false, order: { early: 1 } },
  { id: Ev.CultureCheck, name: '看民族', watch: false },
  { id: Ev.Assimilate, name: '同化', watch: false },
  { id: Ev.Migrate, name: '迁徙', watch: false },
  { id: Ev.EnclaveCheck, name: '看孤地', watch: false },
  { id: Ev.CityRebuild, name: '看重建', watch: false },
  { id: Ev.CityDecline, name: '看旧都', watch: false },
  { id: Ev.Intervene, name: '干预', watch: false },
  { id: Ev.Cede, name: '划州', watch: false },
  { id: Ev.HaltEnd, name: '解除禁扩', watch: false },
  { id: Ev.Upheaval, name: '地形大事', watch: false, order: { early: 0 } },
  { id: Ev.Look, name: '多看一眼', watch: false },
  { id: Ev.DiplomacyCheck, name: '看邦交', watch: false },
  { id: Ev.TreatyEnd, name: '约满', watch: false },
  { id: Ev.Neutral, name: '中立地', watch: false },
  { id: Ev.ZoneEnd, name: '中立地到期', watch: false },
  { id: Ev.DivergeCheck, name: '看分化', watch: false },
  { id: Ev.Diverge, name: '分化', watch: false },
  { id: Ev.DevTick, name: '发展度', watch: false, order: { early: 2 } },
  { id: Ev.TableTick, name: '政局', watch: false, order: { early: 3 } },
  { id: Ev.Regency, name: '掌实权', watch: false, order: { perPolity: 3 } },
  { id: Ev.FamineCheck, name: '看年景', watch: false },
  { id: Ev.Collapse, name: '散回部落', watch: false },
  { id: Ev.PlagueCheck, name: '看疫情', watch: false, order: { earlyEnd: 2 } },
  { id: Ev.PlagueStep, name: '疫情传开', watch: false, order: { earlyEnd: 1 } },
  { id: Ev.PandemicCheck, name: '看全球大疫', watch: false, order: { earlyEnd: 4 } },
  { id: Ev.SlumpStep, name: '疫后凋敝', watch: false, order: { earlyEnd: 3 } },
  { id: Ev.QuakeCheck, name: '看地震水旱', watch: false, order: { earlyEnd: 5 } },
  { id: Ev.TrekCheck, name: '看大迁徙', watch: false },
  { id: Ev.TrekStep, name: '迁徙的队伍', watch: false },
  { id: Ev.TrekSettle, name: '迁徙落脚', watch: false },
  { id: Ev.GeoCheck, name: '看地质', watch: false, order: { earlyEnd: 6 } },
  { id: Ev.ImpactCheck, name: '看陨星', watch: false, order: { earlyEnd: 7 } },
  // 迁都后重看边地:原来没写进这张表(核对版本号 = 否,和没登记时一样),同一刻里按国家排的次序要登记在这里
  { id: Ev.Respread, name: '迁都后重看边地', watch: false, order: { perPolity: 2 } },
];

/** 官方推演的史事:记的时候可有可无的几列照 ANNAL_EXTRAS 的次序抄 */
export const CIV_ANNALS: AnnalSchema = { extras: ANNAL_EXTRAS };
