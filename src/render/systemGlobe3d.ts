/**
 * 3D 星系图的 WebGL2 渲染(和主地图的地球仪同一路线:自己写 WebGL2,没有 WebGL2 就退回 2D)。
 *
 * 这里只画"点"和"线":星空与星图背景、行星轨道(含黄道角/升交点)、宜居带、小行星带粒子。
 * 行星本体、恒星辉光、名字都用上层 2D canvas 画(systemGlobe3d 只负责算投影位置),这样标签清晰、点选简单。
 */
import type { AstroDesign, PlanetDesign } from '../gen/astroDesign';
import type { BeltDesign } from '../gen/system';

export type Vec3 = [number, number, number];

export interface SystemCamera {
  /** 绕竖直轴转的角度(弧度) */
  yaw: number;
  /** 俯仰(弧度,±1.2 之间) */
  pitch: number;
  /** 相机到原点的距离(场景单位) */
  dist: number;
  /** 相机看向/围绕的点(不给 = 恒星原点) */
  at?: Vec3;
}

/** 场景:一串点和一串线段(世界坐标) */
export interface SystemScene {
  /** 天体比例:1 AU → 多少场景单位 */
  scale: number;
  /** 星空的点:x,y,z,size,r,g,b */
  stars: Float32Array;
  /** 小行星带的点:x,y,z,r,g,b */
  beltPoints: Float32Array;
  /** 轨道线、宜居带线的端点 */
  lines: Float32Array;
  /** 恒星位置(原点) */
  maxAU: number;
}

/** 行星在某一刻的位置(椭圆轨道 + 黄道角 + 升交点) */
export function planetPos(p: Pick<PlanetDesign, 'a' | 'ecc' | 'incDeg' | 'nodeDeg'>, theta: number): Vec3 {
  const e = Math.max(0, Math.min(0.9, p.ecc));
  const r = (p.a * (1 - e * e)) / (1 + e * Math.cos(theta));
  const inc = (p.incDeg * Math.PI) / 180;
  const node = (p.nodeDeg * Math.PI) / 180;
  // 先画在 xz 平面,再绕 x 轴倾斜(黄道角),最后绕 y 轴转到升交点
  const x0 = r * Math.cos(theta);
  const z0 = r * Math.sin(theta);
  const y1 = z0 * Math.sin(inc);
  const z1 = z0 * Math.cos(inc);
  return [x0 * Math.cos(node) + z1 * Math.sin(node), y1, -x0 * Math.sin(node) + z1 * Math.cos(node)];
}

/** 行星此刻的相位(和 2D 示意图同一套,确定性) */
export function planetPhase(i: number): number {
  return (i * 0.9 + 0.4) % (Math.PI * 2);
}

