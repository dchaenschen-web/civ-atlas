/**
 * 新建世界里那颗星球的 WebGL 部分(WebGL 1,手机上也有):网格、两组投影位置、样式贴图。
 * 算法和着色器在 render/planet.ts;这里只管显卡上的东西,画哪一帧由调用的人给(PlanetFrame)。
 *
 *   样式贴图   按键存(世界编号 + 画风键);同一时间最多留几张,旧世界的随时扔掉
 *   标记层     助手要改的地方(白圈 + 编号),一张透明贴图盖在最上面
 *
 * 显卡不支持、着色器编不过 → create 返回 null(新建界面退回平面地图);画的过程中显卡丢了(context lost)→ onLost。
 */
import {
  PLANET_FS,
  PLANET_NX,
  PLANET_NY,
  PLANET_VS,
  planetLayout,
  planetMesh,
  type PlanetLayout,
  type PlanetMesh,
  type PlanetProjection,
} from '../../render/planet';

/** 一帧画什么:两种投影之间变形到哪、卷了多少、在屏幕上多大、转到哪、用哪两张样式贴图 */
export interface PlanetFrame {
  projA: PlanetProjection;
  projB: PlanetProjection;
  /** 0 = 全是 A 的位置,1 = 全是 B */
  s: number;
  /** 0 = 平面,1 = 卷成球 */
  m: number;
  /** 每个单位多少 CSS 像素(地球仪 = 半径) */
  k: number;
  /** 图的中心(CSS 像素,画布左上为原点) */
  cx: number;
  cy: number;
  /** 绕球心往前俯仰(弧度,只在卷起来时起作用) */
  tilt: number;
  /** 正中那条经线(弧度) */
  lon: number;
  /** 两张样式贴图的键;mix = 1 全是 a */
  a: string;
  b: string;
  mix: number;
  markA: number;
  /** 经纬网每隔几度一条(0 = 不画) */
  grid: number;
  /** 太阳方向(球面光照用;不给 = 固定的默认方向) */
  /** 太阳直射经度/纬度(弧度;球面晨昏线用) */
  sunLon?: number;
  sunLat?: number;
  /** 星环(没有 = 不画) */
  rings?: {
    innerR: number;
    outerR: number;
    opacity: number;
    color: [number, number, number];
    gap: number;
    gapAt: number;
    tiltDeg: number;
  } | null;
}

/** 星环:全屏四边形里按"环面反投影"算环的分布;球体先画好,这里做前后遮挡与半透明叠加 */
const RING_VS = `
attribute vec2 a_xy;
varying vec2 v_px;
uniform vec2 u_view;
void main() {
  v_px = (a_xy * 0.5 + 0.5) * u_view;
  gl_Position = vec4(a_xy, 0.0, 1.0);
}`;
const RING_FS = `
precision mediump float;
varying vec2 v_px;
uniform vec2 u_center, u_view;
uniform float u_radius, u_tilt, u_inner, u_outer, u_opacity, u_gap, u_gapAt;
uniform vec3 u_color;
void main() {
  vec2 p = (v_px - u_center) / u_radius;
  float ct = max(0.06, cos(u_tilt));
  float rho = length(vec2(p.x, p.y / ct));
  if (rho < u_inner || rho > u_outer) discard;
  float t = (rho - u_inner) / max(1e-4, u_outer - u_inner);
  float gap = smoothstep(u_gap * 0.55, u_gap * 0.3, abs(t - u_gapAt));
  float ringlets = 0.55 + 0.45 * sin(t * 190.0 + 1.7) * sin(t * 47.0);
  float edge = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.95, 1.0, t));
  float a = u_opacity * ringlets * edge * (1.0 - gap);
  float z = -p.y * sin(u_tilt) / ct;
  if (length(p) < 1.0 && z < 0.0) discard;
  vec3 col = u_color * (0.72 + 0.35 * (1.0 - abs(t * 2.0 - 1.0)));
  gl_FragColor = vec4(col * a, a);
}`;

