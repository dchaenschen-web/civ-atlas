/**
 * 天象 / 天体事件接口（@experimental）。
 *
 * 本轮只留接口与类型，不接 UI、不写编年史、不影响生成与存档。
 * 事件清单、影响层、后续优先级见 docs/天象事件-接口备忘.txt。
 *
 * 以后实现在这里补：celestialEventsOf 变成真正的确定性事件流，
 * 编年史/气候/宗教/技术各层消费 CelestialEvent，不再直接读天体数据。
 */

export type CelestialEventKind =
  | 'supernova'
  | 'grb'
  | 'flare'
  | 'cme'
  | 'comet'
  | 'meteorShower'
  | 'nearMiss'
  | 'eclipse'
  | 'transit'
  | 'geomagneticReversal'
  | 'littleIceAge'
  | 'aurora'
  | 'zodiacalLight';

export type EventAffect = 'sky' | 'climate' | 'ecology' | 'society' | 'religion' | 'tech';

export interface CelestialEvent {
  id: string;
  kind: CelestialEventKind;
  /** 发生年份（世界年） */
  atYear: number;
  /** 关联天体（行星/卫星/恒星 id，见 SystemSpec.tree） */
  bodyId?: string;
  /** 关联邻近恒星的距离（超新星/耀斑等） */
  distanceLy?: number;
  /** 0 天象 / 1 显著 / 2 灾变 / 3 灭绝级 */
  severity: 0 | 1 | 2 | 3;
  affects: EventAffect[];
  /** 编年史用一句话 */
  text: string;
  /** 预留数值（辐射剂量、视星等、尘埃冬天年数……） */
  data?: Record<string, number | string>;
}

export interface SupernovaImpact {
  severity: 0 | 1 | 2 | 3;
  /** 到达地表的辐射剂量（相对日常本底，1 = 无感） */
  radDose: number;
  /** 夜空亮度增量（视星等） */
  skyMag: number;
  /** 尘埃冬天持续年数 */
  dustWinterYears: number;
}

/** 一个世界里的天象事件流（本轮：空实现） */
export function celestialEventsOf(_world: unknown): CelestialEvent[] {
  return [];
}

/** 下一个天象事件（本轮：无） */
export function nextCelestialEvent(_world: unknown, _afterYear: number): CelestialEvent | null {
  return null;
}

/** 超新星影响估算（本轮：未实现，返回 null；接口先定住） */
export function supernovaImpact(_distanceLy: number, _massSolar: number): SupernovaImpact | null {
  return null;
}
