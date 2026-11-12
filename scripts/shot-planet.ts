/** 本地用:截「其他固态行星地形」缩略图与四种图层。 */
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.argv[2] ?? '5188'}/`;
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.5 });
const logs: string[] = [];
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error') logs.push('[console] ' + m.text());
});

await p.goto(`${BASE}?seed=21&astro=1&life=1&system=2&tilt=30&geo=1.6&planets=4`);
await p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 180000 }).catch(() => {});
await p.waitForTimeout(1500);
await p.locator('[data-act="overview"]').first().click();
await p.waitForTimeout(600);
await p.locator('[data-tab="system"]').first().click();
await p.waitForTimeout(800);

const gen = p.locator('[data-act="gen-surface"]').first();
if ((await gen.count()) === 0) {
  console.log('✗ 没有可生成地表的行星');
} else {
  await gen.click();
  await p.waitForFunction(() => document.querySelectorAll('canvas').length >= 2, null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.screenshot({ path: 'out/p2-planet-terrain.png', fullPage: true });
  console.log('terrain', 'out/p2-planet-terrain.png');
  for (const layer of ['biome', 'temp', 'precip']) {
    const btn = p.locator(`[data-act="planet-layer-${layer}"]`).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `out/p2-planet-${layer}.png`, fullPage: true });
      console.log(layer, `out/p2-planet-${layer}.png`);
    } else console.log('✗ 没有图层按钮', layer);
  }
}
if (logs.length) console.log(logs.slice(0, 8).join('\n'));
await b.close();