/** 按种子取 [0,1) */
function unit(seed: number, i: number): number {
  // 简单确定性打散(粒子用;不走世界随机流)
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * N3:双恒星在这一刻的两颗位置(AU,相对质心)。
 * 主星与伴星绕共同质心转:a₁ = sep·m₂/M、a₂ = sep·m₁/M(之和 = sepAU);
 * 相位按 binaryStar.periodDays 推(year 不给就用固定相位,示意图用)。
 * 返回值里的 x/z 是世界平面坐标(y 恒 0),调用方自己转屏幕。
 */
/**
 * N3/步4:双恒星/三合星这一刻的位置(AU,相对 AB 质心)。
 *   AB 绕共同质心:aA = sep·mB/M、aB = sep·mA/M;相位按 AB 互绕周期推;
 *   C(三合)在 outerSepAU 外绕 AB 质心,相位按 outerPeriodYears 推。
 * 返回的 x/z 是世界平面坐标(y 恒 0),调用方自己转屏幕。
 */
export function binaryStarPair(
  design: AstroDesign,
  year?: number,
): { main: Vec3; companion: Vec3; third?: Vec3; aMainAU: number; aCompAU: number; thirdSepAU?: number } | null {
  const bs = design.binaryStar;
  if (!bs) return null;
  const [mA, mB] = [bs.members[0]?.star.mass ?? bs.companion.mass, bs.members[1]?.star.mass ?? bs.companion.mass];
  const mSum = Math.max(1e-6, mA + mB);
  const aMain = (bs.sepAU * mB) / mSum;
  const aComp = (bs.sepAU * mA) / mSum;
  const periodDays = Math.max(0.01, bs.periodDays);
  const years = Number.isFinite(year) ? Math.max(0, year as number) : 0;
  const theta = Number.isFinite(year) ? ((years * 365.25) / periodDays) * Math.PI * 2 + 0.6 : 0.6;
  const cx = Math.cos(theta);
  const cz = Math.sin(theta);
  const out: { main: Vec3; companion: Vec3; third?: Vec3; aMainAU: number; aCompAU: number; thirdSepAU?: number } = {
    main: [-cx * aMain, 0, -cz * aMain],
    companion: [cx * aComp, 0, cz * aComp],
    aMainAU: aMain,
    aCompAU: aComp,
  };
  if (bs.outerSepAU !== undefined) {
    const outerPeriod = Math.max(1e-6, bs.outerPeriodYears ?? 1);
    const ph = Number.isFinite(year) ? (years / outerPeriod) * Math.PI * 2 + 2.1 : 2.1;
    out.thirdSepAU = bs.outerSepAU;
    out.third = [Math.cos(ph) * bs.outerSepAU, 0, Math.sin(ph) * bs.outerSepAU];
  }
  return out;
}
/** 从设计层造一份场景(纯函数;同样的设计永远同一份点) */
export function systemScene(design: AstroDesign, belts: readonly BeltDesign[]): SystemScene {
  const maxAU = Math.max(0.1, ...design.planets.map((p) => p.a));
  const scale = 10 / maxAU;
  const aHz = Math.sqrt(design.star.lum);

  // 星空:星图上的星放到半径 70 的球面上
  const stars: number[] = [];
  for (const s of design.stars) {
    const [dx, dy, dz] = s.dir;
    stars.push(dx * 70, dy * 70, dz * 70, Math.max(0.6, Math.min(2.6, 3.2 - s.mag * 0.45)), s.color[0] / 255, s.color[1] / 255, s.color[2] / 255);
  }

  // 轨道线:每颗行星一条;外加宜居带内外两条(淡绿)
  const lines: number[] = [];
  // 轨道线采样数:拉近后弦线误差要在 1px 以内(128 → 1024)
  const seg = 1024;
  // 分离双星(wide/triple):行星绕主星(A),不是绕质心;轨道环跟着偏移
  const starPairNow = binaryStarPair(design, 0);
  const wide = !!(design.binaryStar && design.binaryStar.tier !== 'close' && starPairNow);
  const ox = wide ? starPairNow!.main[0] : 0;
  const oy = wide ? starPairNow!.main[1] : 0;
  const oz = wide ? starPairNow!.main[2] : 0;
  const pushRing = (a: number, e: number, incDeg: number, nodeDeg: number, rgb: Vec3) => {
    let prev: Vec3 | null = null;
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const q = planetPos({ a, ecc: e, incDeg, nodeDeg }, th);
      if (prev) lines.push((prev[0] + ox) * scale, (prev[1] + oy) * scale, (prev[2] + oz) * scale, (q[0] + ox) * scale, (q[1] + oy) * scale, (q[2] + oz) * scale, rgb[0], rgb[1], rgb[2]);
      prev = q;
    }
  };
  for (const p of design.planets) {
    // 双固态行星系:两颗绕共同质心,共用主行星那条轨道环,伴星不再画第二条
    if (design.binary && p.index === design.binary.index) continue;
    pushRing(p.a, p.ecc, p.incDeg, p.nodeDeg, p.index === design.home.index ? [0.95, 0.86, 0.55] : [0.55, 0.62, 0.78]);
  }
  pushRing(aHz * 0.75, 0, 0, 0, [0.35, 0.72, 0.42]);
  pushRing(aHz * 1.5, 0, 0, 0, [0.35, 0.72, 0.42]);

  // 小行星带:粒子撒在带的范围里
  const beltPoints: number[] = [];
  for (const b of belts) {
    const n = Math.min(1200, Math.round(b.count / 2));
    for (let k = 0; k < n; k++) {
      const u = unit(b.seed, k * 3);
      const v = unit(b.seed, k * 3 + 1);
      const w = unit(b.seed, k * 3 + 2);
      const r = b.innerAU + (b.outerAU - b.innerAU) * u;
      const th = v * Math.PI * 2;
      const yOff = (w * 2 - 1) * r * Math.tan((b.incDeg * Math.PI) / 180);
      const grey = 0.42 + 0.35 * w;
      beltPoints.push(r * Math.cos(th) * scale, yOff * scale, r * Math.sin(th) * scale, grey, grey * 0.95, grey * 0.85);
    }
  }

  return {
    scale,
    stars: new Float32Array(stars),
    beltPoints: new Float32Array(beltPoints),
    lines: new Float32Array(lines),
    maxAU,
  };
}

