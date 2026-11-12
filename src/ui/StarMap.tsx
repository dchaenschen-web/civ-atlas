/**
 * 100 光年邻星星图:42 颗邻星 + 更远的天球背景点云。
 *
 * 两层:
 *   - 背景点云(>100 ly,astronomy 的星场)交给 WebGL2 点渲染(render/starMapGl.ts);没有 WebGL2 就用 Canvas 画;
 *   - 邻星本体、名字、距离与命中测试始终走 Canvas:标签清晰、点选简单。
 * 两层用同一套 yaw/pitch 旋转 + 同一个投影系数,转动的时候背景和邻星一起转(不然背景会像贴纸一样不动)。
 *
 * 点邻星 = 在图下方弹出信息卡(名字 / 距离 / 光谱 / 质量 / 温度),并标「恒星际未开放」;
 * 点本星系 = 回系统视图。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { nearbyStarsOf, type NearbyStar } from '../gen/neighbors';
import type { AstroSystem } from '../gen/astro';
import { createStarMapGl, type StarMapRenderer } from '../render/starMapGl';

export interface StarMapProps {
  system: AstroSystem;
  seed: number;
  onSystemSelect?: () => void;
}

type Hit = { star: NearbyStar | null; x: number; y: number; r: number };

const H = 420;
/** 背景天球的等效半径(光年):只影响投影位置,不影响数据 */
const SKY_R = 140;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function StarMap({ system, seed, onSystemSelect }: StarMapProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<StarMapRenderer | null>(null);
  const hits = useRef<Hit[]>([]);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: number } | null>(null);
  const [size, setSize] = useState({ w: 900, h: H });
  const [cam, setCam] = useState({ yaw: 0.35, pitch: 0.25, zoom: 1 });
  const [webgl, setWebgl] = useState(false);
  /** 点中的邻星(信息卡;null = 没点) */
  const [picked, setPicked] = useState<NearbyStar | null>(null);
  const stars = useMemo(() => nearbyStarsOf(seed), [seed]);
  const bg = system.design.stars;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setSize({ w: Math.max(320, el.clientWidth), h: H });
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 显卡只建一次、卸载时销毁:以前每帧新建/销毁 context,拖一下就要重新编译着色器
  useEffect(() => {
    const c = glCanvas.current;
    if (!c) return;
    glRef.current = createStarMapGl(c);
    setWebgl(!!glRef.current);
    return () => {
      glRef.current?.dispose();
      glRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 用 GPU 画背景时不铺底色(底色在容器上),否则会把下面的 WebGL 层盖住
    if (!glRef.current) {
      ctx.fillStyle = '#070d1b';
      ctx.fillRect(0, 0, size.w, size.h);
    } else {
      ctx.clearRect(0, 0, size.w, size.h);
    }
    const cx = size.w / 2;
    const cy = size.h / 2;
    const scale = Math.min(size.w, size.h) * 0.0033 * cam.zoom;
    const cyaw = Math.cos(cam.yaw);
    const syaw = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    /** 世界坐标(光年)→ 屏幕(和 GPU 那层同一套公式) */
    const project = (p: readonly [number, number, number]): [number, number, number] => {
      const x1 = p[0] * cyaw - p[2] * syaw;
      const z1 = p[0] * syaw + p[2] * cyaw;
      const y = p[1] * cp - z1 * sp;
      const depth = p[1] * sp + z1 * cp;
      const persp = 1 / (1 + depth * 0.0025);
      return [cx + x1 * scale * persp, cy - y * scale * persp, depth];
    };
    /** 同一套投影 → 裁剪空间(给 GPU 点云用) */
    const toClip = (p: readonly [number, number, number]): [number, number, number] => {
      const x1 = p[0] * cyaw - p[2] * syaw;
      const z1 = p[0] * syaw + p[2] * cyaw;
      const y = p[1] * cp - z1 * sp;
      const depth = p[1] * sp + z1 * cp;
      const persp = 1 / (1 + depth * 0.0025);
      const px = (x1 * scale * persp) / (size.w / 2);
      const py = (y * scale * persp) / (size.h / 2);
      return [px, py, persp];
    };

    const gpu = glRef.current;
    if (gpu) {
      const points: number[] = [];
      for (const s of bg) {
        const q = project([s.dir[0] * SKY_R, s.dir[1] * SKY_R, s.dir[2] * SKY_R]);
        if (q[0] < -20 || q[0] > size.w + 20 || q[1] < -20 || q[1] > size.h + 20) continue;
        const [px, py, persp] = toClip([s.dir[0] * SKY_R, s.dir[1] * SKY_R, s.dir[2] * SKY_R]);
        points.push(px, py, Math.max(1, (2.1 - s.mag * 0.28) * persp) * dpr, s.color[0] / 255, s.color[1] / 255, s.color[2] / 255, Math.max(0.18, 0.8 - s.mag * 0.1));
      }
      try {
        gpu.draw(points, Math.round(size.w * dpr), Math.round(size.h * dpr));
      } catch {
        // 显卡丢了:这一帧就不画背景,前景照旧(下次渲染 if(!gpu) 会走 Canvas)
        setWebgl(false);
      }
    } else {
      for (const s of bg) {
        const q = project([s.dir[0] * SKY_R, s.dir[1] * SKY_R, s.dir[2] * SKY_R]);
        if (q[0] < 0 || q[0] > size.w || q[1] < 0 || q[1] > size.h) continue;
        const r = Math.max(0.5, 2.1 - s.mag * 0.28);
        ctx.fillStyle = `rgba(${s.color.join(',')},${Math.max(0.18, 0.8 - s.mag * 0.1)})`;
        ctx.fillRect(q[0], q[1], r, r);
      }
    }

    // 100 ly 的界圈(只是视觉参考)
    ctx.strokeStyle = 'rgba(120,160,220,.14)';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(size.w, size.h) * 0.38, 0, Math.PI * 2);
    ctx.stroke();

    // 邻星
    const hit: Hit[] = [];
    for (const s of stars) {
      const q = project(s.xyz);
      const r = Math.max(3.5, 7 - s.distanceLy / 30);
      const on = picked?.id === s.id;
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${s.color.join(',')})`;
      ctx.fill();
      if (on) {
        ctx.beginPath();
        ctx.arc(q[0], q[1], r + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,236,170,.95)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.fillStyle = on ? '#f2e3b0' : 'rgba(220,232,250,.9)';
      ctx.font = '11px system-ui,sans-serif';
      ctx.fillText(s.name, q[0] + r + 3, q[1] + 4);
      ctx.fillStyle = 'rgba(165,185,215,.72)';
      ctx.font = '10px system-ui,sans-serif';
      ctx.fillText(`${s.distanceLy.toFixed(1)} ly`, q[0] + r + 3, q[1] + 16);
      hit.push({ star: s, x: q[0], y: q[1], r: 16 });
    }
    // 本星系
    const home = project([0, 0, 0]);
    ctx.beginPath();
    ctx.arc(home[0], home[1], 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff0a8';
    ctx.fill();
    ctx.strokeStyle = '#fff7d0';
    ctx.stroke();
    ctx.fillStyle = '#fff2bf';
    ctx.font = '12px system-ui,sans-serif';
    ctx.fillText(`${system.star.label}（本星系）`, home[0] + 11, home[1] + 4);
    hit.push({ star: null, x: home[0], y: home[1], r: 18 });
    hits.current = hit;
  }, [bg, cam, size, stars, system, webgl, picked]);

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: 0 };
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    setCam((c) => ({ ...c, yaw: d.yaw + dx * 0.006, pitch: clamp(d.pitch + dy * 0.005, -1.35, 1.35) }));
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved > 7) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hit = hits.current.find((h) => Math.hypot(x - h.x, y - h.y) <= h.r);
    if (!hit) return setPicked(null);
    if (hit.star) setPicked(hit.star);
    else {
      setPicked(null);
      onSystemSelect?.();
    }
  };
  const wheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setCam((c) => ({ ...c, zoom: clamp(c.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.55, 2.8) }));
  };

  return (
    <div ref={wrap} data-act="star-map" style={{ position: 'relative' }}>
      <div style={{ position: 'relative', height: H, overflow: 'hidden', borderRadius: 6, background: '#070d1b' }}>
        <canvas ref={glCanvas} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: webgl ? 1 : 0 }} />
        <canvas
          ref={canvas}
          data-act="star-map-canvas"
          width={900}
          height={H}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onWheel={wheel}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'grab', touchAction: 'none' }}
        />
        <div style={{ position: 'absolute', left: 10, top: 8, color: 'rgba(220,232,250,.75)', fontSize: 11, pointerEvents: 'none' }}>
          {webgl ? 'WebGL2 · 可旋转 / 点选' : 'Canvas CPU 回退 · 可旋转 / 点选'} · 100 ly / {stars.length} 颗邻星 · 背景点云 &gt;100 ly
        </div>
      </div>
      {/* 邻星信息卡:点了才出现 */}
      {picked && (
        <div
          data-act="star-card"
          style={{ marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(128,140,170,0.35)', background: 'rgba(10,16,30,0.92)', color: '#e6eefc', fontSize: 12, lineHeight: 1.7 }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b style={{ fontSize: 13 }}>{picked.name}</b>
            <span style={{ color: '#c9a15a', fontSize: 11.5 }}>恒星际未开放</span>
            <button className="ov-btn" data-act="star-card-close" onClick={() => setPicked(null)} style={{ marginLeft: 'auto', padding: '0 6px' }}>
              关闭
            </button>
          </div>
          <div style={{ opacity: 0.85 }}>
            {picked.spectral} 型 · 距离 {picked.distanceLy.toFixed(2)} 光年 · 质量 {picked.mass.toFixed(2)} M☉ · 有效温度 {Math.round(picked.tempK)} K · 光度 {picked.lum.toFixed(2)} L☉ · 年龄 {picked.ageGyr.toFixed(1)} 十亿年
          </div>
          <div style={{ opacity: 0.6, marginTop: 2 }}>
            这一档只做星图关系:航行物理、殖民、恒星际航线都还没开放(接口见 gen/interstellar.ts)。
          </div>
        </div>
      )}
    </div>
  );
}
