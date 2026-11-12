/**
 * S4 手绘图资产的浏览器侧入口:选图 → 缩到最长边 ≤1024 → 压成 WebP/PNG(单张 ≤1.5 MB)→ 认成草图格子图
 * → 存 IndexedDB(世界 id + 天体 id)→ 存档里只留 sketchId 这一个引用。
 *
 * 生成世界是同步的(worker 里也跑),所以认好的格子图另外放一份内存缓存:同一个会话里导入完马上就能用;
 * 重新打开存档时调 hydrateSketchAssets(世界 id) 把它读回内存,再让界面重画。
 */
import { preparePicture, autoSeaLevel, levelsFrom, placeOnLayer, layerStats, importWarning, type ImportWarning } from '../gen/sketchImage';
import { LAYER_W, LAYER_H, encodeLayer, decodeLayer, type SketchEdit, type SketchImage } from '../gen/sketch';
import {
  bodyIdOfMoon,
  bodyIdOfPlanet,
  bodyIdFromSketchId,
  dropSketchAsset,
  getSketchAsset,
  getSketchAssetRefs,
  makeSketchAssetPack,
  openSketchAssetPack,
  putSketchAsset,
  sketchIdOf,
  validateSketchAsset,
  SKETCH_ASSET_MAX_BYTES,
  SKETCH_ASSET_MAX_SIDE,
  type SketchAsset,
  type SketchAssetRef,
} from '../gen/sketchAssets';

export { bodyIdOfMoon, bodyIdOfPlanet, bodyIdFromSketchId, sketchIdOf, SKETCH_ASSET_MAX_BYTES, SKETCH_ASSET_MAX_SIDE };

/**
 * 还没存盘的草稿世界用哪个 id 存手绘图:按种子和 salt 派生,同一个草稿重新打开还是同一批图。
 * (建好世界以后由世界 id 接管,见 exportSketchPack / importSketchPack。)
 */
export function draftWorldIdOf(params: { seed: number; salt?: number }): string {
  return `d${params.seed}s${Math.round(params.salt ?? 1)}`;
}

/** 导出资产包(导出 .world 时并排给出;同世界的全部手绘图打成一个 blob) */
export async function exportSketchPack(worldId: string): Promise<Blob | null> {
  const refs = await getSketchAssetRefs(worldId);
  if (!refs.length) return null;
  const assets: SketchAsset[] = [];
  for (const ref of refs) {
    const a = await getSketchAsset(worldId, ref.bodyId);
    if (a) assets.push(a);
  }
  return assets.length ? makeSketchAssetPack(assets) : null;
}

/** 导入资产包:改存到这个世界的 id 下(打开别人的 .world 时用),返回认回来几张 */
export async function importSketchPack(worldId: string, blob: Blob | Uint8Array): Promise<number> {
  const assets = await openSketchAssetPack(blob);
  let n = 0;
  for (const a of assets) {
    const ref = await putSketchAsset({ ...a, worldId });
    if (a.cells && decodeLayer(a.cells)) grids.set(ref.key, { name: a.name, cells: a.cells });
    const url = await toDataUrl(a.bytes, a.type);
    if (url) urls.set(ref.key, url);
    n++;
  }
  return n;
}

/** 导入结果:引用 + 认出来的格子图 + 一句摘要 */
export interface SketchImportResult {
  ref: SketchAssetRef;
  cells: string;
  land: number;
  pieces: number;
  warning: ImportWarning;
}

/** 认好的格子图(内存缓存;键 = sketchId) */
const grids = new Map<string, SketchImage>();
/** 原图(data URL,地形编辑当底图;键 = sketchId) */
const urls = new Map<string, string>();

/** 某颗天体已经导入的手绘图(没有 = null) */
export function sketchImageOf(sketchId: string | undefined): SketchImage | null {
  return sketchId ? (grids.get(sketchId) ?? null) : null;
}

/** sketchId → 生成时交给 generateWorld 的草图(没导入过 / 没水合 = null) */
export function sketchOf(sketchId: string | undefined): SketchEdit | null {
  const img = sketchImageOf(sketchId);
  return img ? { rest: 'auto', strokes: [], image: img } : null;
}

/** 地形编辑的半透明底图(data URL);没导入过 = null */
export function sketchUrlOf(sketchId: string | undefined): string | null {
  return sketchId ? (urls.get(sketchId) ?? null) : null;
}

/** 一次导入最多压几次(体积降不下去就报错) */
const ENCODE_TRIES = 4;