// ---- 4x4 矩阵(列主序,WebGL 用的顺序) ----

export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function lookAt(eye: Vec3, at: Vec3, up: Vec3): Float32Array {
  const z = norm(sub(eye, at));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      o[i * 4 + j] = a[0 * 4 + j] * b[i * 4 + 0] + a[1 * 4 + j] * b[i * 4 + 1] + a[2 * 4 + j] * b[i * 4 + 2] + a[3 * 4 + j] * b[i * 4 + 3];
    }
  }
  return o;
}

/** 相机位置(绕原点,距离 dist) */
export function cameraEye(cam: SystemCamera): Vec3 {
  const cp = Math.cos(cam.pitch);
  const at = cam.at;
  const eye: Vec3 = [Math.cos(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, Math.sin(cam.yaw) * cp * cam.dist];
  return at ? [eye[0] + at[0], eye[1] + at[1], eye[2] + at[2]] : eye;
}

/** 世界坐标 → 屏幕像素(左上 0,0);在相机后面返回 null */
export function project(mvp: Float32Array, w: number, h: number, p: Vec3): [number, number] | null {
  const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
  const y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
  const wc = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
  if (wc <= 0.0001) return null;
  return [(x / wc * 0.5 + 0.5) * w, (0.5 - (y / wc) * 0.5) * h];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---- WebGL2 资源 ----

const POINT_VS = `#version 300 es
in vec3 a_pos; in vec3 a_col; in float a_size;
uniform mat4 u_mvp; uniform float u_dpr;
out vec3 v_col;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  gl_PointSize = a_size * u_dpr * 3.0;
  v_col = a_col;
}`;
const POINT_FS = `#version 300 es
precision mediump float;
in vec3 v_col; out vec4 o;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  if (dot(d, d) > 0.25) discard;
  o = vec4(v_col, 1.0);
}`;
const LINE_VS = `#version 300 es
in vec3 a_pos; in vec4 a_col;
uniform mat4 u_mvp;
out vec4 v_col;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); v_col = a_col; }`;
const LINE_FS = `#version 300 es
precision mediump float;
in vec4 v_col; out vec4 o;
void main() { o = v_col; }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

export interface SystemGlRenderer {
  setScene(s: SystemScene): void;
  /** U1:设置要画的行星球(位置/半径/贴图);每帧 draw 时用最新的这一份 */
  setBodies(bodies: readonly GpuBody[]): void;
  /** 卫星轨道线:每顶点 [x,y,z,r,g,b](LINES,动态更新) */
  setMoonOrbits(verts: Float32Array): void;
  draw(cam: SystemCamera, w: number, h: number, dpr: number): Float32Array;
  dispose(): void;
}

/** 建 WebGL2 渲染器;拿不到 WebGL2 返回 null(上层退回 2D 示意图) */
/** 行星球体:UV 球 + 等距圆柱贴图 + 恒星在原点方向的朗伯光照 */
const SPHERE_VS = `#version 300 es
in vec3 a_pos;
in vec2 a_uv;
uniform mat4 u_vp;
uniform vec3 u_center;
uniform float u_radius;
uniform float u_spin;   // 自转角(弧度)
uniform float u_tilt;   // 自转轴倾角(弧度)
out vec2 v_uv;
out vec3 v_world;
out vec3 v_norm;
void main() {
  // 先自转(绕极轴),再按倾角倾斜(绕 x 轴),最后平移到天体中心
  float cs = cos(u_spin), sn = sin(u_spin);
  vec3 sp = vec3(cs * a_pos.x + sn * a_pos.z, a_pos.y, -sn * a_pos.x + cs * a_pos.z);
  float ct = cos(u_tilt), st = sin(u_tilt);
  vec3 tp = vec3(sp.x, ct * sp.y - st * sp.z, st * sp.y + ct * sp.z);
  v_norm = tp;
  vec3 world = u_center + tp * u_radius;
  v_world = world;
  v_uv = a_uv;
  gl_Position = u_vp * vec4(world, 1.0);
}`;
const SPHERE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_world;
in vec3 v_norm;
uniform sampler2D u_tex;
uniform float u_hasTex;
uniform vec3 u_tint;
out vec4 outColor;
void main() {
  vec3 base = u_hasTex > 0.5 ? texture(u_tex, v_uv).rgb : u_tint;
  vec3 n = normalize(v_norm);
  // 恒星在原点:从球面指向恒星的向量就是光照方向
  vec3 L = normalize(-v_world);
  float lam = max(dot(n, L), 0.0);
  float lit = 0.16 + 0.92 * lam;
  // 边缘一点点大气感
  float rim = pow(1.0 - max(dot(n, normalize(vec3(0.0, 0.0, 1.0))), 0.0), 2.0) * 0.18;
  vec3 col = base * lit + vec3(0.35, 0.5, 0.8) * rim;
  outColor = vec4(col, 1.0);
}`;

/** 造一个 UV 球(positions | uv | indices) */
function sphereMesh(seg = 48, rings = 24) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg;
      const theta = u * Math.PI * 2;
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.cos(phi);
      const sz = Math.sin(phi) * Math.sin(theta);
      pos.push(sx, sy, sz);
      uv.push(u, 1 - v);
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < seg; x++) {
      const a = y * (seg + 1) + x;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

/** 一颗要画的行星:位置(场景单位)、视觉半径、贴图键(没有就用 tint 纯色) */
export interface GpuBody {
  key: string;
  pos: [number, number, number];
  radius: number;
  tint?: [number, number, number];
  tex?: HTMLCanvasElement | null;
  /** 自转角(弧度) */
  spin?: number;
  /** 自转轴倾角(弧度) */
  tilt?: number;
}
export function createSystemGl(canvas: HTMLCanvasElement): SystemGlRenderer | null {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  const pointProg = compile(gl, POINT_VS, POINT_FS);
  const lineProg = compile(gl, LINE_VS, LINE_FS);
  const sphereProg = compile(gl, SPHERE_VS, SPHERE_FS);
  const sphere = sphereMesh();
  let sphereVao: WebGLVertexArrayObject | null = null;
  let spherePosBuf: WebGLBuffer | null = null;
  let sphereUvBuf: WebGLBuffer | null = null;
  let sphereIdxBuf: WebGLBuffer | null = null;
  const texCache = new Map<string, { tex: WebGLTexture; src: HTMLCanvasElement }>();
  let bodies: readonly GpuBody[] = [];
  const texFor = (b: GpuBody): WebGLTexture | null => {
    if (!b.tex) return null;
    const hit = texCache.get(b.key);
    if (hit && hit.src === b.tex) return hit.tex;
    const t = (hit ? hit.tex : gl.createTexture()) as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    texCache.set(b.key, { tex: t, src: b.tex });
    return t;
  };
  const attrib = (p: WebGLProgram, n: string) => gl.getAttribLocation(p, n);
  const loc = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
  const pointLoc = { pos: attrib(pointProg, 'a_pos'), col: attrib(pointProg, 'a_col'), size: attrib(pointProg, 'a_size'), mvp: loc(pointProg, 'u_mvp'), dpr: loc(pointProg, 'u_dpr') };
  const lineLoc = { pos: attrib(lineProg, 'a_pos'), col: attrib(lineProg, 'a_col'), mvp: loc(lineProg, 'u_mvp') };
  const sphereLoc = {
    pos: attrib(sphereProg, 'a_pos'),
    uv: attrib(sphereProg, 'a_uv'),
    vp: loc(sphereProg, 'u_vp'),
    center: loc(sphereProg, 'u_center'),
    radius: loc(sphereProg, 'u_radius'),
    tex: loc(sphereProg, 'u_tex'),
    hasTex: loc(sphereProg, 'u_hasTex'),
    tint: loc(sphereProg, 'u_tint'),
    spin: loc(sphereProg, 'u_spin'),
    tilt: loc(sphereProg, 'u_tilt'),
  };

  let starBuf: WebGLBuffer | null = null;
  let starVao: WebGLVertexArrayObject | null = null;
  let beltBuf: WebGLBuffer | null = null;
  let beltVao: WebGLVertexArrayObject | null = null;
  let lineBuf: WebGLBuffer | null = null;
  let lineVao: WebGLVertexArrayObject | null = null;
  let nStars = 0;
  let nBelt = 0;
  let nLine = 0;
  let moonLineBuf: WebGLBuffer | null = null;
  let moonLineVao: WebGLVertexArrayObject | null = null;
  let nMoonLine = 0;

  const setPoints = (buf: WebGLBuffer | null, vao: WebGLVertexArrayObject | null, data: Float32Array, stride: number) => {
    if (!buf || !vao) return;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(pointLoc.pos);
    gl.vertexAttribPointer(pointLoc.pos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(pointLoc.col);
    gl.vertexAttribPointer(pointLoc.col, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(pointLoc.size);
    gl.vertexAttribPointer(pointLoc.size, 1, gl.FLOAT, false, stride, 24);
    gl.bindVertexArray(null);
  };

  return {
    setScene(s) {
      if (!starVao) {
        starVao = gl.createVertexArray();
        starBuf = gl.createBuffer();
        beltVao = gl.createVertexArray();
        beltBuf = gl.createBuffer();
        lineVao = gl.createVertexArray();
        lineBuf = gl.createBuffer();
      }
      nStars = s.stars.length / 7;
      nBelt = s.beltPoints.length / 6;
      nLine = s.lines.length / 9;
      setPoints(starBuf, starVao, s.stars, 7 * 4);
      // 小行星带的点:补一个固定 size 属性
      const belt = new Float32Array(nBelt * 7);
      for (let i = 0; i < nBelt; i++) {
        belt[i * 7] = s.beltPoints[i * 6];
        belt[i * 7 + 1] = s.beltPoints[i * 6 + 1];
        belt[i * 7 + 2] = s.beltPoints[i * 6 + 2];
        belt[i * 7 + 3] = s.beltPoints[i * 6 + 3];
        belt[i * 7 + 4] = s.beltPoints[i * 6 + 4];
        belt[i * 7 + 5] = s.beltPoints[i * 6 + 5];
        belt[i * 7 + 6] = 0.55;
      }
      setPoints(beltBuf, beltVao, belt, 7 * 4);
      // 线:每条线段 2 顶点,每顶点 3 位置 + 3 颜色(源数据是 [p1(3), p2(3), rgb(3)] 一段)
      const lv = new Float32Array(nLine * 2 * 6);
      for (let k = 0; k < nLine; k++) {
        const src = k * 9;
        const dst = k * 12;
        lv[dst] = s.lines[src];
        lv[dst + 1] = s.lines[src + 1];
        lv[dst + 2] = s.lines[src + 2];
        lv[dst + 3] = s.lines[src + 6];
        lv[dst + 4] = s.lines[src + 7];
        lv[dst + 5] = s.lines[src + 8];
        lv[dst + 6] = s.lines[src + 3];
        lv[dst + 7] = s.lines[src + 4];
        lv[dst + 8] = s.lines[src + 5];
        lv[dst + 9] = s.lines[src + 6];
        lv[dst + 10] = s.lines[src + 7];
        lv[dst + 11] = s.lines[src + 8];
      }
      if (lineVao) {
        gl.bindVertexArray(lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, lv, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(lineLoc.pos);
        gl.vertexAttribPointer(lineLoc.pos, 3, gl.FLOAT, false, 6 * 4, 0);
        gl.enableVertexAttribArray(lineLoc.col);
        gl.vertexAttribPointer(lineLoc.col, 3, gl.FLOAT, false, 6 * 4, 12);
        gl.bindVertexArray(null);
      }
    },

    setMoonOrbits(verts) {
      if (!moonLineVao) {
        moonLineVao = gl.createVertexArray();
        moonLineBuf = gl.createBuffer();
        gl.bindVertexArray(moonLineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, moonLineBuf);
        gl.enableVertexAttribArray(lineLoc.pos);
        gl.vertexAttribPointer(lineLoc.pos, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(lineLoc.col);
        gl.vertexAttribPointer(lineLoc.col, 3, gl.FLOAT, false, 24, 12);
        gl.bindVertexArray(null);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, moonLineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      nMoonLine = verts.length / 6;
    },

    setBodies(next) {
      bodies = next;
    },

    draw(cam, w, h, dpr) {
      // 画布的绘图缓冲区要跟着容器尺寸走:不改 canvas.width/height 的话缓冲区默认 300×150,viewport 再大也只能画进左上角一小块
      const cw = Math.max(1, Math.round(w * dpr));
      const ch = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0.035, 0.05, 0.09, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const eye = cameraEye(cam);
      // 真实尺度下相机可能贴近行星(dist 小到 1e-4):近平面跟着缩,远平面保证星空还在
      const nearPlane = Math.max(1e-7, Math.min(0.05, cam.dist * 0.01));
      const farPlane = Math.max(400, cam.dist * 50);
      const mvp = multiply(perspective((55 * Math.PI) / 180, w / h, nearPlane, farPlane), lookAt(eye, cam.at ?? [0, 0, 0], [0, 1, 0]));

      // 星空
      gl.useProgram(pointProg);
      gl.uniformMatrix4fv(pointLoc.mvp, false, mvp);
      gl.uniform1f(pointLoc.dpr, dpr);
      gl.depthMask(false);
      gl.bindVertexArray(starVao);
      if (nStars) gl.drawArrays(gl.POINTS, 0, nStars);
      // 小行星带
      gl.bindVertexArray(beltVao);
      if (nBelt) gl.drawArrays(gl.POINTS, 0, nBelt);
      gl.depthMask(true);

      // 轨道线
      gl.useProgram(lineProg);
      gl.uniformMatrix4fv(lineLoc.mvp, false, mvp);
      gl.bindVertexArray(lineVao);
      if (nLine) gl.drawArrays(gl.LINES, 0, nLine * 2);
      // 卫星轨道线(动态,跟随母行星)
      if (nMoonLine && moonLineVao) {
        gl.useProgram(lineProg);
        gl.uniformMatrix4fv(lineLoc.mvp, false, mvp);
        gl.bindVertexArray(moonLineVao);
        gl.drawArrays(gl.LINES, 0, nMoonLine);
        gl.bindVertexArray(null);
      }

      // U1:行星球体(带贴图;深度测试让它和轨道线互相遮挡)
      if (bodies.length && sphereProg) {
        if (!sphereVao) {
          sphereVao = gl.createVertexArray();
          spherePosBuf = gl.createBuffer();
          sphereUvBuf = gl.createBuffer();
          sphereIdxBuf = gl.createBuffer();
          gl.bindVertexArray(sphereVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, spherePosBuf);
          gl.bufferData(gl.ARRAY_BUFFER, sphere.pos, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(sphereLoc.pos);
          gl.vertexAttribPointer(sphereLoc.pos, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, sphereUvBuf);
          gl.bufferData(gl.ARRAY_BUFFER, sphere.uv, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(sphereLoc.uv);
          gl.vertexAttribPointer(sphereLoc.uv, 2, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIdxBuf);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.idx, gl.STATIC_DRAW);
          gl.bindVertexArray(null);
        }
        gl.useProgram(sphereProg);
        gl.uniformMatrix4fv(sphereLoc.vp, false, mvp);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(sphereLoc.tex, 0);
        gl.bindVertexArray(sphereVao);
        for (const b of bodies) {
          const t = texFor(b);
          if (t) {
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.uniform1f(sphereLoc.hasTex, 1);
          } else {
            gl.uniform1f(sphereLoc.hasTex, 0);
            const c = b.tint ?? [0.75, 0.75, 0.78];
            gl.uniform3f(sphereLoc.tint, c[0], c[1], c[2]);
          }
          gl.uniform3f(sphereLoc.center, b.pos[0], b.pos[1], b.pos[2]);
          gl.uniform1f(sphereLoc.radius, b.radius);
          gl.uniform1f(sphereLoc.spin, b.spin ?? 0);
          gl.uniform1f(sphereLoc.tilt, b.tilt ?? 0);
          gl.drawElements(gl.TRIANGLES, sphere.idx.length, gl.UNSIGNED_SHORT, 0);
        }
        gl.bindVertexArray(null);
      }
      gl.bindVertexArray(null);
      return mvp;
    },

    dispose() {
      for (const b of [starBuf, beltBuf, lineBuf, moonLineBuf]) if (b) gl.deleteBuffer(b);
      for (const v of [starVao, beltVao, lineVao, moonLineVao]) if (v) gl.deleteVertexArray(v);
      gl.deleteProgram(pointProg);
      gl.deleteProgram(lineProg);
      if (sphereProg) gl.deleteProgram(sphereProg);
      for (const b of [spherePosBuf, sphereUvBuf, sphereIdxBuf]) if (b) gl.deleteBuffer(b);
      if (sphereVao) gl.deleteVertexArray(sphereVao);
      for (const t of texCache.values()) gl.deleteTexture(t.tex);
    },
  };
}
