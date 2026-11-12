/**
 * 某一年的"谁占着地":按州归属数出有领土的国家数(纯 gen 层,Node 里也能跑)。
 *
 * 只读 civ 的日志/检查点,不改任何状态;星系页的「地表边界」用它写摘要,
 * 国界折线本身要渲染层的州链(见 ui/borderOverlay.ts)。
 */
import type { World } from '../world';
import type { Civ } from './types';
import { ownersAt } from './engine/timeline';

/** 这一年有几个国家占着地(按"有至少一个州"算;civ 的州数和地块对不上 = 0) */
export function politiesWithLand(world: World, civ: Civ | null | undefined, year: number): number {
  if (!civ) return 0;
  if (civ.regions.of.length !== world.mesh.n) return 0;
  const own = ownersAt(civ, Number.isFinite(year) ? year : 0);
  const seen = new Set<number>();
  for (let r = 0; r < own.polity.length; r++) if (own.polity[r] >= 0) seen.add(own.polity[r]);
  return seen.size;
}

/** 这一年占着地的国家编号(升序;界面点选/着色用) */
export function politiesAt(world: World, civ: Civ | null | undefined, year: number): number[] {
  if (!civ) return [];
  if (civ.regions.of.length !== world.mesh.n) return [];
  const own = ownersAt(civ, Number.isFinite(year) ? year : 0);
  const seen = new Set<number>();
  for (let r = 0; r < own.polity.length; r++) if (own.polity[r] >= 0) seen.add(own.polity[r]);
  return [...seen].sort((a, b) => a - b);
}
