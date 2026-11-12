/**
 * S5「本星系可叠地表边界」的数据侧:某一年的国界折线(世界坐标)。
 *
 * 和地图上的国界同一套算法(render/civ/borders.ts 的州链 + 合并),只是这里不接海崖平滑
 * (那一步要整张 raster),所以线是"按地块连出来的",细看略带棱角——星系页只作参考,够用。
 * 只读:不改 civ、不动时间轴、不进存档。
 */
import type { World } from '../gen/world';
import type { Civ } from '../gen/civ/types';
import { ownersAt } from '../gen/readers/openQuery';
import { mergeChains, regionChains } from '../render/civ/borders';

/** 一条界线(世界坐标,和 mesh.x / mesh.y 同一套) */
export interface BorderPolyline {
  /** 折线点:x0,y0,x1,y1,… */
  pts: Float32Array;
  closed: boolean;
  /** 两侧的归属(国编号;−1 = 无主) */
  left: number;
  right: number;
}

/**
 * 某一年的国界:只挑两侧归属不同的州界,相邻的接成整条。
 * 这一年还没有国家(或 civ 的州数和地块对不上)= 空数组。
 */
export function polityBordersAt(world: World, civ: Civ | null | undefined, year: number): BorderPolyline[] {
  if (!civ) return [];
  if (civ.regions.of.length !== world.mesh.n) return [];
  const y = Number.isFinite(year) ? year : 0;
  const own = ownersAt(civ, y);
  const rc = regionChains(world.mesh, civ);
  return mergeChains(rc, own.polity).map((l) => ({ pts: l.pts, closed: l.closed, left: l.left, right: l.right }));
}

/** 这一年有几个国家占着地(界面写摘要用;gen 层纯函数,Node 里也验过) */
export { politiesWithLand } from '../gen/civ/territoryAt';
