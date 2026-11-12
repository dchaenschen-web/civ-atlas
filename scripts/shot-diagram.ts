/** 本地用:截星系示意图(对数轴 / 线性轴)。 */
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.argv[2] ?? '5188'}/`;
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.5 });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${BASE}?seed=21&astro=1&life=1&system=2&planets=6&gas=2`);
await p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 180000 }).catch(() => {});
await p.waitForTimeout(1500);
await p.locator('[data-act="overview"]').first().click();
await p.waitForTimeout(600);
await p.locator('[data-tab="system"]').first().click();
await p.waitForTimeout(1200);
await p.screenshot({ path: 'out/p3-diagram-log.png', fullPage: true });
console.log('log', 'out/p3-diagram-log.png');
const lin = p.locator('[data-act="diagram-log"]').first();
if ((await lin.count()) > 0) {
  await lin.click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'out/p3-diagram-linear.png', fullPage: true });
  console.log('linear', 'out/p3-diagram-linear.png');
}
await b.close();
