/**
 * 星系示意图:一颗恒星、各行星的轨道、宜居带、卫星。
 *
 * 横轴默认对数(近轨道挤在中心、远行星也有位置),可以切线性;
 * 构型(双星 / 双行星 / 巨行星的卫星)在 P5 接上后,这里按 design 里的多恒星与嵌套轨道画,先把单星画对。
 * 纯画 design 里的数,不随机。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AstroDesign, PlanetDesign } from '../gen/astroDesign';
import { positionAtAU } from '../gen/orbitTime';

const W = 900;
const H = 340;
const CX = W * 0.5;
const CY = H * 0.5;
const R_IN = 46;
const R_OUT = Math.min(W, H) * 0.44;

export interface SystemDiagramProps {
  design: AstroDesign;
  names: string[];
  /** 选中的行星(默认主行星) */
  selected: number;
  onSelect: (index: number) => void;
  year?: number;
}

/** 岩石行星按温度上色:-40 冰蓝 → 0 青 → 20 绿 → 40 黄 → 90 红 */
function rockyColor(tempK: number): string {
  const t = Math.max(-60, Math.min(120, tempK - 273.15));
  const x = (t + 60) / 180;
  const c: [number, number, number] =
    x < 0.3 ? [120, 160, 220] : x < 0.45 ? [110, 190, 200] : x < 0.6 ? [130, 190, 120] : x < 0.78 ? [210, 190, 110] : [210, 120, 90];
  return `rgb(${c.join(',')})`;
}

function planetColor(p: PlanetDesign): string {
  if (p.kind === 'gas') return 'rgb(214,190,150)';
  return rockyColor(p.tempK);
}

