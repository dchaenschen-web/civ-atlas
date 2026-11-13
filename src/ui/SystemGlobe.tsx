/**
 * 3D 星系图:同一套三维投影(透视相机 + 可拖拽旋转/滚轮缩放),
 * 星空、轨道、宜居带、小行星带、行星、名字都画在 2D canvas 上(逐帧投影)。
 *
 * 为什么先 CPU 画:星系图要的"点/线/标签"用 canvas 投影足够,也天然有"没有 WebGL2 也能看"的退化;
 * GPU 加速版留在 render/systemGlobe3d.ts(下一步启用)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AstroDesign, PlanetDesign } from '../gen/astroDesign';
import type { BeltDesign } from '../gen/system';
import { positionAtAU } from '../gen/orbitTime';
import { moonPeriodDays } from '../gen/skyLayer';
import { binaryStarPair, cameraEye, createSystemGl, lookAt, multiply, perspective, planetPhase, planetPos, project, systemScene } from '../render/systemGlobe3d';
import type { SystemCamera } from '../render/systemGlobe3d';

export interface SystemGlobeProps {
  design: AstroDesign;
  names: string[];
  belts: readonly BeltDesign[];
  selected: number;
  onSelect: (index: number) => void;
  /** 选中一颗卫星(行星下标, 卫星下标) */
  onSelectMoon?: (planet: number, moon: number) => void;
  /** 双击/回车打开这颗行星(Studio:进地球仪) */
  onOpen?: (index: number, at?: { x: number; y: number; r: number }) => void;
  /** 相机推进到这颗行星(推到位后回调 onFocusDone);null = 不动 */
  focusIndex?: number | null;
  /** 推进到的是这颗卫星(而不是 focusIndex 那颗行星本身) */
  focusMoon?: { p: number; m: number } | null;
  onFocusDone?: () => void;
  /** 相机拉远回恒星(返回星系视角时用;拉到位回调 onPullDone) */
  pullOut?: boolean;
  onPullDone?: () => void;
  /** 从这颗行星的位置起步(挂载时相机贴近它,然后自动拉远到全景) */
  startFocusIndex?: number | null;
  /** 行星贴图(US 风格:星图里直接画带贴图的球);没有的用纯色点 */
  bodyTex?: ReadonlyMap<number, HTMLCanvasElement>;
  /** 卫星贴图(键 `${行星}-${卫星}`) */
  moonTex?: ReadonlyMap<string, HTMLCanvasElement>;
  /** 贴图版本号(贴图懒生成完成后变化) */
  texVersion?: number;
  /** 时间轴年份；未提供时使用静态初相位 */
  year?: number;
  /** 高度:数字(默认 380)或 'fill'(铺满容器,Studio 星系视角用) */
  height?: number | 'fill';
}

const H = 380;
const FOV = (52 * Math.PI) / 180;

/**
 * 星系图上的小按钮固定用「深底浅字」:这张图永远是深色画布,而宿主页面可能是浅色主题
 * (树页 data-theme="light"),靠 .ov-btn 会继承深色字 → 深字压深底,看着就是四个空白按钮。
 */
const globeBtn: React.CSSProperties = {
  padding: '2px 7px',
  fontSize: 11,
  lineHeight: 1.3,
  color: '#dbe6f7',
  background: 'rgba(14,22,38,0.72)',
  border: '1px solid rgba(120,150,200,0.35)',
  borderRadius: 6,
  cursor: 'pointer',
};

function planetColor(p: PlanetDesign): string {
  if (p.kind === 'gas') return 'rgb(222,199,158)';
  const t = Math.max(-60, Math.min(120, p.tempK - 273.15));
  const x = (t + 60) / 180;
  const c: [number, number, number] = x < 0.3 ? [120, 160, 220] : x < 0.5 ? [110, 190, 200] : x < 0.66 ? [130, 190, 120] : x < 0.82 ? [210, 190, 110] : [210, 120, 90];
  return `rgb(${c.join(',')})`;
}

