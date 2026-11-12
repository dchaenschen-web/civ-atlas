/**
 * 每种行星类型出一张地形图(PNG),用来看「地貌按类型生成 + 按类型上色」的效果。
 *
 * 不依赖浏览器:World → rasterize → 用 render/terrainLook 的色板逐像素上色 → 自己写 PNG(zlib)。
 * 气态行星没有地表:用 gen/gasTexture 的条带 + 风暴画一张等距圆柱贴图。
 *
 * 跑法(node-verify 的编译流程会把它一起编):
 *   node node_modules\typescript\bin\tsc -p tsconfig.node.json
 *   node out\jsbuild\scripts\preview-types.js
 * 输出:docs/preview/terrain-<skin>.png(每种 900×450)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_PARAMS, generateWorld, type WorldParams } from '../src/gen/world';
import { applySkin, type SurfaceSkin } from '../src/gen/surfaceKinds';
import { rasterize } from '../src/gen/raster';
import { lookOf, terrainColor } from '../src/render/terrainLook';
import { gasColorAt, gasTextureOf } from '../src/gen/gasTexture';
import { ringsOf } from '../src/gen/rings';

const OUT_DIR = resolve(process.cwd(), 'docs', 'preview');
const W = 900;
const H = 450;

/** 最小 PNG 编码(RGB 8 位,filter 0),够看效果 */
function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 6 });
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const body = Buffer.concat([chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  return Buffer.concat([sig, body]);
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 地表:World → rasterize → 按类型色板 + 简单坡面阴影 */
function paintTerrain(skin: SurfaceSkin, seed: number): Buffer {
  const base: WorldParams = { ...DEFAULT_PARAMS, seed, cells: 14000, landFraction: 0.4, temperature: 0, rainfall: 1 };
  const params = applySkin({ ...base, astro: 0 }, skin);
  const world = generateWorld(params, undefined, undefined, null, undefined, null, skin);
  const scale = Math.min(1, W / world.width);
  const r = rasterize(world, scale);
  const look = lookOf(skin);
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 取样(最近邻,简单地等比缩放到目标尺寸)
      const sx = Math.min(r.w - 1, Math.round((x / W) * (r.w - 1)));
      const sy = Math.min(r.h - 1, Math.round((y / H) * (r.h - 1)));
      const k = sy * r.w + sx;
      // 西北向山体阴影:东西/南北都看(只看东西向的话,环形坑的南北壁完全没有明暗,看着就是软包)
      const kx = sy * r.w + Math.min(r.w - 1, sx + 1);
      const ky = Math.min(r.h - 1, sy + 1) * r.w + sx;
      const dzdx = (r.elev[kx] - r.elev[k]) / 45;
      const dzdy = (r.elev[ky] - r.elev[k]) / 45;
      const lam = Math.max(-1, Math.min(1, (dzdx * 0.72 - dzdy * 0.69) * 0.55));
      const shade = 0.62 + 0.52 * (lam + 1);
      const col = terrainColor(look, r.elev[k], r.temp[k], r.water[k], shade);
      const o = (y * W + x) * 3;
      rgb[o] = col[0];
      rgb[o + 1] = col[1];
      rgb[o + 2] = col[2];
    }
  }
  return encodePng(W, H, rgb);
}