export function SystemDiagram({ design, names, selected, onSelect, year }: SystemDiagramProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [log, setLog] = useState(true);
  const [showMoons, setShowMoons] = useState(true);
  const hits = useRef<{ i: number; x: number; y: number; r: number }[]>([]);

  const ordered = useMemo(() => design.planets.map((p, i) => ({ p, i })), [design]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);

    const as = ordered.map((o) => o.p.a);
    const aMin = Math.min(...as);
    const aMax = Math.max(...as);
    const aHz = Math.sqrt(design.star.lum);
    const map = (a: number): number => {
      if (aMax <= aMin) return R_IN;
      if (log) {
        const t = (Math.log(Math.max(1e-9, a)) - Math.log(aMin)) / (Math.log(aMax) - Math.log(aMin) || 1);
        return R_IN + t * (R_OUT - R_IN);
      }
      const t = (a - aMin) / (aMax - aMin);
      return R_IN + t * (R_OUT - R_IN);
    };

    // 宜居带:0.75–1.5 倍宜居带距离,画成半透明的绿环
    const hz0 = map(aHz * 0.75);
    const hz1 = map(aHz * 1.5);
    if (hz1 > hz0 + 2) {
      ctx.beginPath();
      ctx.arc(CX, CY, Math.max(hz0, 1), 0, Math.PI * 2);
      ctx.arc(CX, CY, hz1, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(110,200,120,0.10)';
      ctx.fill('evenodd');
      ctx.beginPath();
      ctx.arc(CX, CY, (hz0 + hz1) / 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(110,200,120,0.28)';
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 轨道 + 行星
    const hit: typeof hits.current = [];
    for (const { p, i } of ordered) {
      const r = map(p.a);
      ctx.beginPath();
      ctx.arc(CX, CY, r, 0, Math.PI * 2);
      ctx.strokeStyle = i === selected ? 'rgba(240,220,140,0.75)' : 'rgba(150,170,210,0.22)';
      ctx.lineWidth = i === selected ? 1.6 : 1;
      ctx.stroke();
      // 行星摆在一个由轨道周期推出来的位置(不是随机:相位按轨道由内到外错开);
      // 双固态行星的伴星紧挨着主行星画(同一轨道,画成一对)
      const isCompanion = design.binary?.index === i;
      const hm = design.habitableMoon;
      const isMoon = !!hm && hm.index === i;
      const isMoonParent = !!hm && hm.parent === i;
      const homeAng = (design.home.index * 0.9 + 0.4) % (Math.PI * 2);
      const parentAng = hm ? (hm.parent * 0.9 + 0.4) % (Math.PI * 2) : 0;
      const ang = isMoon ? parentAng + 0.16 : isCompanion ? homeAng + 0.16 : (i * 0.9 + 0.4) % (Math.PI * 2);
      const state = year === undefined ? null : positionAtAU({ ...p, phase0: ang }, year, design.star.mass);
      const x = CX + (state ? state.x / Math.max(1e-6, p.a) : Math.cos(ang)) * r;
      const y = CY + (state ? state.y / Math.max(1e-6, p.a) : Math.sin(ang)) * r;
      const pr = Math.max(3, Math.min(11, 2.6 + p.radius * 1.5));
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.fillStyle = planetColor(p);
      ctx.fill();
      if (i === design.home.index) {
        ctx.beginPath();
        ctx.arc(x, y, pr + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(240,220,140,0.9)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      // 卫星:只画选中/主行星的,不然太挤
      if (showMoons && p.moons.length && (i === selected || i === design.home.index)) {
        for (let k = 0; k < p.moons.length; k++) {
          const mr = pr + 7 + k * 4.5;
          const ma = 0.7 + k * 1.7;
          const mx = x + Math.cos(ma) * mr;
          const my = y + Math.sin(ma) * mr;
          ctx.beginPath();
          ctx.arc(mx, my, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(200,210,225,0.85)';
          ctx.fill();
        }
      }
      // 标签
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = i === selected ? '#f2e3b0' : 'rgba(190,205,225,0.85)';
      const label = `${names[i] ?? `行星 ${i + 1}`}${i === design.home.index ? '(主)' : ''}`;
      ctx.fillText(label, x + pr + 4, y - pr - 2);
      ctx.fillStyle = 'rgba(150,165,190,0.6)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(`${p.a.toFixed(2)}AU`, x + pr + 4, y + 9);
      hit.push({ i, x, y, r: pr + 4 });
      // 双固态行星 / 宜居卫星:用虚线连到伴星 / 母行星
      if (isCompanion || isMoon) {
        const base = isMoon ? parentAng : homeAng;
        const hx = CX + Math.cos(base) * r;
        const hy = CY + Math.sin(base) * r;
        ctx.beginPath();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(240,220,140,0.5)';
        ctx.lineWidth = 1;
        ctx.moveTo(hx, hy);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 恒星
    if (typeof ctx.createRadialGradient === 'function') {
      const g = ctx.createRadialGradient(CX, CY, 2, CX, CY, 26);
      g.addColorStop(0, `rgba(${design.star.color.join(',')},0.95)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(CX, CY, 26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(CX, CY, 8, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${design.star.color.join(',')})`;
    ctx.fill();
    ctx.fillStyle = 'rgba(190,205,225,0.8)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(design.star.label, CX - 18, CY + 26);

    // 双恒星:伴星画在主星旁边(真实间距在图上太小,至少 18px),互绕轨道用虚线圈
    const bs = design.binaryStar;
    if (bs) {
      const rr = Math.max(18, map(bs.sepAU));
      ctx.beginPath();
      ctx.arc(CX, CY, rr, 0, Math.PI * 2);
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(255,240,220,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const bx = CX + Math.cos(-0.6) * rr;
      const by = CY + Math.sin(-0.6) * rr;
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${bs.companion.color.join(',')})`;
      ctx.fill();
      ctx.fillStyle = 'rgba(190,205,225,0.75)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('伴星', bx + 7, by + 4);
    }

    hits.current = hit;
  }, [design, names, selected, log, showMoons, ordered, year]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    let best = -1;
    let bestD = Infinity;
    for (const h of hits.current) {
      const d = Math.hypot(x - h.x, y - h.y);
      if (d < h.r + 6 && d < bestD) {
        bestD = d;
        best = h.i;
      }
    }
    if (best >= 0) onSelect(best);
  };

  const sel = ordered.find((o) => o.i === selected)?.p;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, fontSize: 12, opacity: 0.75 }}>
        <span>星系示意(点行星可选中)</span>
        <button className="ov-btn" data-act="diagram-log" onClick={() => setLog((v) => !v)}>
          {log ? '对数轴' : '线性轴'}
        </button>
        <button className="ov-btn" data-act="diagram-moons" onClick={() => setShowMoons((v) => !v)}>
          {showMoons ? '藏卫星' : '显示卫星'}
        </button>
        {sel && <span style={{ marginLeft: 'auto' }}>{`选中:${names[selected] ?? ''} · ${sel.kind === 'gas' ? '气态' : '岩石'} · ${sel.a.toFixed(2)} AU · ${(sel.tempK - 273.15).toFixed(0)}°C`}</span>}
      </div>
      <canvas ref={ref} onClick={click} style={{ width: '100%', display: 'block', borderRadius: 8, cursor: 'pointer' }} aria-label="星系示意图" />
    </div>
  );
}