/** 把图缩到最长边 ≤ SKETCH_ASSET_MAX_SIDE,返回像素(认图、压缩都用它) */
export async function decodeAndFit(file: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, SKETCH_ASSET_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('浏览器给不了画布,导不了图');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  } finally {
    bmp.close();
  }
}

/** 像素 → 压好的图片字节(WebP 优先,压不到 1.5 MB 就降质量,再不行换 PNG) */
async function encodeFit(data: Uint8ClampedArray, width: number, height: number): Promise<{ bytes: Uint8Array; type: string }> {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('浏览器给不了画布,导不了图');
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  for (let k = 0; k < ENCODE_TRIES; k++) {
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/webp', 0.88 - k * 0.18));
    if (!blob) break;
    const buf = await blob.arrayBuffer();
    if (buf.byteLength <= SKETCH_ASSET_MAX_BYTES) return { bytes: new Uint8Array(buf), type: 'image/webp' };
  }
  const png = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
  if (!png) throw new Error('压不出图片');
  const buf = await png.arrayBuffer();
  return { bytes: new Uint8Array(buf), type: 'image/png' };
}

/** 认图:按深浅分海陆和丘陵/山地(自动定海平面;彩色图会带提醒) */
export function recognize(data: Uint8ClampedArray, width: number, height: number): { cells: string; warning: ImportWarning; land: number; pieces: number } {
  const pic = preparePicture({ data, width, height });
  const sea = autoSeaLevel(pic);
  const values = levelsFrom(pic, { sea, heights: true });
  const layer = placeOnLayer(values, pic.w, pic.h, { fit: 'fill' });
  const stats = layerStats(layer);
  return {
    cells: encodeLayer(layer),
    warning: importWarning(stats, 'level', pic.colorful),
    land: stats.land,
    pieces: stats.pieces,
  };
}

/** 一小段原文图给界面当底图(压过的 PNG/WebP 直接当 data URL 用) */
async function toDataUrl(bytes: Uint8Array, type: string): Promise<string | null> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: type || 'image/webp' });
  return await new Promise<string | null>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

/**
 * 导入一张手绘图:压缩、认图、存 IndexedDB,返回引用。
 * 体积/尺寸超上限、存不下都会抛错(界面把错话原样显示)。
 */
export async function importSketchImage(file: File, worldId: string, bodyId: string, name?: string): Promise<SketchImportResult> {
  const px = await decodeAndFit(file);
  const packed = await encodeFit(px.data, px.width, px.height);
  const rec = recognize(px.data, px.width, px.height);
  const asset: SketchAsset = {
    worldId,
    bodyId,
    name: (name ?? file.name ?? '手绘图').slice(0, 60),
    width: px.width,
    height: px.height,
    type: packed.type,
    bytes: packed.bytes,
    cells: rec.cells,
  };
  validateSketchAsset(asset);
  const ref = await putSketchAsset(asset);
  grids.set(ref.key, { name: asset.name, cells: rec.cells });
  const url = await toDataUrl(packed.bytes, packed.type);
  if (url) urls.set(ref.key, url);
  return { ref, cells: rec.cells, land: rec.land, pieces: rec.pieces, warning: rec.warning };
}

/** 重新打开存档时把这个世界的手绘图读回内存(界面进星系页 / Studio 时调一次) */
export async function hydrateSketchAssets(worldId: string): Promise<number> {
  const refs = await getSketchAssetRefs(worldId);
  let n = 0;
  for (const ref of refs) {
    const a = await getSketchAsset(worldId, ref.bodyId);
    if (!a) continue;
    if (a.cells && !grids.has(ref.key) && decodeLayer(a.cells)) {
      grids.set(ref.key, { name: a.name, cells: a.cells });
      n++;
    }
    if (!urls.has(ref.key)) {
      const url = await toDataUrl(a.bytes, a.type);
      if (url) urls.set(ref.key, url);
    }
  }
  return n;
}

/** 把这颗天体的手绘图去掉(改用随机生成) */
export async function dropSketchImage(worldId: string, bodyId: string): Promise<void> {
  const key = sketchIdOf(worldId, bodyId);
  grids.delete(key);
  urls.delete(key);
  await dropSketchAsset(worldId, bodyId);
}

/** 世界的手绘图一共占多少字节(界面提示用) */
export async function sketchAssetsBytes(worldId: string): Promise<number> {
  return (await getSketchAssetRefs(worldId)).reduce((n, r) => n + r.size, 0);
}

/** 认出的格子图有几张(调试 / 测试用) */
export function gridCount(): number {
  return grids.size;
}

/** 换世界时清内存缓存 */
export function clearSketchCache(): void {
  grids.clear();
  urls.clear();
}

export { LAYER_W, LAYER_H };