/** 气态:程序化带纹贴图(等距圆柱) */
/** 气态行星:画成球(逐像素采样 gasColorAt + 兰伯特光照)再叠星环 */
function paintGasGlobe(seed: number, mass: number, radius: number): Buffer {
  const S = 720;
  const tex = gasTextureOf(seed, { mass, radius });
  const ring = ringsOf({ mass, radius, kind: 'gas', tilt: 22 }, seed);
  const rgb = new Uint8Array(S * S * 3);
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.235;
  // 观察视角:从环面上方 ~65° 看下去(环才会是明显的椭圆,而不是同心圆)
  const ringTilt = (65 * Math.PI) / 180; // 环面视角
  const tilt = (22 * Math.PI) / 180; // 球自转倾角(只轻微歪)
  const sun: [number, number, number] = [-0.55, 0.35, 0.76];
  const sl = Math.hypot(sun[0], sun[1], sun[2]);
  const svec: [number, number, number] = [sun[0] / sl, sun[1] / sl, sun[2] / sl];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x + 0.5 - cx) / R;
      const ny = (y + 0.5 - cy) / R;
      const rr = nx * nx + ny * ny;
      let col: [number, number, number] = [4, 6, 12];
      // ---- 环 ----
      if (ring) {
        // 把像平面反投影到环平面(环面相对视线倾斜 tilt)
        const u = nx;
        const v = ny / Math.max(0.06, Math.cos(ringTilt));
        const rho = Math.hypot(u, v);
        const inRing = rho >= ring.innerR && rho <= ring.outerR;
        // 环的本影:环点跑到行星背后(z<0)且离视线轴够近 → 被行星挡住阳光
        // 环点相对球心的深度:环平面上的正方向朝观察者时 z>0
        const z = -v * Math.sin(ringTilt);
        const inShadow = z < 0 && Math.hypot(nx, ny) < 1.02;
        const planetHere = rr < 1 && z < 0; // 球挡住身后的环
        if (inRing && !planetHere) {
          const t = (rho - ring.innerR) / Math.max(1e-6, ring.outerR - ring.innerR);
          if (!(Math.abs(t - ring.gapAt) < ring.gap * 0.5)) {
            const band = ring.bands.find((b) => t >= b.from && t < b.to) ?? ring.bands[0];
            const a = ring.opacity * (band?.alpha ?? 0.6) * 0.62 * (inShadow ? 0.1 : 1);
            col = [Math.round(ring.color[0] * a + col[0] * (1 - a)), Math.round(ring.color[1] * a + col[1] * (1 - a)), Math.round(ring.color[2] * a + col[2] * (1 - a))];
          }
        }
      }
      // ---- 球 ----
      if (rr <= 1) {
        const nz = Math.sqrt(Math.max(0, 1 - rr));
        // 按自转倾角把法线转过来,再取经纬度采样贴图
        const ny2 = ny * Math.cos(tilt) - nz * Math.sin(tilt);
        const nz2 = ny * Math.sin(tilt) + nz * Math.cos(tilt);
        const lat = (Math.asin(Math.max(-1, Math.min(1, ny2))) * 180) / Math.PI;
        const lon = ((Math.atan2(nx, nz2) * 180) / Math.PI + 720) % 360;
        const base = gasColorAt(tex, lat, lon);
        const lam = Math.max(0.34, nx * svec[0] + ny2 * svec[1] + nz2 * svec[2]);
        // 边缘变暗一点(大气散射的观感)
        const limb = 0.8 + 0.2 * Math.pow(Math.max(0, 1 - rr), 0.4);
        col = [Math.round(base[0] * lam * limb), Math.round(base[1] * lam * limb), Math.round(base[2] * lam * limb)];
      }
      const o = (y * S + x) * 3;
      rgb[o] = col[0];
      rgb[o + 1] = col[1];
      rgb[o + 2] = col[2];
    }
  }
  return encodePng(S, S, rgb);
}

function paintGas(seed: number): Buffer {
  const tex = gasTextureOf(seed, { mass: 320, radius: 10 });
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * 360;
      const c = gasColorAt(tex, lat, lon);
      const o = (y * W + x) * 3;
      rgb[o] = c[0];
      rgb[o + 1] = c[1];
      rgb[o + 2] = c[2];
    }
  }
  return encodePng(W, H, rgb);
}

mkdirSync(OUT_DIR, { recursive: true });
const skins: SurfaceSkin[] = ['earth', 'ocean', 'desert', 'frozen', 'lava', 'airless', 'dwarf'];
const seed = 20261111;
for (const skin of skins) {
  const file = resolve(OUT_DIR, `terrain-${skin}.png`);
  writeFileSync(file, paintTerrain(skin, seed));
  console.log('✓ ' + file);
{
  // 三颗参考风格:木星(暖巨、重环)/ 土星(淡金)/ 海王星(深蓝、无重环)
  const cases: { name: string; seed: number; mass: number; radius: number }[] = [
    { name: 'jupiter', seed: 20261111, mass: 318, radius: 11.2 },
    { name: 'saturn', seed: 20261212, mass: 95, radius: 9.4 },
    { name: 'neptune', seed: 20261313, mass: 17, radius: 3.9 },
  ];
  for (const c of cases) {
    const file = resolve(OUT_DIR, `gas-${c.name}.png`);
    writeFileSync(file, paintGasGlobe(c.seed, c.mass, c.radius));
    console.log('✓ ' + file);
  }
}
  console.log('✓ ' + file);
}
void dirname;



void paintGas;