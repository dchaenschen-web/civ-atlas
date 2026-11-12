/**
 * 本地用:开本机 dev server,截「星球系」页、行星地表生成、编年史天象区。
 * 运行:node_modules/.bin/tsx scripts/shot-system.ts [端口]
 * 输出:out/r11-*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.argv[2] ?? '5188';
const BASE = `http://localhost:${PORT}/`;
mkdirSync('out', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 });
const logs: string[] = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[console] ${m.text()}`);
});

// 开一个与默认设计不同、且确定有生物圈/卫星的世界:黄矮星、倾角 30°、地质活跃
const Q = 'seed=21&astro=1&system=2&tilt=30&geo=1.6&cells=12000';
await page.goto(`${BASE}?${Q}`);
await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 180000 });
await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'out/r11-ui.png' });
console.log('ui', 'out/r11-ui.png');

// 世界概览 → 「星球系」页签
const ov = page.locator('[data-act="overview"]');
if ((await ov.count()) === 0) {
  console.log('✗ 找不到世界概览入口');
} else {
  await ov.first().click();
  await page.waitForTimeout(800);
  const tab = page.locator('[data-tab="system"]');
  if ((await tab.count()) === 0) {
    console.log('✗ 概览里没有「星球系」页签');
  } else {
    await tab.first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'out/r11-system.png' });
    console.log('system', 'out/r11-system.png');
    const gen = page.locator('[data-act="gen-surface"]');
    if ((await gen.count()) > 0) {
      await gen.first().click();
      await page.waitForFunction(() => !document.body.innerText.includes('正在按预算精度生成地表'), null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(800);
      await page.screenshot({ path: 'out/r11-planet.png' });
      console.log('planet', 'out/r11-planet.png');
    } else console.log('— 没有可生成地表的行星按钮');
  }
  // 编年史页签 + 天象纪
  const chron = page.locator('[data-tab="chronicle"]');
  if ((await chron.count()) > 0) {
    await chron.first().click();
    await page.waitForTimeout(1200);
    const omenBtn = page.locator('button', { hasText: '天象纪' });
    if ((await omenBtn.count()) > 0) {
      await omenBtn.first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: 'out/r11-omen.png' });
      console.log('omen', 'out/r11-omen.png');
    } else console.log('— 编年史里没有「天象纪」按钮');
  }
}

if (logs.length) console.log(logs.slice(0, 10).join('\n'));
await browser.close();