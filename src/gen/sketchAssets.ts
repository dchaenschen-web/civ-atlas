/**
 * S4 手绘图原图资产:体积/尺寸约束、IndexedDB 存取、导出 .world 时用的独立资产包。
 *
 * 一条记录里存三样:
 *   - 压好的原图(WebP/PNG 字节、类型、宽高),地形编辑要铺它当半透明底图;
 *   - 认出来的草图格子图(cells,gen/sketch.ts 的 encodeLayer 串),生成世界时按它长海陆;
 *   - 名字与尺寸(存档里只留 sketchId 这一个引用,别的一概不进存档)。
 *
 * 这个文件不碰 DOM:界面侧的选图/压缩在 ui/sketchAssetStore.ts 里。
 */

/** 原图最长边上限(像素) */
export const SKETCH_ASSET_MAX_SIDE = 1024;
/** 单张压缩后上限(字节) */
export const SKETCH_ASSET_MAX_BYTES = 1_500_000;
/** 一个世界所有手绘图的总上限(字节) */
export const SKETCH_ASSET_MAX_TOTAL_BYTES = 8_000_000;
/** sketchId 的长度上限(存档里的 cleanSystem 按 1–64 个 [A-Za-z0-9:_-] 校验) */
export const SKETCH_ID_MAX = 64;

const DB_NAME = 'civ-atlas:sketch-assets';
const DB_VERSION = 1;
const STORE = 'assets';

export interface SketchAssetInput {
  worldId: string;
  bodyId: string;
  name: string;
  width: number;
  height: number;
  type: string;
  bytes: Uint8Array;
  /** 认出来的草图格子图(encodeLayer 的串);没认 = 不写,等于这张图不参与生成 */
  cells?: string;
}

export type SketchAsset = SketchAssetInput;
export interface SketchAssetRef {
  worldId: string;
  bodyId: string;
  name: string;
  width: number;
  height: number;
  type: string;
  /** IndexedDB 的主键,也是存档里 BodyGen.sketchId 用的那个串 */
  key: string;
  /** 原图字节数 */
  size: number;
  /** 认出来的格子图有没有 */
  recognized: boolean;
}

/** 天体 id:行星 `p<下标>`,卫星 `m<行星下标>-<卫星下标>`(只用 [A-Za-z0-9-],拼出来能进 sketchId 的字符集) */
export function bodyIdOfPlanet(index: number): string {
  return `p${index}`;
}
export function bodyIdOfMoon(planet: number, moon: number): string {
  return `m${planet}-${moon}`;
}

/** 世界 id + 天体 id → sketchId(存档里的引用) */
export function sketchIdOf(worldId: string, bodyId: string): string {
  return `${worldId}:${bodyId}`.slice(0, SKETCH_ID_MAX);
}

/** sketchId 拆回天体 id(取最后一个冒号后面那段) */
export function bodyIdFromSketchId(sketchId: string): string {
  const i = sketchId.lastIndexOf(':');
  return i < 0 ? sketchId : sketchId.slice(i + 1);
}

/** sketchId 是不是存档愿意收的样子 */
export function cleanSketchId(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(v) ? v : undefined;
}

/** 尺寸与体积对不对;越界抛带人话的错(界面原样显示) */
export function validateSketchAsset(
  asset: { width: number; height: number; size?: number; bytes?: Uint8Array; recognized?: boolean; cells?: string },
): void {
  const size = asset.size ?? asset.bytes?.byteLength ?? 0;
  if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width < 1 || asset.height < 1 || Math.max(asset.width, asset.height) > SKETCH_ASSET_MAX_SIDE) {
    throw new Error(`手绘图最长边不能超过 ${SKETCH_ASSET_MAX_SIDE} 像素`);
  }
  if (!Number.isFinite(size) || size <= 0) throw new Error('手绘图是空的');
  if (size > SKETCH_ASSET_MAX_BYTES) throw new Error(`单张手绘图不能超过 ${(SKETCH_ASSET_MAX_BYTES / 1_000_000).toFixed(1)} MB`);
  if (asset.cells !== undefined && typeof asset.cells !== 'string') throw new Error('手绘图认出来的格子不对');
}

function keyOf(worldId: string, bodyId: string): string {
  return sketchIdOf(worldId, bodyId);
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** 存一张(同一天体再存会换掉旧的);总量超 8 MB 抛错 */
export async function putSketchAsset(asset: SketchAssetInput): Promise<SketchAssetRef> {
  validateSketchAsset(asset);
  const keys = [asset.worldId, asset.bodyId];
  if (!keys.every((k) => /^[A-Za-z0-9_-]{1,40}$/.test(k))) throw new Error('世界 / 天体编号不对');
  const d = await db();
  try {
    const existing = await getSketchAssetRefs(asset.worldId);
    const total = existing.filter((x) => x.bodyId !== asset.bodyId).reduce((n, x) => n + x.size, 0) + asset.bytes.byteLength;
    if (total > SKETCH_ASSET_MAX_TOTAL_BYTES) {
      throw new Error(`一个世界的手绘图总量不能超过 ${(SKETCH_ASSET_MAX_TOTAL_BYTES / 1_000_000).toFixed(0)} MB(现在会到 ${(total / 1_000_000).toFixed(1)} MB)`);
    }
    const ref: SketchAssetRef = {
      worldId: asset.worldId,
      bodyId: asset.bodyId,
      name: asset.name,
      width: asset.width,
      height: asset.height,
      type: asset.type,
      key: keyOf(asset.worldId, asset.bodyId),
      size: asset.bytes.byteLength,
      recognized: !!asset.cells,
    };
    await new Promise<void>((resolve, reject) => {
      const r = d.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...ref, bytes: asset.bytes, ...(asset.cells ? { cells: asset.cells } : {}) });
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    return ref;
  } finally {
    d.close();
  }
}

/** 取一张(带原图字节和认出的格子图);没有 = null */
export async function getSketchAsset(worldId: string, bodyId: string): Promise<SketchAsset | null> {
  const d = await db();
  try {
    const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const r = d.transaction(STORE).objectStore(STORE).get(keyOf(worldId, bodyId));
      r.onsuccess = () => resolve(r.result as Record<string, unknown> | undefined);
      r.onerror = () => reject(r.error);
    });
    if (!row) return null;
    const bytes = new Uint8Array(row.bytes as ArrayBuffer);
    return {
      worldId: String(row.worldId),
      bodyId: String(row.bodyId),
      name: String(row.name),
      width: Number(row.width),
      height: Number(row.height),
      type: String(row.type),
      bytes,
      ...(typeof row.cells === 'string' ? { cells: row.cells } : {}),
    };
  } finally {
    d.close();
  }
}

