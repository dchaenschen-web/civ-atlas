/**
 * 技术路线("时代链"的包):同一套推演引擎,换一组时代名和门槛,就有另一条发展路线。
 *
 * 这一版先给**数据和查询**:第 0 号包(现实)的时代名和 development.ts 的 ERAS 完全一致,
 * 另外两套(魔法、修真)只是同一套时代格子的另一组名字与"关键物产"。
 * 下一阶段的接入方式已经定好(不在这里改,免得这一步动到推演):
 *   - development.ts 的 ERAS 改成 eraNamesOf(techPackOf(params)),门槛表按包给一张;
 *   - 编年史、时代图层、钱粮和思潮的文案跟着包走;
 *   - 文明确立的规则(pack.ts)不动:换包只换"时代叫什么、要什么物产才进得去",不换推演骨架。
 *
 * 为什么这么做:魔法 / 修真现实上是"换一组门槛",不是"换一套引擎"。把时代链做成数据,
 * 以后还能加蒸汽朋克、赛博、神话时代,而不用改推演引擎。
 */
import { clamp } from './util';

/** 一个时代:叫什么、进这个时代的关键物产(只写给人看;真正的门槛在 development.ts 的 RESOURCE 表) */
export interface TechEra {
  name: string;
  /** 进这个时代的关键物产(设定集、界面提示用) */
  need: string;
}

export interface TechPack {
  /** WorldParams.tech:0 现实、1 魔法、2 修真 */
  id: number;
  name: string;
  /** 一句话说明 */
  desc: string;
  eras: readonly TechEra[];
}

export const TECH_PACKS: readonly TechPack[] = [
  {
    id: 0,
    name: '现实',
    desc: '从石器到信息时代:铜锡、铁、煤、石油、稀有矿依次成为门槛',
    eras: [
      { name: '石器', need: '—' },
      { name: '青铜', need: '铜、锡' },
      { name: '铁器', need: '铁' },
      { name: '中古', need: '行政能力' },
      { name: '火药', need: '硝石' },
      { name: '工业', need: '煤、铁' },
      { name: '电气', need: '石油' },
      { name: '信息', need: '稀有矿' },
      { name: '未来', need: '—' },
    ],
  },
  {
    id: 1,
    name: '魔法',
    desc: '以符文、法阵与魔导为核心:门槛换成灵材与魔力结晶',
    eras: [
      { name: '蒙昧', need: '—' },
      { name: '符文', need: '灵木、星铁' },
      { name: '法阵', need: '符纸、晶石' },
      { name: '魔导', need: '魔核' },
      { name: '炼金', need: '秘银' },
      { name: '秘法工业', need: '以太' },
      { name: '星辉', need: '星髓' },
      { name: '太虚', need: '—' },
      { name: '神话', need: '—' },
    ],
  },
  {
    id: 2,
    name: '修真',
    desc: '以吐纳、筑基、金丹为阶:门槛换成灵脉、丹药与天地灵气',
    eras: [
      { name: '凡俗', need: '—' },
      { name: '引气', need: '灵脉' },
      { name: '筑基', need: '筑基金丹' },
      { name: '金丹', need: '金液' },
      { name: '元婴', need: '魂玉' },
      { name: '化神', need: '天地灵气' },
      { name: '炼虚', need: '—' },
      { name: '合体', need: '—' },
      { name: '大乘', need: '—' },
    ],
  },
];

/** 最多几号包(WorldParams.tech 的上限) */
export const TECH_PACK_MAX = TECH_PACKS.length - 1;

/** 这个世界的技术路线(认不出 / 没给 = 现实) */
export function techPackOf(p: { tech?: number } | undefined): TechPack {
  const id = Math.round(clamp(p?.tech ?? 0, 0, TECH_PACK_MAX));
  return TECH_PACKS.find((x) => x.id === id) ?? TECH_PACKS[0];
}

/** 这个世界的时代名(下标 = 时代序号,和 development.ts 的 ERAS 同一个顺序) */
export function eraNamesOf(pack: TechPack): readonly string[] {
  return pack.eras.map((e) => e.name);
}

/** 第 i 个时代的名字(越界 = 最后一档) */
export function eraNameAt(pack: TechPack, i: number): string {
  const n = pack.eras.length;
  return pack.eras[Math.max(0, Math.min(n - 1, Math.round(i)))].name;
}
