/**
 * 地质:从板块边界派生"地震带 / 火山带 / 地热",给图层、天象事件和推演里的自发地质事件用。
 *
 * 全部从生成结果(world.tect 的板块边界汇聚强度、离边界多远、洋壳年龄、热点)和
 * WorldParams.geo(地质活跃度倍数)派生,不写死:
 *   - 汇聚带(俯冲、陆陆碰撞):地震最强,俯冲带上还有火山弧
 *   - 离散带(洋中脊、裂谷):中等地震,少量火山
 *   - 热点:孤立火山(岛链的源头)
 *   - 大陆内部:几乎没有
 *   - 整体再乘 WorldParams.geo,所以"平静 / 平常 / 活跃 / 暴烈"是这颗星球自己的数
 *
 * 纯计算、确定性;懒算 + 缓存(不挂进 World,不改世界文件、不改存档)。
 */
import type { World } from './world';
import { geometryOf } from './geometry';
import { subSeed } from './util';

export interface Geology {
  /** 每个地块的地震强度(0–1;1 = 板块边界上最强的俯冲带) */
  quake: Float32Array;
  /** 每个地块的火山强度(0–1) */
  volcano: Float32Array;
  /** 每个地块的地热(0–1;温泉、地热田,离边界稍远也有) */
  heat: Float32Array;
  /** 活跃度总系数(WorldParams.geo,地球基线 = 1) */
  activity: number;
  /** 全图的火山名单(地块号,按强度从大到小;画火山符号、记"某山喷发"用) */
  volcanoes: number[];
}

const cache = new WeakMap<World, Geology>();

/** 按种子取 [0,1) 的数 */
function unit(seed: number, tag: string): number {
  return (subSeed(seed, 'geo:' + tag) % 1_000_000) / 1_000_000;
}

/**  volcanoes:最多列多少座 */
const VOLCANO_MAX = 160;

/**
 * 这个世界的地质(懒算,同一个 world 只算一次)。
 * 生成时已经算过的东西(tect.convergence / distConv / strengthConv / plate)直接读。
 */
export function geologyOf(world: World): Geology {
  const hit = cache.get(world);
  if (hit) return hit;
  const { mesh, tect, water, elevation, params } = world;
  const { n } = mesh;
  const geo = geometryOf(mesh);
  const activity = Math.max(0.4, Math.min(3, params.geo ?? 1));
  const quake = new Float32Array(n);
  const volcano = new Float32Array(n);
  const heat = new Float32Array(n);

  const conv = tect.convergence;
  const dist = tect.distConv;
  const strength = tect.strengthConv;
  // 边界附近多远还算"带内"(地块间距的倍数):地震带比火山带宽
  const quakeReach = 2.2;
  const volcanoReach = 1.3;
  const heatReach = 4.5;
  for (let i = 0; i < n; i++) {
    const c = conv[i];
    const d = dist[i];
    const s = strength[i];
    const land = water[i] !== 1;
    const elev = land ? Math.max(0, elevation[i]) : 0;
    // 汇聚(正)/ 离散(负)分开算:汇聚带地震最强,离散带中等
    const convAbs = c > 0 ? c : -c * 0.55;
    const near = Math.max(0, 1 - d / quakeReach);
    const band = (convAbs * 0.75 + s * 0.25) * near * near;
    // 热点 / 板块内部的零散地震:按种子给一点,免得带外一片死寂
    const scatter = unit(params.seed, `scatter${i}`) * 0.06;
    quake[i] = Math.min(1, (band + scatter) * activity * (land ? 1 : 0.6));
    // 火山:只在汇聚带(俯冲弧)和热点;陆上比海底显眼
    const vnear = Math.max(0, 1 - d / volcanoReach);
    const arc = c > 0 ? c * vnear * vnear * (land ? 1 : 0.35) : 0;
    const hotspot = unit(params.seed, `hot${i}`) > 0.9975 ? 0.75 : 0;
    volcano[i] = Math.min(1, (arc + hotspot * vnear) * activity);
    // 地热:带外也有一点,离边界越远越淡
    const hnear = Math.max(0, 1 - d / heatReach);
    heat[i] = Math.min(1, (hnear * (0.5 + 0.5 * Math.abs(c)) + unit(params.seed, `spring${i}`) * 0.04) * activity);
    // 极高海拔的冰盖下岩浆作用弱一点(厚地壳)
    if (elev > 3000) {
      quake[i] *= 0.8;
      volcano[i] *= 0.7;
    }
    // 海沟极深处没有火山(俯冲带前端)
    if (!land && elevation[i] < -6000) volcano[i] = 0;
  }

  // 火山名单:按强度取前若干座,彼此隔开(同一座火山不连着重记)
  const sep = Math.sqrt(geo.area / n) * 1.2; // 大约一个地块间距:比这近算同一座
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (volcano[i] > 0.18) order.push(i);
  order.sort((a, b) => volcano[b] - volcano[a] || a - b);
  const volcanoes: number[] = [];
  for (const i of order) {
    if (volcanoes.length >= VOLCANO_MAX) break;
    let tooClose = false;
    for (const j of volcanoes) {
      if (geo.dist(i, j) < sep) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) volcanoes.push(i);
  }

  const out: Geology = { quake, volcano, heat, activity, volcanoes };
  cache.set(world, out);
  return out;
}

/** 某个地块的地震强度(没算过就算一次) */
export function quakeAt(world: World, cell: number): number {
  return geologyOf(world).quake[cell] ?? 0;
}

/** 火山强度 */
export function volcanoAt(world: World, cell: number): number {
  return geologyOf(world).volcano[cell] ?? 0;
}