/** 某个世界的全部引用(不带字节,给界面列表、总量提示用) */
export async function getSketchAssetRefs(worldId: string): Promise<SketchAssetRef[]> {
  const d = await db();
  try {
    const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const r = d.transaction(STORE).objectStore(STORE).getAll();
      r.onsuccess = () => resolve((r.result ?? []) as Record<string, unknown>[]);
      r.onerror = () => reject(r.error);
    });
    return rows
      .filter((x) => x.worldId === worldId)
      .map((x) => ({
        worldId: String(x.worldId),
        bodyId: String(x.bodyId),
        name: String(x.name),
        width: Number(x.width),
        height: Number(x.height),
        type: String(x.type),
        key: String(x.key),
        size: Number(x.size),
        recognized: !!x.cells,
      }));
  } finally {
    d.close();
  }
}

/** 删一张(天体改用随机生成时用) */
export async function dropSketchAsset(worldId: string, bodyId: string): Promise<void> {
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const r = d.transaction(STORE, 'readwrite').objectStore(STORE).delete(keyOf(worldId, bodyId));
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } finally {
    d.close();
  }
}

// ---------------------------------------------------------------------------
// 导出 / 导入用的资产包(不和 .world 抢格式:单独一个 blob,导出时并排给出)

const MAGIC = 'CIV-SKETCH-ASSETS-1';
const enc = new TextEncoder();
const dec = new TextDecoder();

interface PackMeta {
  worldId: string;
  bodyId: string;
  name: string;
  width: number;
  height: number;
  type: string;
  size: number;
  cells?: string;
}

/** 打包:一行 UTF-8 JSON 头(带 magic 和每张的尺寸)+ 各张原图字节依次接上 */
export async function makeSketchAssetPack(assets: readonly SketchAssetInput[]): Promise<Blob> {
  const meta: PackMeta[] = [];
  let total = 0;
  for (const a of assets) {
    validateSketchAsset(a);
    total += a.bytes.byteLength;
    meta.push({
      worldId: a.worldId,
      bodyId: a.bodyId,
      name: a.name,
      width: a.width,
      height: a.height,
      type: a.type,
      size: a.bytes.byteLength,
      ...(a.cells ? { cells: a.cells } : {}),
    });
  }
  if (total > SKETCH_ASSET_MAX_TOTAL_BYTES) throw new Error('手绘图总量不能超过 8 MB');
  const header = enc.encode(`${JSON.stringify({ magic: MAGIC, assets: meta })}\n`);
  const out = new Uint8Array(header.byteLength + total);
  out.set(header);
  let at = header.byteLength;
  for (const a of assets) {
    out.set(a.bytes, at);
    at += a.bytes.byteLength;
  }
  return new Blob([out as unknown as BlobPart], { type: 'application/x-civ-sketch-assets' });
}

/** 拆包:头里写的每张尺寸必须和字节对得上,多一个字节都算坏 */
export async function openSketchAssetPack(input: Blob | Uint8Array): Promise<SketchAsset[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  const nl = bytes.indexOf(10);
  if (nl < 0) throw new Error('无效的手绘图资产包');
  let manifest: { magic?: string; assets?: PackMeta[] };
  try {
    manifest = JSON.parse(dec.decode(bytes.slice(0, nl))) as { magic?: string; assets?: PackMeta[] };
  } catch {
    throw new Error('无效的手绘图资产包');
  }
  if (manifest.magic !== MAGIC || !Array.isArray(manifest.assets)) throw new Error('无效的手绘图资产包');
  let at = nl + 1;
  const out: SketchAsset[] = [];
  let total = 0;
  for (const m of manifest.assets) {
    if (!Number.isInteger(m.size) || m.size <= 0 || at + m.size > bytes.length) throw new Error('手绘图资产包已损坏');
    const b = bytes.slice(at, at + m.size);
    at += m.size;
    total += m.size;
    if (total > SKETCH_ASSET_MAX_TOTAL_BYTES) throw new Error('手绘图资产包超过 8 MB');
    validateSketchAsset({ width: m.width, height: m.height, bytes: b, recognized: !!m.cells });
    out.push({ worldId: m.worldId, bodyId: m.bodyId, name: m.name, width: m.width, height: m.height, type: m.type, bytes: b, ...(m.cells ? { cells: m.cells } : {}) });
  }
  if (at !== bytes.length) throw new Error('手绘图资产包有多余数据');
  return out;
}
