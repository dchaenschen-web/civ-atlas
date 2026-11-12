/**
 * 世界参数的滑条(SLIDERS、CONT_SLIDERS)、推演年数的开关和滑条的说法、几句参数简写。
 * 新建世界的弹窗(NewWorldDialog.tsx)、新建界面(studio/)、世界设定页(WorldOverviewGenesis.tsx,那边照旧一起导出)都用;
 * 单独一个文件,打开网站时首页上的新建弹窗不用带上世界设定页。
 */
import type { BaseParamKey, WorldParams } from '../gen/params';
import { END_YEAR_DEFAULT, END_YEAR_MAX, END_YEAR_STEP } from '../gen/edits';
import { genSeconds } from './genSpeed';
import type { FieldSpec } from './ParamField';

export interface Slider {
  key: BaseParamKey;
  name: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  hint: string;
  /** 拖滑条时数字后面再加一句(只在新建世界的滑条上;世界设定页只写数字) */
  more?: (v: number) => string | null;
  /** 右边数值框怎么写(见 ParamField.tsx 的 FieldSpec;不给 = 原样的数、没有单位) */
  field?: FieldSpec;
  /** 拖到的位置吸到哪(只取几档的滑条;不给 = 不吸) */
  snap?: (v: number) => number;
  /** 有具体名字的几档(恒星类型、构型、生命、撞击频率…):界面渲染成分段选项,不用滑条 */
  options?: readonly { v: number; label: string }[];
  /** 滑条的值和框里写的数不成比例时(按对数摆的几档):值 → 框里的数、框里的数 → 值(不夹进范围);给了就不看 field 的 mul、div */
  shown?: (v: number) => number;
  fromShown?: (d: number) => number;
}

export const SLIDERS: Slider[] = [
  { key: 'landFraction', name: '陆地比例', min: 0.12, max: 0.6, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, hint: '陆地占整个星球的比例', field: { unit: '%', mul: 100 } },
  { key: 'plates', name: '板块数量', min: 8, max: 60, step: 1, fmt: (v) => `${v}`, hint: '板块越多,陆地越破碎、岛屿和山脉越多(板块有大有小)' },
  { key: 'mountains', name: '造山强度', min: 0.2, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: '板块碰撞隆起的力度', field: { unit: '×', digits: 2 } },
  { key: 'temperature', name: '气温', min: -12, max: 12, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v}°C`, hint: '整体偏冷(冰河期)还是偏暖', field: { unit: '°C' } },
  { key: 'rainfall', name: '降水', min: 0.4, max: 1.8, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: '整体偏干还是偏湿', field: { unit: '×', digits: 2 } },
  {
    key: 'cells',
    name: '精细度',
    min: 12000,
    max: 200000,
    step: 2000,
    fmt: (v) => `${Math.round(v / 1000)}k 地块`,
    hint: '越精细越慢',
    field: { unit: 'k', div: 1000 },
    more: (v) => {
      const sec = genSeconds(v);
      return sec === null ? null : `约 ${sec} 秒`;
    },
  },
];

/** 南北偏向写成"均匀""北 40""南 40" */
export const northText = (v: number) => (Math.round(v * 100) === 0 ? '均匀' : `${v > 0 ? '北' : '南'} ${Math.abs(Math.round(v * 100))}`);

/** 大陆的另外四样(大陆数量是分段按钮,不是滑条) */
export const CONT_SLIDERS: Slider[] = [
  { key: 'gather', name: '大陆聚拢', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}`, hint: '0 = 大陆彼此离得远;越大越往一处挤,100 常常挤成一大片,另一边留出大洋', field: { mul: 100 } },
  { key: 'rugged', name: '破碎度', min: 0.2, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: '小 = 一大块、海岸平直、岛少(像非洲);大 = 支离破碎、半岛海湾和岛多(像欧洲)', field: { unit: '×', digits: 2 } },
  { key: 'hardness', name: '板块硬度', min: 0.4, max: 2.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: '越硬内陆越平、山脉越窄越矮;越软山越多越宽、高原多', field: { unit: '×', digits: 2 } },
  { key: 'north', name: '南北偏向', min: -1, max: 1, step: 0.05, fmt: northText, hint: '陆地多长在哪个半球', field: { mul: 100, signs: ['南', '北'], zero: '均匀' } },
  // 技术路线不在这里:挪到「打造文明」的设置里(Studio 第 2 步,和推演年数 / 天灾 / 规则排在一起)
];

