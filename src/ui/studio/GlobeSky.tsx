/**
 * 地球仪的天球背景(修正版)。
 *
 * 之前有两个毛病:① 恒星用 tan 投影,会跑到画外/挤在边上;② 只有"方位角"没跟太阳对齐,
 * 所以星空和晨昏线看起来各转各的。现在统一到"以太阳方向为基准的天球坐标系":
 *   · 相机固定在行星上,看向背离太阳的方向;太阳方位角 sunAzDeg 决定整片星空绕竖轴转多少
 *   · 恒星用正交投影(单位球),不会飞出画面
 *   · 同子星系的星体按 skyLayer 的方位角相对太阳摆:方位差 0° = 太阳那一侧,180° = 正对面
 * 于是:行星沿轨道走一圈,星空绕一圈;自转不影响背景(背景是"外面看这颗球"时的星空)。
 * 纯 canvas 2D,不依赖 WebGL;尺寸变化时重画。
 */
import { useEffect, useRef } from 'react';
import { nearbyStarsOf } from '../../gen/neighbors';
import type { AstroDesign } from '../../gen/astroDesign';
import { skyLayerOf, type SkySiblingInput } from '../../gen/skyLayer';

export interface GlobeSkyProps {
  design: AstroDesign;
  /** 地球上看到天空的天体下标 */
  index: number;
  year: number;
  /** 同子星系的其他星体(不给 = 不算) */
  siblings?: SkySiblingInput[];
  seed: number;
}

export function GlobeSky({ design, index, year, siblings = [], seed }: GlobeSkyProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const parent = cv.parentElement;
    const w = Math.max(120, parent?.clientWidth ?? 600);
    const h = Math.max(120, parent?.clientHeight ?? 400);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 底:深空渐变
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#0b1220');
    g.addColorStop(0.6, '#070a13');
    g.addColorStop(1, '#03050a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 太阳方位:决定整片星空的朝向(行星公转时变)
    let sunAzDeg = 0;
    try {
      sunAzDeg = skyLayerOf(design, year, index, siblings).sunAzDeg;
    } catch {
      sunAzDeg = 0;
    }
    const rot = ((sunAzDeg + year * 0.6) * Math.PI) / 180;

    // 银河带:和星空一起转
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot * 0.35 - 0.4);
    const band = ctx.createLinearGradient(0, -h * 0.24, 0, h * 0.24);
    band.addColorStop(0, 'rgba(90,120,190,0)');
    band.addColorStop(0.5, 'rgba(120,150,210,0.11)');
    band.addColorStop(1, 'rgba(90,120,190,0)');
    ctx.fillStyle = band;
    ctx.fillRect(-w, -h * 0.24, w * 2, h * 0.48);
    ctx.restore();

    // ① 附近恒星:单位方向绕竖轴转 rot,正交投影(不会飞出画面)
    const stars = nearbyStarsOf(seed);
    for (const s of stars) {
      const [dx, dy, dz] = s.dir;
      const x0 = dx * Math.cos(rot) - dz * Math.sin(rot);
      const z0 = dx * Math.sin(rot) + dz * Math.cos(rot);
      if (z0 <= 0.05) continue; // 背离观察者的不画
      const px = w * 0.5 + x0 * w * 0.85;
      const py = h * 0.5 - dy * h * 0.85;
      if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue;
      const b = Math.min(1, 0.22 + 0.3 * Math.log10(1 + s.lum) - s.distanceLy / 300);
      ctx.globalAlpha = Math.max(0.16, b);
      ctx.fillStyle = `rgb(${s.color[0]},${s.color[1]},${s.color[2]})`;
      ctx.beginPath();
      ctx.arc(px, py, 0.6 + Math.max(0, b) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ② 同子星系其他星体:方位差相对太阳 → 摆在球后方的弧上
    const drawBody = (azDeg: number, kind: 'planet' | 'moon', name: string, radius: number) => {
      const rel = ((azDeg - sunAzDeg + 540) % 360) - 180; // -180..180,0 = 太阳方向
      const ang = (rel * Math.PI) / 180;
      const cx = w * 0.5 - Math.cos(ang) * w * 0.34;
      const cy = h * 0.5 - Math.sin(ang) * h * 0.3;
      const rg = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.35, radius * 0.2, cx, cy, radius);
      rg.addColorStop(0, kind === 'planet' ? '#f7e6c4' : '#d6dfee');
      rg.addColorStop(1, kind === 'planet' ? '#7d5f34' : '#4d5a70');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = '#9fb0cc';
      ctx.fillText(name, cx + radius + 4, cy + 3);
      ctx.globalAlpha = 1;
    };
    try {
      const sky = skyLayerOf(design, year, index, siblings);
      for (const s of sky.siblings) drawBody(s.azDeg, s.kind, s.name, s.kind === 'planet' ? 6.5 : 3.5);
      if (sky.companion) drawBody(sky.companion.azDeg, 'planet', sky.companion.name, 8);
    } catch {
      /* 设计数据不全:只留星空 */
    }
  }, [design, index, year, seed, siblings]);

  return <canvas ref={ref} data-act="globe-sky" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} />;
}
