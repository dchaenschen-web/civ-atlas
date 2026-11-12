/**
 * 官方规则包(OFFICIAL_PACK):事件、史事、旋钮、数表、子系统清单,和总流程要走的几步(official.ts)。
 *
 * 引擎(engine/)只管事件堆、归属、日志、史事、检查点,不认识任何子系统;每个子系统在自己的文件里导出一个模块对象
 * (engine/module.ts 的样子),这里按次序排好,总流程(run.ts)照包走:
 *   - 一口气推:开头几步(定民族、国家两个模型、最先预约干预的事件)以后,照 CIV_MODULES 的次序逐个 install
 *   - 接着推:引擎先照 Civ 里它自己那几样恢复,再照同一个次序逐个 resume
 *   - 推到一半拼结果:照 CIV_PARTIAL 的次序逐个 partial;推完:照 CIV_FINISH 的次序逐个 finish
 * 同一刻的事件按装的先后排,所以次序是历史的一部分:改了次序,同一种子的历史就变了。
 * 加一个子系统 = 在它的文件里写一个模块对象,加进下面的清单(要往结果上补东西的,也加进 CIV_PARTIAL / CIV_FINISH)。
 */
import type { World } from '../world';
import type { Intervention } from '../edits';
import type { Civ, Culture, Habitat, Regions, Year } from './types';
import type { CivSim } from './engine/sim';
import type { SimModule } from './engine/module';
import type { TableGroup } from './engine/pack';
import { culturesModule, type CultureModel } from './cultures';
import { politiesModule, type PolityModel } from './polities';
import { warsModule } from './wars';
import { politicsModule } from './politics';
import { dynastyModule } from './dynasty';
import { assimilationModule } from './assimilation';
import { citiesModule } from './cities';
import { diplomacyModule } from './diplomacy';
import { developmentModule, devCardsOf } from './development';
import { ideologyModule, ideoTableCards } from './ideology';
import { tradeModule } from './trade';
import { unrestModule } from './unrest';
import { controlModule, stateCardsOf } from './control';
import { councilModule } from './council';
import { regencyModule } from './regency';
import { marriageModule } from './marriage';
import { plagueModule } from './plague';
import { pandemicModule } from './pandemic';
import { treatiesModule } from './treaties';
import { migrationModule } from './migration';
import { religionModule, type FaithEra } from './religion';
import { interventionsModule, type InterventionModel } from './interventions';
import { geoEventsModule } from './geoEvents';
import { impactEventsModule } from './impactEvents';
import type { Calamity } from './calamity';
import { CIV_ANNALS, CIV_EVENTS } from './events';
import { CIV_KNOBS } from './knobs';
import { TABLE_GROUP } from './tableGroups';
import { OFFICIAL_STEPS, type OfficialOwn } from './official';
import { resumePack, type CivPack } from './run';

/** 一口气推时装模块拿到的东西 */
export interface InstallCtx {
  sim: CivSim;
  world: World;
  habitat: Habitat;
  regions: Regions;
  /** 文明种子 */
  seed: number;
  /** 民族模型、国家模型(没有能住人的地 = null:各模块照原样不装) */
  cm: CultureModel | null;
  pm: PolityModel | null;
  /** 干预(没有国家模型 = null) */
  iv: InterventionModel | null;
  /** 「天灾」设定(平常 = undefined);接着推时照 Civ.calamity */
  calamity: Calamity | undefined;
}

/** 接着推时重建模块拿到的东西 */
export interface ResumeCtx {
  sim: CivSim;
  world: World;
  civ: Civ;
  /** 接着推时带着的干预 */
  interventions: readonly Intervention[];
  iv: InterventionModel | null;
  /** 地形大事以前各段的州(信仰照历史重放时用) */
  eras: readonly FaithEra[];
  /** 地形大事以后补备的新民族(民族模块 resume 时填,国家模块 resume 时读) */
  extra: Culture[];
}

/** 推完往结果上补东西时拿到的东西 */
export interface FinishCtx {
  sim: CivSim;
  world: World;
  endYear: Year;
  regions: Regions;
  /** 拼好的结果(起好了名、排好了人物);模块往上补自己的那一份 */
  civ: Civ;
}

export type CivModule = SimModule<InstallCtx, ResumeCtx, FinishCtx>;

/**
 * 装、接着推的次序:先民族,再城镇和国家,再战争,再分合,再王朝,再同化与迁徙,
 * 再城市兴衰 —— 它要挂在战争模型上(攻城)、要国家模型的迁都回调;再邦交 —— 要挂在战争模型上;……;最后干预
 */
export const CIV_MODULES: readonly CivModule[] = [
  culturesModule,
  politiesModule,
  warsModule,
  politicsModule,
  dynastyModule,
  assimilationModule,
  citiesModule,
  diplomacyModule,
  developmentModule,
  ideologyModule,
  tradeModule,
  unrestModule,
  controlModule,
  councilModule,
  regencyModule,
  marriageModule,
  plagueModule,
  pandemicModule,
  treatiesModule,
  migrationModule,
  religionModule,
  interventionsModule,
  // 地质事件(默认不装:只有开了星球系或改了地质活跃度的世界才装,见 geoEvents.ts 文件头)
  geoEventsModule,
  // 陨星撞击(默认不装:只有开了星球系且小行星带/陨击频率开了的世界才装,见 impactEvents.ts 文件头)
  impactEventsModule,
];

/** 推到一半拼结果时往上补的次序(接着推要用的全精度状态) */
export const CIV_PARTIAL: readonly CivModule[] = [developmentModule, ideologyModule, tradeModule];

/** 推完往结果上补东西的次序:信仰要整份 civ,排最前;再发展度、思潮、商道 */
export const CIV_FINISH: readonly CivModule[] = [religionModule, developmentModule, ideologyModule, tradeModule];

/** 三组数表:政局(管辖、动荡、钱粮、人口……)、发展度、思潮;id 是总登记里的组名 */
export const CIV_TABLES: readonly TableGroup[] = [
  { id: TABLE_GROUP.state, cards: stateCardsOf },
  { id: TABLE_GROUP.dev, cards: devCardsOf },
  { id: TABLE_GROUP.ideology, cards: () => ideoTableCards() },
];

export const OFFICIAL_PACK: CivPack<OfficialOwn> = {
  id: 'official',
  events: CIV_EVENTS,
  annals: CIV_ANNALS,
  knobs: CIV_KNOBS,
  tables: CIV_TABLES,
  modules: CIV_MODULES,
  partial: CIV_PARTIAL,
  finish: CIV_FINISH,
  ...OFFICIAL_STEPS,
};

/**
 * 由 Civ 数据重建官方推演的状态,然后就能从 civ.endYear 接着推:sim.run(更晚的年份)。不需要保存事件堆,存档也只存 Civ。
 * interventions = 接着推时带着的干预(默认 = 这份历史推出来时带着的 civ.interventions):
 * 已经过了的只影响之后的决定(规则),还没到的补上它们的事件。后面可以接上几条比 civ.endYear 晚的(逐年推演时下的新命令,civ/play.ts)。
 * first = 最先预约的事件(地形大事那一刻接着推时:大事本身)。
 * eras = 地形大事以前各段的州(信仰照历史重放时,大事以前按那时的州;默认 = civ.eras)
 */
export function resumeCiv(world: World, civ: Civ, interventions?: readonly Intervention[], first?: (sim: CivSim) => void, eras?: readonly FaithEra[]): CivSim {
  return resumePack(OFFICIAL_PACK, world, civ, interventions, first, eras);
}