function compile(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram | null {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const v = mk(gl.VERTEX_SHADER, vs);
  const f = mk(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;
function uniforms(gl: WebGLRenderingContext, p: WebGLProgram, names: string[]): Uniforms {
  const u: Uniforms = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return u;
}

export class PlanetGL {
  readonly gl: WebGLRenderingContext;
  readonly canvas: HTMLCanvasElement;
  /** 样式贴图的边长上限(手机上 1024 × 512,省显存) */
  readonly texW: number;
  private prog: WebGLProgram;
  private u: Uniforms;
  private mesh: PlanetMesh;
  private layouts = new Map<PlanetProjection, PlanetLayout>();
  private llBuffer: WebGLBuffer;
  private bufA: WebGLBuffer;
  private bufB: WebGLBuffer;
  private pair = '';
  private nIndex: number;
  private tex = new Map<string, WebGLTexture>();
  private blank: WebGLTexture;
  private ringProg: WebGLProgram | null = null;
  private ringBuf: WebGLBuffer | null = null;
  private ringU: Uniforms = {};
  private mark: WebGLTexture | null = null;
  private lost = false;
  onLost: (() => void) | null = null;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;

  static create(canvas: HTMLCanvasElement, opts: { small?: boolean } = {}): PlanetGL | null {
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false, depth: true, powerPreference: 'high-performance' });
    } catch {
      gl = null;
    }
    if (!gl) return null;
    // 经纬网的线宽按屏幕像素算(fwidth);没有这个扩展的老设备按缩放估
    gl.getExtension('OES_standard_derivatives');
    const prog = compile(gl, PLANET_VS, PLANET_FS);
    const ringProg = compile(gl, RING_VS, RING_FS);
    const ringBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    if (!prog) return null;
    try {
      return new PlanetGL(gl, canvas, prog, !!opts.small, ringProg, ringBuf);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext, canvas: HTMLCanvasElement, prog: WebGLProgram, small: boolean, ringProg: WebGLProgram | null, ringBuf: WebGLBuffer | null) {
    this.gl = gl;
    this.ringProg = ringProg;
    this.ringBuf = ringBuf;
    this.ringU = ringProg ? uniforms(gl, ringProg, ['u_center', 'u_view', 'u_radius', 'u_tilt', 'u_inner', 'u_outer', 'u_opacity', 'u_gap', 'u_gapAt', 'u_color']) : {};
    this.canvas = canvas;
    this.prog = prog;
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.texW = small || maxTex < 4096 ? 1024 : 2048;
    this.u = uniforms(gl, prog, ['u_s', 'u_m', 'u_k', 'u_tilt', 'u_c', 'u_view', 'u_a', 'u_b', 'u_mark', 'u_mix', 'u_lon', 'u_markA', 'u_grid', 'u_px', 'u_gridC', 'u_sunLon', 'u_sunLat']);
    this.mesh = planetMesh(PLANET_NX, PLANET_NY);
    gl.useProgram(prog);
    const buf = (data: Float32Array, name: string, usage: number) => {
      const b = gl.createBuffer();
      if (!b) throw new Error('buffer');
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      return b;
    };
    this.llBuffer = buf(this.mesh.ll, 'a_ll', gl.STATIC_DRAW);
    const eq = this.layout('equirect').pos;
    this.bufA = buf(eq, 'a_pa', gl.DYNAMIC_DRAW);
    this.bufB = buf(eq, 'a_pb', gl.DYNAMIC_DRAW);
    this.pair = 'equirect|equirect';
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.mesh.index, gl.STATIC_DRAW);
    this.nIndex = this.mesh.index.length;
    this.blank = this.makeTexture(null, { w: 1, h: 1, px: new Uint8Array([16, 40, 72, 255]), nearest: true });
    canvas.addEventListener('webglcontextlost', this.lostHandler, false);
  }

  private lostHandler = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.onLost?.();
  };

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /** 某种投影下网格的位置(算一次存着) */
  layout(id: PlanetProjection): PlanetLayout {
    let l = this.layouts.get(id);
    if (!l) {
      l = planetLayout(this.mesh, id);
      this.layouts.set(id, l);
    }
    return l;
  }

  private makeTexture(
    src: TexImageSource | null,
    o: { w?: number; h?: number; px?: Uint8Array; nearest?: boolean; mip?: boolean } = {},
  ): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new Error('texture');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, o.nearest ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, o.w ?? 1, o.h ?? 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, o.px ?? null);
    const mip = !o.nearest && o.mip !== false;
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.nearest ? gl.NEAREST : mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, o.nearest ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, o.nearest ? gl.CLAMP_TO_EDGE : gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** 把画布缩成贴图的大小(2 的幂;原图已经是这么大就直接用) */
  private fit(src: HTMLCanvasElement | HTMLImageElement | ImageBitmap): TexImageSource {
    const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
    const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
    const tw = Math.min(this.texW, w >= 2048 ? 2048 : 1024);
    const th = tw / 2;
    if (w === tw && h === th) return src;
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    const ctx = c.getContext('2d');
    if (!ctx) return src;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, tw, th);
    return c;
  }

  hasStyle(key: string): boolean {
    return this.tex.has(key);
  }

  /** 放进(或换掉)一张样式贴图;src 是等距圆柱整张图 */
  setStyle(key: string, src: HTMLCanvasElement | HTMLImageElement | ImageBitmap): void {
    if (this.isLost) return;
    const old = this.tex.get(key);
    if (old) this.gl.deleteTexture(old);
    this.tex.set(key, this.makeTexture(this.fit(src)));
  }

  /** 只留下这几张样式贴图(换了世界:旧世界的扔掉) */
  keepStyles(keep: (key: string) => boolean): void {
    for (const [k, t] of this.tex) {
      if (keep(k)) continue;
      this.gl.deleteTexture(t);
      this.tex.delete(k);
    }
  }

  /** 标记层(等距圆柱、和世界一样比例的透明画布);null = 去掉 */
  setMark(src: HTMLCanvasElement | null): void {
    if (this.isLost) return;
    if (this.mark) this.gl.deleteTexture(this.mark);
    this.mark = src ? this.makeTexture(this.fit(src)) : null;
  }

  /** 画布的 CSS 大小变了(像素按 devicePixelRatio,最多 2 倍) */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.min(2, Math.max(1, dpr));
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private setPair(a: PlanetProjection, b: PlanetProjection) {
    const key = `${a}|${b}`;
    if (key === this.pair) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufA);
    gl.bufferData(gl.ARRAY_BUFFER, this.layout(a).pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufB);
    gl.bufferData(gl.ARRAY_BUFFER, this.layout(b).pos, gl.DYNAMIC_DRAW);
    this.pair = key;
  }

  /** 画一帧;贴图还没准备好就只清空 */
  draw(f: PlanetFrame): void {
    if (this.isLost) return;
    const gl = this.gl;
    const ta = this.tex.get(f.a) ?? null;
    const tb = this.tex.get(f.b) ?? ta;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!ta) return;
    gl.useProgram(this.prog);
    this.setPair(f.projA, f.projB);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const u = this.u;
    const dpr = this.dpr;
    gl.uniform1f(u.u_s, f.s);
    gl.uniform1f(u.u_m, f.m);
    gl.uniform1f(u.u_k, f.k * dpr);
    gl.uniform1f(u.u_tilt, f.tilt);
    gl.uniform2f(u.u_c, f.cx * dpr, f.cy * dpr);
    gl.uniform2f(u.u_view, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_mix, f.mix);
    gl.uniform1f(u.u_lon, f.lon);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ta);
    gl.uniform1i(u.u_a, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tb ?? ta);
    gl.uniform1i(u.u_b, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.mark ?? this.blank);
    gl.uniform1i(u.u_mark, 2);
    gl.uniform1f(u.u_markA, this.mark ? f.markA : 0);
    // 经纬网:浅蓝白细线,线宽约 1.1 个 CSS 像素
    gl.uniform1f(u.u_sunLon, f.sunLon ?? 0);
    gl.uniform1f(u.u_sunLat, f.sunLat ?? 0);
    gl.uniform1f(u.u_grid, (f.grid * Math.PI) / 180);
    gl.uniform1f(u.u_px, Math.max(1, f.k * dpr));
    gl.uniform4f(u.u_gridC, 0.92, 0.95, 1.0, 1.1 * dpr);
    gl.drawElements(gl.TRIANGLES, this.nIndex, gl.UNSIGNED_SHORT, 0);
    this.drawRings(f);
  }

  /** 画星环(没有环 / 没有程序时什么也不做) */
  private drawRings(f: PlanetFrame): void {
    const r = f.rings;
    const prog = this.ringProg;
    const buf = this.ringBuf;
    if (!r || !prog || !buf) return;
    const gl = this.gl;
    const u = this.ringU;
    gl.useProgram(prog);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const loc = gl.getAttribLocation(prog, 'a_xy');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(u.u_center, f.cx * this.dpr, f.cy * this.dpr);
    gl.uniform2f(u.u_view, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_radius, Math.max(1, f.k * this.dpr));
    gl.uniform1f(u.u_tilt, (r.tiltDeg * Math.PI) / 180);
    gl.uniform1f(u.u_inner, r.innerR);
    gl.uniform1f(u.u_outer, r.outerR);
    gl.uniform1f(u.u_opacity, r.opacity);
    gl.uniform1f(u.u_gap, r.gap);
    gl.uniform1f(u.u_gapAt, r.gapAt);
    gl.uniform3f(u.u_color, r.color[0] / 255, r.color[1] / 255, r.color[2] / 255);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.lostHandler, false);
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