/** 技术路线的滑条说法(下标 = WorldParams.tech) */
export const TECH_LABELS: Record<number, string> = { 0: '现实', 1: '魔法', 2: '修真' };

/** 大陆五样都是默认的(= 按种子来) */
export const contDefault = (p: WorldParams) => p.continents === 0 && p.gather === 0 && p.rugged === 1 && p.hardness === 1 && p.north === 0;

/** 大陆五样的一句话:"2 块大陆，破碎 0.60×";都是默认 = null */
export function contBrief(p: WorldParams): string | null {
  const parts: string[] = [];
  if (p.continents) parts.push(`${p.continents} 块大陆`);
  if (p.gather) parts.push(`聚拢 ${Math.round(p.gather * 100)}`);
  if (p.rugged !== 1) parts.push(`破碎 ${p.rugged.toFixed(2)}×`);
  if (p.hardness !== 1) parts.push(`硬度 ${p.hardness.toFixed(2)}×`);
  if (p.north) parts.push(`偏${northText(p.north)}`);
  return parts.length ? parts.join('，') : null;
}

/** 不是世界参数的滑条(推演年数):键只用来标记 */
export type SliderLike = Omit<Slider, 'key'> & { key: string };

/** 推演到第几年(开了「推演超过 3000 年」才有):3000–60000,一格 1000 年 */
export const YEARS_SLIDER: SliderLike = {
  key: 'endYear',
  name: '推演到',
  min: END_YEAR_DEFAULT,
  max: END_YEAR_MAX,
  step: END_YEAR_STEP,
  fmt: (v) => `${v} 年`,
  hint: '历史推到第几年;年数越多,打开世界、改历史都越慢',
  field: { unit: '年', snap: END_YEAR_STEP },
};
/** 推演年数的开关 */
export const YEARS_SWITCH = `推演超过 ${END_YEAR_DEFAULT} 年`;
/** 打开开关时滑条先停在哪 */
export const YEARS_ON = 10000;
/** 开关下面一直显示的那段说明 */
export const YEARS_NOTE = '近现代/未来仍在开发，历史超过3000年会进入低价值循环；接受这一点可开启，最高 6 万年。';
/**
 * "三千年的历史":3000 年的世界照旧,推得更久的写真实年数("60000 年的历史")。
 * gap:接在汉字后面(不是标点后面)时数字前空一格("推演它 60000 年")
 */
export function yearsSpan(end: number, gap = false): string {
  return end === END_YEAR_DEFAULT ? '三千年' : `${gap ? ' ' : ''}${end} 年`;
}

/** 世界参数的一行简写(卡片里"世界参数"那一行右边);定了大陆数量的写大陆数量 */
export function paramsSide(p: WorldParams): string {
  return `陆地 ${Math.round(p.landFraction * 100)}%，${p.continents ? `${p.continents} 块大陆` : `${p.plates} 个板块`}`;
}

/**
 * 星系这一层的参数:现在只在「星系与天体」/「星系参数」面板里改,
 * 不再出现在「世界参数」那排滑条里(同一批数据只留一个入口)。
 */
export const SYSTEM_LEVEL_KEYS: readonly BaseParamKey[] = ['astro', 'system', 'arch', 'planets', 'gas', 'moons', 'impact', 'life', 'home', 'tilt', 'rotation', 'geo', 'mag', 'salt'];