/**
 * S5 地表边界叠加:把本星系主行星这一年的国界画在一张小图上(海陆 + 界线)。
 *
 * N9:底图不再自己「找最近地块」拼 96×48 的粗网格,而是直接用这颗行星的真实地表栅格
 *     (planetSurface 得到 World → rasterize → renderLayer('elevation')),画布提到 1024×512,
 *     所以海陆形状、海崖、山脉都看得清;国界仍用 ui/borderOverlay.ts 的 polityBordersAt(和地图国界同一套算法)。
 * 只读:不改 civ、不动时间轴、不进存档。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { World } from '../gen/world';
import type { Civ } from '../gen/civ/types';
import { polityBordersAt, politiesWithLand } from './borderOverlay';
import { rasterize } from '../gen/raster';
import { renderLayer } from '../render/layers';

/** N9:底图画布尺寸(1024×512,再高只是白占内存) */
export const BORDER_MAP_W = 1024;
export const BORDER_MAP_H = 512;

export interface BorderMapProps {
  world: World;
  civ: Civ | null;
  /** 哪一年(跟系统页时间轴同一个年) */
  year: number;
}

export function BorderMap({ world, civ, year }: BorderMapProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [show, setShow] = useState(true);

  /** 这一年的国界(年份变了才重算) */
  const lines = useMemo(() => (show ? polityBordersAt(world, civ, year) : []), [world, civ, year, show]);
  const polities = useMemo(() => politiesWithLand(world, civ, year), [world, civ, year]);

  /** N9:高分辨率底图(world 不变就只渲染一次) */
  const base = useMemo(() => {
    const scale = Math.min(1, BORDER_MAP_W / Math.max(1, world.width));
    const raster = rasterize(world, scale);
    const cv = document.createElement('canvas');
    cv.width = raster.w;
    cv.height = raster.h;
    const c = cv.getContext('2d');
    if (c) renderLayer(c, world, raster, 'elevation');
    return cv;
  }, [world]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = BORDER_MAP_W;
    const H = BORDER_MAP_H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 底图:真实地表栅格平滑放大到 1024 宽
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, 0, 0, W, H);

    // 界线:世界坐标 → 画布坐标(和 mesh.x / mesh.y 同一套坐标)
    const { mesh } = world;
    const sx = W / Math.max(1, mesh.width);
    const sy = H / Math.max(1, mesh.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const l of lines) {
      const p = l.pts;
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i] * sx;
        const y = p[i + 1] * sy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // 两侧都有主的线更实一些(国界),一侧无主(海岸边上的新拓地)淡一点
      const solid = l.left >= 0 && l.right >= 0;
      ctx.strokeStyle = solid ? 'rgba(255,240,186,0.95)' : 'rgba(255,240,186,0.55)';
      ctx.lineWidth = solid ? 2.1 : 1.5;
      ctx.stroke();
    }
    // 框
    ctx.strokeStyle = 'rgba(180,190,205,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }, [world, base, lines, year, show]);

  return (
    <div data-act="border-map" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
        <b>本星系地表边界</b>
        <button className="ov-btn" data-act="border-toggle" onClick={() => setShow((v) => !v)} style={{ padding: '0 6px' }}>
          {show ? '收起边界' : '叠上边界'}
        </button>
        <span style={{ opacity: 0.7 }}>
          第 {year.toFixed(0)} 年 · {lines.length} 条界线 · {polities} 个国家有地
        </span>
        <span style={{ opacity: 0.45 }}>{BORDER_MAP_W}×{BORDER_MAP_H} 真实地表</span>
      </div>
      <canvas
        ref={ref}
        width={BORDER_MAP_W}
        height={BORDER_MAP_H}
        data-res={BORDER_MAP_W + 'x' + BORDER_MAP_H}
        style={{ width: '100%', maxWidth: BORDER_MAP_W, aspectRatio: '2 / 1', borderRadius: 6, display: 'block', background: '#0d1420' }}
      />
      {!show && <div style={{ fontSize: 11.5, opacity: 0.6 }}>边界已收起(底图与年份照旧)</div>}
    </div>
  );
}
