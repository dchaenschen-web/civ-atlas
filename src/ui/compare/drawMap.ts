/**
 * 并排试推画地图要的那一张:开一个生成世界的后台线程(和打开世界用的同一个,src/worker.ts),只生成地形、铺像素、不推文明
 * (generate 带 skipCiv),交回来就关掉线程。推历史的线程(growThread.ts)按同样的参数生成同一张地图,两边对得上。
 * 地图符号的规划(手绘画风的山、树)线程里一起算好交来,记给画图的代码,主线程不用再算。
 */
import { systemOpt } from '../../gen/systemState';
import type { WorkerRequest, WorkerResponse } from '../../worker';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { GrowMap } from '../../growThread';
import { adoptPlan } from '../../render/fantasy';
import { WORKER_URL } from '../workerUrl';

export interface DrawMap {
  world: World;
  raster: Raster;
}

/** 生成画图用的地图。progress = 生成到哪一步(进度 0–1);stop = 不要了(关掉线程,done 不再兑现) */
export function makeDrawMap(map: GrowMap, progress: (stage: string, pct: number) => void): { done: Promise<DrawMap>; stop: () => void } {
  const w = new Worker(WORKER_URL, { type: 'module' });
  let over = false;
  const stop = () => {
    if (over) return;
    over = true;
    w.onmessage = null;
    w.onerror = null;
    w.terminate();
  };
  const done = new Promise<DrawMap>((resolve, reject) => {
    w.onerror = (e) => {
      stop();
      reject(new Error(e.message || '生成地图的后台线程出错'));
    };
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.id !== 1) return;
      if (m.type === 'progress') return progress(m.stage, m.pct);
      if (m.type !== 'done') return;
      stop();
      if (!m.world || !m.raster) return reject(new Error('没交回整张地图'));
      if (m.plan) adoptPlan(m.world, m.plan);
      resolve({ world: m.world, raster: m.raster });
    };
  });
  w.postMessage({ type: 'generate', id: 1, scale: 1, params: map.params, ...systemOpt(), ...(map.terrain ? { terrain: map.terrain } : {}), ...(map.sketch ? { sketch: map.sketch } : {}), skipCiv: true } satisfies WorkerRequest);
  return { done, stop };
}