export function SystemGlobe({ design, names, belts, selected, onSelect, onSelectMoon, onOpen, focusIndex = null, focusMoon = null, onFocusDone, pullOut = false, onPullDone, startFocusIndex = null, bodyTex, moonTex, texVersion, year, height }: SystemGlobeProps) {
  /** 实际高度:数字或铺满(canvas 与容器都用它) */
  const boxH = height === 'fill' ? '100%' : (height ?? H);
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const scene = useMemo(() => systemScene(design, belts), [design, belts]);
  const [dpr] = useState(() => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const [size, setSize] = useState({ w: 900, h: height === 'fill' ? H : (height ?? H) });
  const [cam, setCam] = useState<SystemCamera>({ yaw: 0.72, pitch: 0.45, dist: 16 });
  /** 相机推进进度 0–1(目标行星的绘制半径跟着它长大,到位时填满画面) */
  const [focusT, setFocusT] = useState(0);
  /** 相机跟随的天体(播放时相机跟着它走);null = 不跟随 */
  const [followIdx, setFollowIdx] = useState<number | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const [showMoons, setShowMoons] = useState(true);
  const glCanvas = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<ReturnType<typeof createSystemGl> | null>(null);
  const [gpu, setGpu] = useState(false);
  const [gpuTried, setGpuTried] = useState(false);
  const hits = useRef<{ i: number; x: number; y: number; moonP?: number; moonM?: number }[]>([]);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setSize({ w: Math.max(320, el.clientWidth), h: height === 'fill' ? Math.max(240, el.clientHeight) : (height ?? H) });
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // WebGL2 加速:能建起来就把星空/轨道/小行星带交给 GPU;建不起来(没有 WebGL2 / 报错)就整条走 CPU
  useEffect(() => {
    const cv = glCanvas.current;
    let ok = false;
    if (cv) {
      try {
        glRef.current = createSystemGl(cv);
        ok = !!glRef.current;
      } catch {
        glRef.current = null;
      }
    }
    setGpu(ok);
    setGpuTried(true);
    return () => {
      glRef.current?.dispose();
      glRef.current = null;
    };
  }, []);

  // 场景数据给 GPU
  useEffect(() => {
    if (glRef.current) glRef.current.setScene(scene);
  }, [scene, gpu]);

  // U1:把行星喂给 GPU 球体渲染器(位置 = 场景单位;半径是视觉半径,按真实半径缩放)
  useEffect(() => {
    const r = glRef.current;
    if (!r || !gpu) return;
    // 分离双星:行星绕主星(A)而不是质心
    const focalBodies = (size.h / 2) / Math.tan((55 * Math.PI) / 360);
    const starPairNow = binaryStarPair(design, year);
    const orbitOff: [number, number, number] = design.binaryStar && design.binaryStar.tier !== 'close' && starPairNow ? starPairNow.main : [0, 0, 0];
    const list = design.planets
      .filter((_p, i) => !(showMoons === false && design.habitableMoon?.index === i) && !(design.binary && design.binary.index === i))
      .map((p, i) => {
        const isMoon = design.habitableMoon?.index === i;
        const ang = isMoon ? planetPhase(design.habitableMoon!.parent) + 0.16 : planetPhase(i);
        const st = year === undefined ? null : positionAtAU({ ...p, nodeDeg: -p.nodeDeg, phase0: ang }, year, design.star.mass);
        const pos = st ? [st.x, st.z, st.y] : planetPos(p, ang);
        return {
          key: `p${i}`,
          pos: [(pos[0] + orbitOff[0]) * scene.scale, (pos[1] + orbitOff[1]) * scene.scale, (pos[2] + orbitOff[2]) * scene.scale] as [number, number, number],
          // 视觉半径:和原来 2D 圆的 3–9px 大致对应(dist≈16、高≈600 时 0.08 场景单位 ≈ 3px)
          radius: Math.max(1e-6, p.radius * (6371 / 1.496e8) * scene.scale),
          // 自转(按自转周期,单位小时)+ 自转轴倾角
          spin: (((year ?? 0) * 365.25 * 24) / Math.max(0.1, p.rotation)) * Math.PI * 2,
          tilt: (p.tilt * Math.PI) / 180,
          tex: bodyTex?.get(i) ?? null,
          tint: p.kind === 'gas' ? [0.85, 0.78, 0.62] as [number, number, number] : p.tempK < 200 ? [0.68, 0.76, 0.9] as [number, number, number] : [0.72, 0.7, 0.62] as [number, number, number],
        };
      });
    // U1:双固态伴星 —— 主行星位置 + 互绕间距(在黄道面里绕质心转)
    const binIdx = design.binary?.index;
    const bin = design.binary;
    if (bin && binIdx !== undefined && binIdx >= 0 && binIdx !== design.home.index) {
      const homeP = design.planets[design.home.index];
      const compP = design.planets[binIdx];
      if (homeP && compP) {
        const ang0 = planetPhase(design.home.index);
        const stHome = year === undefined ? null : positionAtAU({ ...homeP, nodeDeg: -homeP.nodeDeg, phase0: ang0 }, year, design.star.mass);
        const hp = stHome ? [stHome.x, stHome.z, stHome.y] : planetPos(homeP, ang0);
        // 真实互绕间距在 1AU 视距下不足 1 像素:显示上按"主行星轨道半径的 1.6%"给可见下限(周期仍是真实值)
        // 屏幕间距下限约 14px:真实互绕间距在 AU 视距下远小于 1px,否则伴星与主星重叠看不见
        const sepScene = Math.max(bin.separationAU * scene.scale, (14 * Math.max(1e-6, cam.dist)) / focalBodies);
          // 互绕按真实周期
          const theta = ((year ?? 0) * 365.25 / Math.max(0.01, bin.periodDays)) * Math.PI * 2;
        // 伴星相对主行星的偏移(场景单位)
        const off = [Math.cos(theta) * sepScene, 0, Math.sin(theta) * sepScene] as [number, number, number];
        list.push({
          key: `p${binIdx}` + '-bin',
          pos: [(hp[0] + orbitOff[0]) * scene.scale + off[0], (hp[1] + orbitOff[1]) * scene.scale + off[1], (hp[2] + orbitOff[2]) * scene.scale + off[2]],
          radius: Math.max(1e-6, compP.radius * (6371 / 1.496e8) * scene.scale),
          spin: (((year ?? 0) * 365.25 * 24) / Math.max(0.1, compP.rotation)) * Math.PI * 2,
          tilt: (compP.tilt * Math.PI) / 180,
          tex: bodyTex?.get(binIdx) ?? null,
          tint: compP.kind === 'gas' ? [0.85, 0.78, 0.62] : [0.72, 0.7, 0.62],
        });
      }
    }
    // U1:卫星 —— 严格开普勒圆轨道:真实间距(AU)+ 周期(天)+ 母行星倾角,不用视觉放大
    // 星系全景不画卫星(太密);进入子星系视角(跟随某行星/相机很近)才画
    // 子星系视角:跟随某行星、相机足够近、或有选中行星(否则卫星/轨道在星系全景里太小)
    const subSystemView = followIdx !== null || cam.dist < 8 || selected >= 0;
    const R_EARTH_AU = 6371 / 1.496e8;
    if (showMoons !== false && subSystemView) {
      const focusForMoons = followIdx ?? selected ?? (design.habitableMoon ? design.habitableMoon.parent : null);
      if (focusForMoons !== null && design.planets[focusForMoons]) {
        const p = design.planets[focusForMoons];
        const pi = focusForMoons;
        (p.moons ?? []).forEach((m, mi) => {
          const ang = planetPhase(pi);
          const stP = year === undefined ? null : positionAtAU({ ...p, nodeDeg: -p.nodeDeg, phase0: ang }, year, design.star.mass);
          const pp0 = stP ? [stP.x, stP.z, stP.y] : planetPos(p, ang);
          const pp = [pp0[0] + orbitOff[0], pp0[1] + orbitOff[1], pp0[2] + orbitOff[2]];
          // 间距:distance 单位 = 母行星半径数 → AU
          const sepAU = Math.max(1, m.distance) * Math.max(0.2, p.radius) * R_EARTH_AU;
          const sepMinAU = (26 * Math.max(1e-6, cam.dist)) / focalBodies / scene.scale;
          const sepDraw = Math.max(sepAU, sepMinAU);
          // 周期:开普勒(绕母行星质量),真实天数
          const periodDays = Math.max(0.01, moonPeriodDays(Math.max(1, m.distance), Math.max(0.2, p.radius), p.mass));
          const theta = ((year ?? 0) * 365.25 / periodDays + mi * 2.39996) % (Math.PI * 2);
          // 轨道面:按母行星自转倾角倾斜(绕 x 轴转)
          const ct = Math.cos((p.tilt * Math.PI) / 180);
          const st = Math.sin((p.tilt * Math.PI) / 180);
          const dx = Math.cos(theta) * sepDraw;
          const dz = Math.sin(theta) * sepDraw;
          const dy = dz * st;
          const dz2 = dz * ct;
          list.push({
            key: `m${pi}-${mi}` + '-moon',
            pos: [(pp[0] + dx) * scene.scale, (pp[1] + dy) * scene.scale, (pp[2] + dz2) * scene.scale],
            // 视觉半径仍按卫星自身半径(真实比例在 AU 尺度下看不见,放大视距后才显现)
            // 卫星真实半径太小(真实尺度下 1px 都不到):按母行星视觉半径的 8% 给一个可见下限
            radius: Math.min(0.02, Math.max((1.6 * Math.max(1e-6, cam.dist)) / focalBodies, Math.max(m.radius * (6371 / 1.496e8), Math.max(0.2, p.radius) * (6371 / 1.496e8) * 0.08) * scene.scale)),
            // 潮汐锁定的卫星:自转角 = 轨道相位(永远同一面朝母行星)
            spin: theta,
            tilt: (p.tilt * Math.PI) / 180,
            tex: moonTex?.get(`${pi}-${mi}`) ?? null,
            tint: [0.72, 0.73, 0.76],
          });
        });
      }
    }
    r.setBodies(list);
    // 卫星轨道线数据(GPU,和行星轨道同一 line 程序):子星系视角下才有
    {
      const fPlanet = followIdx ?? selected ?? (design.habitableMoon ? design.habitableMoon.parent : null);
      const subsys = followIdx !== null || cam.dist < 8 || selected >= 0;
      if (!subsys || fPlanet === null || !design.planets[fPlanet]) {
        r.setMoonOrbits(new Float32Array(0));
        return;
      }
      const pp = design.planets[fPlanet];
      const ang0 = planetPhase(fPlanet);
      const st0 = year === undefined ? null : positionAtAU({ ...pp, nodeDeg: -pp.nodeDeg, phase0: ang0 }, year, design.star.mass);
      const parentPos = st0 ? [st0.x, st0.z, st0.y] : planetPos(pp, ang0);
      const offMain = design.binaryStar && design.binaryStar.tier !== 'close' ? (binaryStarPair(design, year)?.main ?? [0, 0, 0]) : [0, 0, 0];
      const bx = parentPos[0] + offMain[0];
      const by = parentPos[1];
      const bz = parentPos[2] + offMain[2];
      const ct = Math.cos((pp.tilt * Math.PI) / 180);
      const stt = Math.sin((pp.tilt * Math.PI) / 180);
      const focalM = (size.h / 2) / Math.tan((55 * Math.PI) / 360);
      const segs: number[] = [];
      (pp.moons ?? []).forEach((m, mi) => {
        const sepAU = Math.max(1, m.distance) * Math.max(0.2, pp.radius) * (6371 / 1.496e8);
        const sep = Math.max(sepAU * scene.scale, (26 * Math.max(1e-6, cam.dist)) / focalM) / scene.scale;
        const col = mi % 2 ? [0.55, 0.64, 0.85] : [0.72, 0.8, 0.95];
        const N = 96;
        for (let k = 0; k < N; k++) {
          const t0 = (k / N) * Math.PI * 2;
          const t1 = ((k + 1) / N) * Math.PI * 2;
          const p0 = [(bx + Math.cos(t0) * sep) * scene.scale, (by + Math.sin(t0) * sep * stt) * scene.scale, (bz + Math.sin(t0) * sep * ct) * scene.scale];
          const p1 = [(bx + Math.cos(t1) * sep) * scene.scale, (by + Math.sin(t1) * sep * stt) * scene.scale, (bz + Math.sin(t1) * sep * ct) * scene.scale];
          segs.push(p0[0], p0[1], p0[2], col[0], col[1], col[2], p1[0], p1[1], p1[2], col[0], col[1], col[2]);
        }
      });
      r.setMoonOrbits(new Float32Array(segs));
    }
  }, [gpu, design, year, bodyTex, scene, showMoons, followIdx, cam.dist, selected, moonTex, texVersion]);

  // 滚轮缩放(非 passive,免得页面跟着滚)
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCam((c) => ({ ...c, dist: Math.max(c.at ? 1e-5 : 5, Math.min(70, c.dist * (e.deltaY > 0 ? 1.12 : 0.89))) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const { w, h } = size;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const c = camRef.current;
    const mvp = glRef.current ? glRef.current.draw(c, w, h, dpr) : multiply(perspective(FOV, w / h, Math.max(1e-7, Math.min(0.05, cam.dist * 0.01)), Math.max(400, cam.dist * 50)), lookAt(cameraEye(c), c.at ?? [0, 0, 0], [0, 1, 0]));
    const drawBackground = !glRef.current;
    const maxAU = Math.max(0.1, ...design.planets.map((p) => p.a));
    // N7:只保留真实比例(对数视距已移除)
    const toScreen = (p: [number, number, number]): [number, number] | null => project(mvp, w, h, [p[0] * scene.scale, p[1] * scene.scale, p[2] * scene.scale]);

    // 星空(GPU 画时跳过)
    const st = scene.stars;
    if (drawBackground) {
    for (let i = 0; i < st.length; i += 7) {
      const xy = toScreen([st[i], st[i + 1], st[i + 2]]);
      if (!xy || xy[0] < -20 || xy[0] > w + 20 || xy[1] < -20 || xy[1] > h + 20) continue;
      const alpha = 0.25 + 0.5 * (1 - st[i + 3] / 3.2);
      ctx.fillStyle = `rgba(${Math.round(st[i + 4] * 255)},${Math.round(st[i + 5] * 255)},${Math.round(st[i + 6] * 255)},${alpha.toFixed(2)})`;
      const s = st[i + 3] >= 1.7 ? 1.7 : 1;
      ctx.fillRect(xy[0], xy[1], s, s);
    }
    }

    // 轨道 + 宜居带
    const ln = scene.lines;
    if (drawBackground) {
    for (let k = 0; k < ln.length; k += 9) {
      const a = toScreen([ln[k], ln[k + 1], ln[k + 2]]);
      const b = toScreen([ln[k + 3], ln[k + 4], ln[k + 5]]);
      if (!a || !b) continue;
      ctx.strokeStyle = `rgba(${Math.round(ln[k + 6] * 255)},${Math.round(ln[k + 7] * 255)},${Math.round(ln[k + 8] * 255)},0.42)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    }

    // 小行星带
    const bp = scene.beltPoints;
    if (drawBackground) {
    ctx.fillStyle = 'rgba(196,186,166,0.55)';
    for (let k = 0; k < bp.length; k += 6) {
      const xy = toScreen([bp[k], bp[k + 1], bp[k + 2]]);
      if (!xy) continue;
      ctx.fillRect(xy[0], xy[1], 1.2, 1.2);
    }
    }

    // 恒星:N3 双恒星时主星与伴星各画一颗(绕共同质心)
    const drawStar = (xy: [number, number], col: [number, number, number], radius: number, label: string) => {
      const g = ctx.createRadialGradient(xy[0], xy[1], 1, xy[0], xy[1], radius * 4.2);
      g.addColorStop(0, `rgba(${col.join(',')},0.95)`);
      g.addColorStop(0.35, `rgba(${col.join(',')},0.35)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], radius * 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${col.join(',')})`;
      ctx.fill();
      ctx.fillStyle = 'rgba(200,214,235,0.85)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(label, xy[0] - 16, xy[1] + radius * 4 + 12);
    };
    const pair = binaryStarPair(design, year);
    if (pair) {
      const xyMain = toScreen(pair.main);
      const xyComp = toScreen(pair.companion);
      if (xyMain && xyComp) {
        // 两星之间的虚线(示意"互绕")
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(220,205,150,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xyMain[0], xyMain[1]);
        ctx.lineTo(xyComp[0], xyComp[1]);
        ctx.stroke();
        ctx.restore();
        const compR = Math.max(3.4, Math.min(6, 3 + Math.log10(1 + (design.binaryStar?.companion.lum ?? 1)) * 1.6));
        drawStar(xyComp, design.binaryStar!.companion.color, compR, `${design.binaryStar!.companion.label}(伴)`);
        drawStar(xyMain, design.star.color, 7, design.star.label);
        // 质心
        const bary = toScreen([0, 0, 0]);
        if (bary) {
          ctx.beginPath();
          ctx.arc(bary[0], bary[1], 2.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(240,220,150,0.85)';
          ctx.fill();
        }
        // 三合星:第三颗(C)按压缩半径画在视野里,配一条虚线大圆示意它的远轨道
        const third = design.binaryStar?.members?.[2]?.star;
        if (third) {
          const bary = toScreen([0, 0, 0]);
          if (bary) {
            const rr = Math.min(w, h) * 0.42;
            const ang = Math.atan2(pair.third?.[2] ?? 0, pair.third?.[0] ?? 1);
            const cx = bary[0] + Math.cos(ang) * rr;
            const cy = bary[1] + Math.sin(ang) * rr * 0.55;
            ctx.save();
            ctx.setLineDash([2, 6]);
            ctx.strokeStyle = 'rgba(200,180,140,0.22)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(bary[0], bary[1], rr, rr * 0.55, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            drawStar([cx, cy], third.color, Math.max(2.6, Math.min(5, 2.4 + Math.log10(1 + third.lum) * 1.6)), third.label + '(C)');
          }
        }
      } else if (xyMain) drawStar(xyMain, design.star.color, 7, design.star.label);
    } else {
      const star = toScreen([0, 0, 0]);
      if (star) drawStar(star, design.star.color, 7, design.star.label);
    }

    // 行星与名字
    const hit: { i: number; x: number; y: number; moonP?: number; moonM?: number }[] = [];
    const homeAng = planetPhase(design.home.index);
    const binPair = design.binary && showMoons ? design.binary : undefined;
    // 分离双星:主星偏移(和 GPU 一致)
    const pairStar = design.binaryStar && design.binaryStar.tier !== 'close' ? binaryStarPair(design, year) : null;
    const offMain2: [number, number, number] = pairStar ? pairStar.main : [0, 0, 0];
    const focal2 = (size.h / 2) / Math.tan((55 * Math.PI) / 360);
    /** 主行星当年的位置(AU,含主星偏移) */
    const homePosYear = (): [number, number, number] => {
      const homeP = design.planets[design.home.index];
      const st = year === undefined ? null : positionAtAU({ ...homeP, nodeDeg: -homeP.nodeDeg, phase0: homeAng }, year, design.star.mass);
      const b = st ? [st.x, st.z, st.y] : planetPos(homeP, homeAng);
      return [b[0] + offMain2[0], b[1] + offMain2[1], b[2] + offMain2[2]];
    };
    /** 双固态伴星相对主行星的偏移(场景单位;14px 屏幕下限,和 GPU 同一公式) */
    const pairOffScene = (): [number, number, number] => {
      if (!binPair) return [0, 0, 0];
      const sepAU = Math.max(binPair.separationAU, (14 * Math.max(1e-6, cam.dist)) / focal2 / scene.scale);
      const theta = ((year ?? 0) * 365.25 / Math.max(0.01, binPair.periodDays)) * Math.PI * 2;
      return [Math.cos(theta) * sepAU, 0, Math.sin(theta) * sepAU];
    };
    const hm = design.habitableMoon;
    /** 双固态:主/伴的屏幕位置(直接从同一套 scene 坐标投影,不再另做像素推导) */
    const pairScreens: Record<string, [number, number]> = {};
    if (binPair) {
      const hp = homePosYear();
      const off = pairOffScene();
      const a = toScreen([hp[0], hp[1], hp[2]]);
      const b = toScreen([hp[0] + off[0], hp[1] + off[1], hp[2] + off[2]]);
      if (a) pairScreens.home = a;
      if (b) pairScreens.comp = b;
    }
    design.planets.forEach((p, i) => {
      const isCompanion = design.binary?.index === i;
      const isMoon = !!hm && hm.index === i;
      if (isMoon && !showMoons) return;
      const ang = isMoon ? planetPhase(hm!.parent) + 0.16 : planetPhase(i);
      const pairKey = isCompanion ? 'comp' : i === design.home.index ? 'home' : null;
      const pairScreen = pairKey ? pairScreens[pairKey] : undefined;
      // orbitTime uses the xy ecliptic; the renderer uses xz with the opposite node convention.
      const state = year === undefined ? null : positionAtAU({ ...p, nodeDeg: -p.nodeDeg, phase0: ang }, year, design.star.mass);
      const widePair2 = design.binaryStar && design.binaryStar.tier !== 'close' ? binaryStarPair(design, year) : null;
      const off2: [number, number, number] = widePair2 ? widePair2.main : [0, 0, 0];
      const basePos = state ? [state.x, state.z, state.y] : planetPos(p, ang);
      const xy = pairScreen ?? toScreen([basePos[0] + off2[0], basePos[1] + off2[1], basePos[2] + off2[2]]);
      if (!xy) return;
      const baseR = Math.max(3.2, Math.min(9, 2.6 + p.radius * 1.4));
      // 相机推进时:被瞄准的行星按进度长大(到位时半径约半屏),其他东西淡出
      const isFocus = focusIndex === i && focusT > 0;
      const r = isFocus ? baseR + focusT * Math.min(size.w, size.h) * 0.44 : baseR;
      if (focusIndex !== null && focusT > 0.15 && !isFocus) ctx.globalAlpha = Math.max(0, 0.55 - focusT * 0.6);
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
      // 真实尺度下远处行星不到 1 像素:补一个小圆点(只影响远处观感,不改比例)
      if (gpu) {
        const distCam = Math.max(0.001, cam.dist);
        const focal0 = (size.h / 2) / Math.tan((55 * Math.PI) / 360);
        const rTrue = p.radius * (6371 / 1.496e8) * scene.scale;
        const px = (focal0 * rTrue) / distCam;
        if (px < 2) {
          ctx.fillStyle = planetColor(p);
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!gpu || isCompanion) ctx.fillStyle = planetColor(p);
      if (!gpu || isCompanion) ctx.fill();
      // US 风格:半径够大就贴上这颗行星的真实贴图(equirect 纹理裁进圆盘 + 明暗)
      const tex = bodyTex?.get(i);
      if (!gpu && tex && r >= 4) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
        ctx.clip();
        // 贴图按"圆盘直径"铺满;经度方向裁掉两侧(不是正对时也大致对)
        const th = year === undefined ? 0 : year * 0.02;
        const srcW = tex.height * 1.0;
        const sx = (tex.width * (0.5 + 0.18 * Math.sin(th + i)) - srcW / 2 + tex.width) % tex.width;
        ctx.drawImage(tex, sx, 0, srcW, tex.height, xy[0] - r, xy[1] - r, r * 2, r * 2);
        // 昼夜/明暗:太阳在原点,按行星与太阳的相对方向压暗
        const lx = -xy[0] / Math.max(1, Math.hypot(xy[0], xy[1]));
        const ly = -xy[1] / Math.max(1, Math.hypot(xy[0], xy[1]));
        const lit = ctx.createRadialGradient(xy[0] + lx * r * 0.45, xy[1] + ly * r * 0.45, r * 0.1, xy[0], xy[1], r * 1.15);
        lit.addColorStop(0, 'rgba(255,255,255,0.16)');
        lit.addColorStop(0.55, 'rgba(0,0,0,0)');
        lit.addColorStop(1, 'rgba(0,0,0,0.68)');
        ctx.fillStyle = lit;
        ctx.fillRect(xy[0] - r, xy[1] - r, r * 2, r * 2);
        ctx.restore();
      }
      if (i === selected) {
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(240,220,140,0.95)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else if (i === design.home.index) {
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(240,220,140,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = i === selected ? '#f2e3b0' : 'rgba(205,218,238,0.92)';
      const label = `${names[i] ?? `行星 ${i + 1}`}${i === design.home.index ? '(主)' : isCompanion ? '(伴)' : isMoon ? '(卫)' : ''}`;
      ctx.fillText(label, xy[0] + r + 4, xy[1] - 3);
      ctx.fillStyle = 'rgba(160,175,200,0.65)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(`${p.a.toFixed(2)}AU`, xy[0] + r + 4, xy[1] + 10);
      ctx.globalAlpha = 1;
      hit.push({ i, x: xy[0], y: xy[1] });
    });
    // 双固态行星(arch = 1):画质心(两星连线的中点)与两星互绕的连线
    const bin = design.binary;
    if (bin && showMoons) {
      const home = design.planets[design.home.index];
      const comp = design.planets[bin.index];
      if (home && comp) {
        const p1 = pairScreens.home;
        const p2 = pairScreens.comp;
        if (p1 && p2) {
          // 质量比定质心位置(home 与伴星的质量都在 design 里)
          const m1 = Math.max(1e-9, home.mass);
          const m2 = Math.max(1e-9, comp.mass);
          const t = m1 / (m1 + m2);
          const bx = p1[0] + (p2[0] - p1[0]) * (1 - t);
          const by = p1[1] + (p2[1] - p1[1]) * (1 - t);
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = 'rgba(200,180,120,0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
          ctx.stroke();
          ctx.restore();
          ctx.beginPath();
          ctx.arc(bx, by, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(240,220,150,0.9)';
          ctx.fill();
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillStyle = 'rgba(240,220,150,0.8)';
          ctx.fillText('质心', bx + 5, by + 12);
        }
      }
    }
    // 子星系视角:跟随某行星、相机足够近、或有选中行星(否则卫星/轨道在星系全景里太小)
    const subSystemView = followIdx !== null || cam.dist < 8 || selected >= 0;
    // 卫星:子星系视角下画轨道 —— 和行星轨道同一种做法:3D 采样圆 + 逐点投影
    if (subSystemView) {
      const focusPlanet = followIdx ?? selected ?? (design.habitableMoon ? design.habitableMoon.parent : null);
      const focal = (size.h / 2) / Math.tan((55 * Math.PI) / 360);
      const distCam = Math.max(1e-6, cam.dist);
      if (focusPlanet !== null && design.planets[focusPlanet]) {
        const pp = design.planets[focusPlanet];
        const ang0 = planetPhase(focusPlanet);
        const st0 = year === undefined ? null : positionAtAU({ ...pp, nodeDeg: -pp.nodeDeg, phase0: ang0 }, year, design.star.mass);
        const parentPos = st0 ? [st0.x, st0.z, st0.y] : planetPos(pp, ang0);
        const offMain = design.binaryStar && design.binaryStar.tier !== 'close' ? (binaryStarPair(design, year)?.main ?? [0, 0, 0]) : [0, 0, 0];
        const bx = parentPos[0] + offMain[0];
        const by = parentPos[1];
        const bz = parentPos[2] + offMain[2];
        const ct = Math.cos((pp.tilt * Math.PI) / 180);
        const stt = Math.sin((pp.tilt * Math.PI) / 180);
        const sepOf = (m: { distance: number }) => {
          const sepAU = Math.max(1, m.distance) * Math.max(0.2, pp.radius) * (6371 / 1.496e8);
          return Math.max(sepAU * scene.scale, (12 * distCam) / focal) / scene.scale;
        };
        (pp.moons ?? []).forEach((m, mi) => {
          const sep = sepOf(m);
          ctx.save();
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = mi % 2 ? 'rgba(150,175,215,0.32)' : 'rgba(190,205,235,0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          let started = false;
          for (let k = 0; k <= 96; k++) {
            const th = (k / 96) * Math.PI * 2;
            const dx = Math.cos(th) * sep;
            const dz = Math.sin(th) * sep;
            const q = toScreen([bx + dx, by + dz * stt, bz + dz * ct]);
            if (!q) {
              started = false;
              continue;
            }
            if (!started) {
              ctx.moveTo(q[0], q[1]);
              started = true;
            } else ctx.lineTo(q[0], q[1]);
          }
          ctx.stroke();
          ctx.restore();
        });
        // 命中区:卫星当前位置(和轨道同一套公式)
        (pp.moons ?? []).forEach((m, mi) => {
          const sep = sepOf(m);
          const th = ((year ?? 0) * 365.25 / Math.max(0.01, moonPeriodDays(Math.max(1, m.distance), Math.max(0.2, pp.radius), pp.mass)) + mi * 2.39996) % (Math.PI * 2);
          const dx = Math.cos(th) * sep;
          const dz = Math.sin(th) * sep;
          const q = toScreen([bx + dx, by + dz * stt, bz + dz * ct]);
          if (q) hit.push({ i: focusPlanet, moonP: focusPlanet, moonM: mi, x: q[0], y: q[1] });
          if (q) {
            ctx.fillStyle = 'rgba(220,230,245,0.95)';
            ctx.beginPath();
            ctx.arc(q[0], q[1], 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    }
    hits.current = hit;
    (canvas.current as unknown as { __hits?: unknown }).__hits = hit;
  }, [cam, scene, size, dpr, gpu, design, names, selected, year, showMoons, bodyTex, focusT, focusIndex]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: 0 };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    setCam((c) => ({ ...c, yaw: d.yaw + dx * 0.006, pitch: Math.max(-1.25, Math.min(1.25, d.pitch + dy * 0.005)) }));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved > 6) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: { i: number; x: number; y: number; moonP?: number; moonM?: number } | null = null;
    let bd = Infinity;
    for (const h of hits.current) {
      const dist = Math.hypot(x - h.x, y - h.y);
      if (dist < (h.moonP !== undefined ? 24 : 16) && dist < bd) {
        bd = dist;
        best = h;
      }
    }
    if (best) {
      if (best.moonP !== undefined && best.moonM !== undefined) onSelectMoon?.(best.moonP, best.moonM);
      else onSelect(best.i);
    }
  };
  /** 双击行星:打开它(Studio 进地球仪);命中半径和单击一致 */
  /** 双击行星：打开它（Studio 进地球仪）；空白处仍回到正面 */
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>): boolean => {
    if (!onOpen) return false;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: { i: number; x: number; y: number; moonP?: number; moonM?: number } | null = null;
    let bd = Infinity;
    for (const h of hits.current) {
      const dist = Math.hypot(x - h.x, y - h.y);
      if (dist < (h.moonP !== undefined ? 24 : 16) && dist < bd) {
        bd = dist;
        best = h;
      }
    }
    if (!best) return false;
    const openIdx = best.moonP ?? best.i;
    onOpen(openIdx, { x, y, r: 18 });
    return true;
  };

  // 相机推进:相机改成围绕目标行星(draw 里 lookAt 它),目标留在画面里慢慢变大,而不是把整个星系甩到画面中心
  useEffect(() => {
    if (focusIndex === null || focusIndex === undefined) return;
    const p = design.planets[focusIndex];
    if (!p) return;
    // 相机要飞到的位置必须和 GPU 渲染的位置完全一致(否则会飞到错的地方)
    // 宜居卫星系:那颗"行星"实际画在母行星相位 + 0.16 上
    const ang = design.habitableMoon && design.habitableMoon.index === focusIndex ? planetPhase(design.habitableMoon.parent) + 0.16 : planetPhase(focusIndex);
    const stFocus = year === undefined ? null : positionAtAU({ ...p, nodeDeg: -p.nodeDeg, phase0: ang }, year, design.star.mass);
    const pos: [number, number, number] = stFocus ? [stFocus.x, stFocus.z, stFocus.y] : planetPos(p, ang);
    // 分离双星:行星实际渲染位置 = 轨道位置 + 主星偏移(和 GPU 一致)
    const pairFocus = design.binaryStar && design.binaryStar.tier !== 'close' ? binaryStarPair(design, year) : null;
    if (pairFocus) {
      pos[0] += pairFocus.main[0];
      pos[1] += pairFocus.main[1];
      pos[2] += pairFocus.main[2];
    }
    // 卫星:焦点落在卫星本身(母行星位置 + 卫星轨道偏移)
    const fm = focusMoon && focusMoon.p === focusIndex ? focusMoon : null;
    let focusRadius = p.radius;
    if (fm) {
      const mm = p.moons?.[fm.m];
      if (mm) {
        const sepAU = Math.max(1, mm.distance) * Math.max(0.2, p.radius) * (6371 / 1.496e8);
        const focal0 = (size.h / 2) / Math.tan((55 * Math.PI) / 360);
        const sepDrawAU = Math.max(sepAU, (26 * Math.max(1e-6, camRef.current.dist)) / focal0 / scene.scale);
        const sepAUf = sepDrawAU;
        const per = Math.max(0.01, moonPeriodDays(Math.max(1, mm.distance), Math.max(0.2, p.radius), p.mass));
        const th = ((year ?? 0) * 365.25 / per + fm.m * 2.39996) % (Math.PI * 2);
        const ct2 = Math.cos((p.tilt * Math.PI) / 180);
        const st2 = Math.sin((p.tilt * Math.PI) / 180);
        const dzm = Math.sin(th) * sepAUf;
        pos[0] += Math.cos(th) * sepAUf;
        pos[1] += dzm * st2;
        pos[2] += dzm * ct2;
        focusRadius = mm.radius;
      }
    }
    // 双固态伴星:焦点位置 = 主行星位置 + 互绕偏移(和 GPU 画的一致)
    if (design.binary && design.binary.index === focusIndex) {
      const homeP = design.planets[design.home.index];
      if (homeP) {
        // 基准位置必须和主行星渲染位置一致(按年份),否则伴星不跟着主行星走
        const homeAng = planetPhase(design.home.index);
        const homeSt = year === undefined ? null : positionAtAU({ ...homeP, nodeDeg: -homeP.nodeDeg, phase0: homeAng }, year, design.star.mass);
        const hp = homeSt ? [homeSt.x, homeSt.z, homeSt.y] : planetPos(homeP, homeAng);
        const sep = Math.max(1e-6, design.binary.separationAU);
        const theta = ((year ?? 0) * 365.25 / Math.max(0.01, design.binary.periodDays)) * Math.PI * 2;
        pos[0] = hp[0] + Math.cos(theta) * sep;
        pos[1] = hp[1];
        pos[2] = hp[2] + Math.sin(theta) * sep;
      }
    }
    const at: [number, number, number] = [pos[0] * scene.scale, pos[1] * scene.scale, pos[2] * scene.scale];
    const hit = hits.current.find((h) => h.i === focusIndex);
    const cv = canvas.current;
    const from = camRef.current;
    const startAt: [number, number, number] = from.at ?? [0, 0, 0];
    // 相机只沿视线推近:yaw/pitch 保持不动,靠 at 移到行星 + dist 缩小,画面不甩
    // 让行星从原来的屏幕位置平滑挪到画面中间(幅度按偏移算,不大甩)
    const to = {
      yaw: from.yaw,
      pitch: from.pitch,
      // 视距:让目标行星在画面里占约 55% 短边(相机会一直推到"贴上表面")
      dist: (() => {
        // 真实半径(场景单位):R⊕ → AU → 场景单位
        const rScene = Math.max(1e-6, focusRadius * (6371 / 1.496e8) * scene.scale);
        const focal = (size.h / 2) / Math.tan((55 * Math.PI) / 360);
        return Math.max(1e-6, (focal * rScene) / (0.32 * Math.min(size.w, size.h)));
      })(),
      at,
    };
    const t0 = performance.now();
    const DUR = 640;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR);
      const e = t * t * (3 - 2 * t);
      setFocusT(e);
      setCam({
        yaw: from.yaw + (to.yaw - from.yaw) * e,
        pitch: from.pitch + (to.pitch - from.pitch) * e,
        dist: from.dist + (to.dist - from.dist) * e,
        at: [startAt[0] + (at[0] - startAt[0]) * e, startAt[1] + (at[1] - startAt[1]) * e, startAt[2] + (at[2] - startAt[2]) * e],
      });
      if (t < 1) raf = requestAnimationFrame(step);
      else { if (focusIndex !== null && focusIndex !== undefined) setFollowIdx(focusIndex); onFocusDone?.(); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [focusIndex, focusMoon, onFocusDone, design, year]);

  // 相机跟随天体:播放时 at 跟着它走(否则相机停在原地,星球跑掉了)
  useEffect(() => {
    if (followIdx === null) return;
    const p = design.planets[followIdx];
    if (!p) return;
    const ang = planetPhase(followIdx);
    const st = year === undefined ? null : positionAtAU({ ...p, nodeDeg: -p.nodeDeg, phase0: ang }, year, design.star.mass);
    const pos = st ? [st.x, st.z, st.y] : planetPos(p, ang);
    const pairF = design.binaryStar && design.binaryStar.tier !== 'close' ? binaryStarPair(design, year) : null;
    if (pairF) {
      pos[0] += pairF.main[0];
      pos[1] += pairF.main[1];
      pos[2] += pairF.main[2];
    }
    setCam((c) => ({ ...c, at: [pos[0] * scene.scale, pos[1] * scene.scale, pos[2] * scene.scale] }));
  }, [year, followIdx, design, scene]);

  // 从行星旁起步,自动拉远(地球仪 → 星系视角时的无缝返回)
  useEffect(() => {
    if (startFocusIndex === null || startFocusIndex === undefined) return;
    const p = design.planets[startFocusIndex];
    if (!p) return;
    const pos = planetPos(p, year ?? 0);
    const at: [number, number, number] = [pos[0] * scene.scale, pos[1] * scene.scale, pos[2] * scene.scale];
    setCam({ yaw: 0.72, pitch: 0.45, dist: 3.2, at });
    setFocusT(1);
    const t0 = performance.now();
    const DUR = 620;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR);
      const e = t * t * (3 - 2 * t);
      setCam({ yaw: 0.72, pitch: 0.45, dist: 3.2 + (16 - 3.2) * e, at: [at[0] * (1 - e), at[1] * (1 - e), at[2] * (1 - e)] });
      setFocusT(1 - e);
      if (t < 1) raf = requestAnimationFrame(step);
      else onPullDone?.();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [startFocusIndex, design, year, scene.scale, onPullDone]);
  // 相机拉远:返回星系视角时相机从行星退到恒星(不是直接切画面)
  useEffect(() => {
    if (!pullOut) return;
    const from = camRef.current;
    const startAt: [number, number, number] = from.at ?? [0, 0, 0];
    const t0 = performance.now();
    const DUR = 620;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR);
      const e = t * t * (3 - 2 * t);
      setCam({
        yaw: from.yaw + (0.72 - from.yaw) * e,
        pitch: from.pitch + (0.45 - from.pitch) * e,
        dist: from.dist + (16 - from.dist) * e,
        at: [startAt[0] * (1 - e), startAt[1] * (1 - e), startAt[2] * (1 - e)],
      });
      setFocusT(1 - e);
      if (t < 1) raf = requestAnimationFrame(step);
      else onPullDone?.();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pullOut, onPullDone]);

  return (
    <div ref={wrap} style={{ position: 'relative', width: '100%', height: boxH, background: '#0a0f1c', borderRadius: 8, overflow: 'hidden' }}>
      <canvas ref={glCanvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: gpu ? 1 : 0 }} />
      <canvas
        ref={canvas}
        data-act="system-globe"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(e) => {
          if (!onDoubleClick(e)) setCam({ yaw: 0.72, pitch: 0.45, dist: 16 });
        }}
      />
      <div style={{ position: 'absolute', left: 8, top: 8, display: 'flex', gap: 6, fontSize: 11.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'rgba(200,214,235,0.65)' }}>拖拽旋转 · 滚轮缩放 · 双击回正 · 点行星选中</span>
        <button data-act="globe-moons" onClick={() => setShowMoons((v) => !v)} style={globeBtn}>{showMoons ? '藏卫星' : '显卫星'}</button>
        {gpuTried && (
          <button
            data-act="globe-gpu"
            onClick={() => {
              if (gpu) {
                setGpu(false);
              } else if (glCanvas.current) {
                try {
                  glRef.current = createSystemGl(glCanvas.current);
                  setGpu(!!glRef.current);
                } catch {
                  setGpu(false);
                }
              }
            }}
            style={globeBtn}
            title={gpu ? 'WebGL2 加速；切成 CPU' : '切成 WebGL2 加速'}
          >
            {gpu ? 'GPU' : 'CPU'}
          </button>
        )}
      </div>
      <div style={{ position: 'absolute', right: 10, bottom: 6, fontSize: 10.5, color: 'rgba(200,214,235,0.4)' }}>
        视距 {cam.dist.toFixed(0)} · 3D · {gpu ? 'WebGL2' : 'CPU'}
      </div>
    </div>
  );
}
