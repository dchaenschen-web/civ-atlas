/**
 * 陨击结算(C 方案):推演里只记效应(编年史"陨星坠落,城郭尽焚"),推演结束以后,
 * 按记下来的撞击事件算出"该在哪儿挖多大的坑",交给作者预览/应用。
 *
 * 这里只做纯计算,不碰世界:返回坑的位置、半径、深度,和一份"改了地形以后的 elevation"副本。
 * 真正的应用(写进存档、走地形编辑)由界面层决定。
 */
import type { Civ } from './civ/types';
import type { TerrainOp } from './edits';
import type { World } from './world';
import { keyed } from './civ/engine/rand';

export interface ImpactCrater {
  year: number;
  /** 落点经度(−180…180) */
  lon: number;
  /** 落点纬度(−90…90) */
  lat: number;
  /** 坑的半径(公里) */
  radiusKm: number;
  /** 坑的最深处(米) */
  depthM: number;
  /** 落在哪个州(结算预览里显示州名) */
  region: number;
}

export interface ImpactSettlement {
  craters: ImpactCrater[];
  /** 改了地形以后的 elevation(和 world.elevation 等长;没有撞击 = 原样复制一份) */
  elevation: Float32Array;
  /** 变过的地块数 */
  touched: number;
}

/** 一次撞击在史事里记的受损州数(b 列)→ 坑的大小 */
function craterOf(b: number): { radiusKm: number; depthM: number } {
  const level = b >= 3 ? 3 : b >= 2 ? 2 : 1;
  return { radiusKm: 40 + 35 * level, depthM: 90 + 80 * level };
}

/** 地球半径(公里),坑的公里数换世界单位用 */
const R_KM = 6371;

/**
 * 从推演记下的陨星事件算出待结算的坑;没有陨星事件 = 空结算(不改地形)。
 * 只读 civ.annals 里 cause='impact' 的那些 famine 条目,所以是纯函数、可重复调用。
 */
export function settleImpacts(world: World, civ: Civ | null, opts: { rate?: number } = {}): ImpactSettlement {
  /** N10:当前星系结构下的陨击率(界面把 impactRate(world) 传进来;不传 = 按 1) */
  const rate = Number.isFinite(opts.rate) ? Math.max(0, opts.rate as number) : 1;
  const odds = Math.min(0.2, Math.max(0, 0.015 * rate));
  const craters: ImpactCrater[] = [];
  if (civ) {
    const { mesh } = world;
    const regions = civ.regions;
    for (const e of civ.annals) {
      if (e.kind !== 'famine' || e.cause !== 'impact') continue;
      const r = e.region >= 0 && e.region < regions.count ? e.region : -1;
      if (r < 0) continue;
      // N10:星系结构改了(小行星带/巨行星清扫/大气)以后,同一条史事是否还成立按当前发生率重判。
      // 口径:以 1.5 倍地球陨击率为参照,当前 rate 高于参照就全保留、低于参照按比例抽稀、降到 0 就全没。
      // (不重推文明是算不出「新增」撞击的,所以只做减法;要新增得重推。)
      if (opts.rate !== undefined) {
        const ratio = Math.min(1, odds / (0.015 * 1.5));
        if (ratio <= 0) continue;
        if (ratio < 1) {
          const k = Math.max(0, Math.round(e.year / 40 - 0.5));
          if (keyed(civ.seed, k, r, 23) >= ratio) continue;
        }
      }      const seat = regions.seat[r];
      if (!(seat >= 0) || seat >= mesh.n) continue;
      // 世界坐标 → 经纬度(等距圆柱:上北下南,东西无缝)
      const lon = (mesh.x[seat] / mesh.width) * 360 - 180;
      const lat = 90 - (mesh.y[seat] / mesh.height) * 180;
      const { radiusKm, depthM } = craterOf(e.b);
      craters.push({ year: e.year, lon, lat, radiusKm, depthM, region: r });
    }
  }
  const old = world.elevation;
  const elevation = new Float32Array(old);
  let touched = 0;
  if (craters.length) {
    const mesh = world.mesh;
    const R = R_KM;
    for (const c of craters) {
      const rAngle = c.radiusKm / R;
      for (let i = 0; i < mesh.n; i++) {
        // 球面距离(粗略:用经纬度算,坑只有几十公里,误差可忽略)
        const lon = (mesh.x[i] / mesh.width) * 360 - 180;
        const lat = 90 - (mesh.y[i] / mesh.height) * 180;
        const dLon = ((lon - c.lon + 540) % 360) - 180;
        const dLat = lat - c.lat;
        const cosLat = Math.cos((lat * Math.PI) / 180);
        const d = Math.hypot((dLon * Math.PI) / 180 * cosLat, (dLat * Math.PI) / 180);
        const k = d / rAngle;
        if (k >= 1) continue;
        // 碗形:中心最深,边缘平缓抬起一点(抛射物堆成环)
        const drop = c.depthM * (1 - k * k);
        const rim = k > 0.82 ? c.depthM * 0.18 * ((k - 0.82) / 0.18) : 0;
        const next = elevation[i] - drop + rim;
        if (next !== elevation[i]) {
          elevation[i] = next;
          touched++;
        }
      }
    }
  }
  return { craters, elevation, touched };
}
/** 世界坐标宽度(= edits 的 TERRAIN_W,这里不引 terrainOps 免得循环) */
const OP_W = 2048;
const OP_H = 1024;
/** 每公里等于多少世界坐标(赤道一圈 ≈ 40075 公里) */
const OP_PER_KM = OP_W / 40075;

/**
 * 把待结算的坑换成"压低地形"的 TerrainOp(和界面里地形编辑同一种改动,存存档、重新生成世界时生效)。
 * 坑半径太小时抬到最小的 3(和地形编辑的下限一致);强度按深度换算。
 */
export function cratersToOps(craters: readonly ImpactCrater[]): TerrainOp[] {
  const ops: TerrainOp[] = [];
  for (const c of craters) {
    const x = ((c.lon + 180) / 360) * OP_W;
    const y = ((90 - c.lat) / 180) * OP_H;
    const r = Math.max(3, Math.min(160, c.radiusKm * OP_PER_KM));
    const s = Math.max(0.2, Math.min(2, c.depthM / 300));
    ops.push({ kind: 'lower', pts: [x, y], r, s });
  }
  return ops;
}