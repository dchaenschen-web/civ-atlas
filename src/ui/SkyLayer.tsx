/**
 * S5 天空层:一颗小地球仪 + 这一刻的天空(太阳方位 / 晨昏线 / 卫星与伴星方向)。
 * 只读展示,不改世界、不动国界;年份来自系统页顶部的时间轴。
 */
import { useEffect, useRef } from 'react';
import type { AstroDesign } from '../gen/astroDesign';
import { skyLayerOf, type SkySiblingInput } from '../gen/skyLayer';

export interface SkyLayerProps {
  design: AstroDesign;
  /** 时间轴的年份 */
  year: number;
  /** 看哪颗行星(默认主行星) */
  index?: number;
  /** 行星名(标签用) */
  name?: string;
  /** 卫星名 */
  moonNames?: string[];
  /** N8:本子星系的其他星体(同组行星/卫星),常驻显示它们的方向 */
  siblings?: SkySiblingInput[];
}

const S = 260;
const R = 96;

/** 度 → 画布上的方位角(0 = 正东,90 = 正北) */
function azToXY(azDeg: number, dist: number): [number, number] {
  const a = (azDeg * Math.PI) / 180;
  return [S / 2 + Math.cos(a) * dist, S / 2 - Math.sin(a) * dist];
}

export function SkyLayer({ design, year, index, name, moonNames, siblings }: SkyLayerProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const sky = skyLayerOf(design, year, index, siblings ?? []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(S * dpr);
    cv.height = Math.round(S * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);

    // 底:夜空
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, S, S);

    // 行星本体:先用大气/地表色铺一个圆
    const pl = design.planets[index ?? design.home.index] ?? design.planets[design.home.index];
    const base = pl.kind === 'gas' ? 'rgba(206,186,148,0.95)' : 'rgba(96,140,180,0.95)';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2);
    ctx.fillStyle = base;
    ctx.fill();

    // 昼半球:把太阳直射的那个经度转到正中,右半边亮、左半边暗;晨昏线是过球心的一条直径
    const lonRad = (sky.subsolarLonDeg * Math.PI) / 180;
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2);
    ctx.clip();
    // 夜半球(半边圆,随直射经度转)
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-lonRad);
    const g = ctx.createLinearGradient(-R, 0, R, 0);
    g.addColorStop(0, 'rgba(6,10,22,0.88)');
    g.addColorStop(0.46, 'rgba(6,10,22,0.82)');
    g.addColorStop(0.54, 'rgba(255,246,214,0.10)');
    g.addColorStop(1, 'rgba(255,246,214,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
    // 球面轮廓
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(210,224,244,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 太阳:画在方位角外侧
    const sunR = R + 22;
    const [sx, sy] = azToXY(sky.sunAzDeg, sunR);
    const sun = ctx.createRadialGradient(sx, sy, 1, sx, sy, 18);
    const sc = design.star.color;
    sun.addColorStop(0, `rgba(${sc.join(',')},0.95)`);
    sun.addColorStop(0.4, `rgba(${sc.join(',')},0.32)`);
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(sx, sy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgb(${sc.join(',')})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(226,234,248,0.9)';
    ctx.fillText('太阳', sx + 8, sy - 6);

    // 卫星:在内圈上按相位摆
    sky.moons.forEach((m) => {
      const [mx, my] = azToXY(m.azDeg, R * 0.62);
      ctx.beginPath();
      ctx.arc(mx, my, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(214,224,238,0.92)';
      ctx.fill();
      const nm = moonNames?.[m.index];
      if (nm) {
        ctx.font = '9.5px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200,214,235,0.8)';
        ctx.fillText(nm, mx + 5, my - 4);
      }
    });

    // N8:同子星系的其他星体
    for (const s of sky.siblings) {
      const [qx, qy] = azToXY(s.azDeg, R * 0.78);
      ctx.beginPath();
      ctx.arc(qx, qy, s.kind === 'moon' ? 2.6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = s.kind === 'moon' ? 'rgba(200,212,230,0.85)' : 'rgba(240,226,170,0.95)';
      ctx.fill();
      ctx.font = '9.5px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(220,232,248,0.85)';
      ctx.fillText(s.name, qx + 5, qy - 4);
    }
    // 伴星
    if (sky.companion) {
      const [bx, by] = azToXY(sky.companion.azDeg, R + 34);
      ctx.beginPath();
      ctx.arc(bx, by, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,232,200,0.95)';
      ctx.fill();
      ctx.font = '9.5px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,232,200,0.85)';
      ctx.fillText(sky.companion.name, bx + 5, by + 12);
    }

    // 方位字
    ctx.font = '9.5px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(160,180,205,0.55)';
    ctx.fillText('北', S / 2 - 5, 10);
    ctx.fillText('南', S / 2 - 5, S - 3);
    ctx.fillText('东', 3, S / 2 + 3);
    ctx.fillText('西', S - 12, S / 2 + 3);

    // 星球名
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,240,252,0.9)';
    ctx.fillText(name ?? '', 8, 16);
  }, [design, sky, index, name, moonNames]);

  return (
    <div data-act="sky-layer" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <canvas ref={ref} width={S} height={S} style={{ width: S, height: S, borderRadius: 8, display: 'block', background: '#0a1020' }} />
      <div style={{ fontSize: 12, lineHeight: 1.7, minWidth: 180 }}>
        <div>
          <b>第 {sky.year.toFixed(1)} 年</b>
          <span style={{ opacity: 0.6 }}> 的天空</span>
        </div>
        <div>太阳方位 {sky.sunAzDeg.toFixed(0)}°(0 = 正东)</div>
        <div>直射经度 {sky.subsolarLonDeg.toFixed(0)}° · 晨昏线 ±{sky.terminatorDeg}°</div>
        <div>一昼夜 {sky.dayHours.toFixed(1)} 小时 · 已过 {(sky.dayPhase * 100).toFixed(0)}%</div>
        {sky.moons.length > 0 && (
          <div>
            卫星 {sky.moons.length} 颗:
            {sky.moons.map((m) => `${moonNames?.[m.index] ?? `卫星${m.index + 1}`} ${m.azDeg.toFixed(0)}°`).join(' · ')}
          </div>
        )}
        {sky.companion && (
          <div>
            {sky.companion.name} 方位 {sky.companion.azDeg.toFixed(0)}°
            {sky.companion.lumRatio !== undefined ? ` · 亮度占 ${(sky.companion.lumRatio * 100).toFixed(0)}%` : ''}
          </div>
        )}
        <div style={{ opacity: 0.55, marginTop: 4 }}>天空层只作展示:按公转/自转周期推方位,不改世界、不动国界。</div>
      </div>
    </div>
  );
}
