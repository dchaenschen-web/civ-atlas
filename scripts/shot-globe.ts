import { chromium } from 'playwright';
const B = 'http://localhost:5188/';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.5 });
const logs: string[] = [];
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') logs.push('[console] ' + m.text()); });
await p.goto(`${B}?seed=21&astro=1&life=1&system=2&impact=1&planets=5`);
await p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 180000 }).catch(() => {});
await p.waitForTimeout(1500);
await p.locator('[data-act="overview"]').first().click();
await p.waitForTimeout(700);
await p.locator('[data-tab="system"]').first().click();
await p.waitForTimeout(2000);
await p.screenshot({ path: 'out/s3-globe-3d.png', fullPage: true });
console.log('3d', 'out/s3-globe-3d.png');
// 拖拽旋转 + 滚轮缩放
const cv = p.locator('[data-act="system-globe"]').first();
const box = await cv.boundingBox();
if (box) {
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 60, { steps: 12 });
  await p.mouse.up();
  await p.mouse.wheel(0, -300);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: 'out/s3-globe-rotated.png', fullPage: true });
  console.log('rotated', 'out/s3-globe-rotated.png');
}
// 2D 回退
const btn = p.locator('[data-act="globe-2d"]').first();
if ((await btn.count()) > 0) {
  await btn.click();
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'out/s3-globe-2d.png', fullPage: true });
  console.log('2d', 'out/s3-globe-2d.png');
}
if (logs.length) console.log(logs.slice(0, 8).join('\n'));
await b.close();
