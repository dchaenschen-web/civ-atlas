/**
 * 本地用:无头 Edge 打开本机 dev server,给已经生成的世界截图。
 * 运行:node_modules/.bin/tsx scripts/local-shots.ts <输出前缀> <full|quick> seed=4 landFraction=0.3 ...
 * (参数一个一个传,不放 & ,免得被 cmd 拆开)
 * 默认输出到 out/shots-<前缀>-*.png
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5188/';
const tag = process.argv[2] ?? 'world';
const set = process.argv[3] ?? 'full';
const overrides = process.argv.slice(4);
const qp = new Map<string, string>();
for (const a of ['seed=4', ...overrides]) {
  const [k, v] = a.split('=');
  if (k && v !== undefined) qp.set(k, v);
}
const query = [...qp].map(([k, v]) => `${k}=${v}`).join('&');
const outDir = 'out';
mkdirSync(outDir, { recursive: true });

const SHOTS: { name: string; q: string; kind: 'ui' | 'canvas'; waitLabels?: boolean }[] = [
  // 实景底图 + 国家填色:像从太空看的地球
  { name: 'satellite-polities', q: 'map=satellite&sat=classic&fill=polities&proj=robinson', kind: 'canvas' },
  // 地理图:地图册式分层设色
  { name: 'geo-polities', q: 'map=geo&fill=polities&proj=robinson', kind: 'canvas' },
  // 生态、气温:这颗星球的气候分布
  { name: 'biomes', q: 'map=biomes&fill=none&proj=robinson', kind: 'canvas' },
  { name: 'temperature', q: 'map=temperature&fill=none&proj=robinson', kind: 'canvas' },
  { name: 'precipitation', q: 'map=precipitation&fill=none&proj=robinson', kind: 'canvas' },
  // 民族分布
  { name: 'cultures', q: 'map=geo&fill=cultures&proj=robinson', kind: 'canvas' },
  // 整个界面:看时间轴、国家列表、编年史
  { name: 'ui', q: 'map=geo&fill=polities&proj=robinson', kind: 'ui' },
  // 放大看地名:手绘底图上几百公里的范围
  { name: 'zoom', q: 'map=geo&fill=polities&proj=robinson&center=90', kind: 'ui' },
];

/** 把地图各层 canvas 叠成一张(照 scripts/snap.ts 的做法) */
async function composeMap(page: Page): Promise<string> {
  return page.evaluate(() => {
    const box = document.querySelector('.map-box') as HTMLElement;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const layers = [...document.querySelectorAll('.map-box canvas, .map-box-upper canvas, .screen-layer canvas')] as HTMLCanvasElement[];
    const br = box.getBoundingClientRect();
    const sr = (box.closest('.stage') as HTMLElement).getBoundingClientRect();
    const fx = (sr.left + sr.width / 2 - (bw * (br.width / bw)) / 2 - br.left) / (br.width / bw);
    const cv = document.createElement('canvas');
    cv.width = layers[0].width;
    cv.height = layers[0].height;
    const cc = cv.getContext('2d')!;
    cc.imageSmoothingQuality = 'high';
    const k = br.width / bw;
    for (const l of layers) {
      const st = getComputedStyle(l);
      const lr = l.getBoundingClientRect();
      if (!l.width || !l.height || !lr.width || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
      cc.globalAlpha = Number(st.opacity);
      cc.globalCompositeOperation = st.mixBlendMode === 'multiply' ? 'multiply' : 'source-over';
      const sx = cv.width / bw;
      const sy = cv.height / bh;
      cc.drawImage(l, ((lr.left - br.left) / k - fx) * sx, ((lr.top - br.top) / k) * sy, (lr.width / k) * sx, (lr.height / k) * sy);
    }
    cc.globalAlpha = 1;
    cc.globalCompositeOperation = 'source-over';
    return cv.toDataURL('image/png');
  });
}

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const logs: string[] = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[console] ${m.text()}`);
});

// quick:只截两张,给候选世界比形状用
const list = set === 'quick' ? SHOTS.filter((s) => s.name === 'satellite-polities' || s.name === 'geo-polities') : SHOTS;

const fs = await import('node:fs');
for (const s of list) {
  const url = `${BASE}?${query}&${s.q}`;
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 180000 }).catch(() => {});
  await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 180000 }).catch(() => {});
  await page.waitForFunction(() => (window as any).__wfLabels?.ready, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const out = `${outDir}/shots-${tag}-${s.name}.png`;
  if (s.kind === 'canvas') {
    const dataUrl = await composeMap(page);
    fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  } else if (s.name === 'zoom') {
    // 滚轮放大 3 倍
    const r = (await page.locator('.map-box').boundingBox())!;
    const st = (await page.locator('main.stage').boundingBox())!;
    await page.mouse.move(st.x + st.width / 2 + (r.width / 6), st.y + st.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(150);
    }
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1500);
    await page.locator('main.stage').screenshot({ path: out });
  } else {
    await page.screenshot({ path: out });
  }
  console.log(`${s.name}: ${out} (${Date.now() - t0} ms)`);
}
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
