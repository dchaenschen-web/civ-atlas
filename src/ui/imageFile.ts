/**
 * 照手绘图生成时读图:是不是图片、读一张图并缩小好准备认(新建世界的弹窗选图、编辑时「换一张」都走这里)。
 * 认图、地图上的预览在 ImportImage.tsx(那边照旧一起导出这几样);单独一个文件,首页上的新建弹窗不用带上认图的界面。
 */
import { preparePicture, type Picture } from '../gen/sketchImage';
import { showToast } from './toastStore';

/** S4 原图约束：最长边不超过 1024，单张不超过 1.5 MB。 */
export const MAX_SIDE = 1024;
export const MAX_IMAGE_BYTES = 1_500_000;
/** 认之前先把图缩到长边不超过这么多(找线还用得上细节,又不至于太慢) */
const DECODE_SIDE = 1024;

/** 拖进来的是不是图片 */
export const isImageFile = (f: File) => f.type.startsWith('image/');

/** 读好的一张图:文件名、本机的 blob 网址、原图多大、缩小后准备好认的像素 */
export interface LoadedImage {
  name: string;
  url: string;
  w: number;
  h: number;
  pic: Picture;
}

/** 读一张图、准备好认;读不出来、太大出一条提示,返回 null(新建弹窗选图、「换一张」都走这里) */
export async function loadImage(file: File): Promise<LoadedImage | null> {
  const url = URL.createObjectURL(file);
  const fail = (text: string, more: string) => {
    URL.revokeObjectURL(url);
    showToast({ id: 'import', kind: 'error', text, more: [more] });
    return null;
  };
  // 先只读出图有多大(浏览器到画的时候才整张解码),太大的不解码
  const img = new Image();
  const ok = await new Promise<boolean>((done) => {
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!ok || !w || !h) return fail('没能读出这张图', `${file.name} 不是能打开的图片`);
  if (w > MAX_SIDE || h > MAX_SIDE) return fail('这张图太大了', `换一张宽、高都不超过 ${MAX_SIDE} 像素的图`);
  const k = Math.min(1, DECODE_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  try {
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(img, 0, 0, cw, ch);
    return { name: file.name, url, w, h, pic: preparePicture(ctx.getImageData(0, 0, cw, ch)) };
  } catch {
    return fail('没能读出这张图', `${file.name} 不是能打开的图片`);
  }
}
