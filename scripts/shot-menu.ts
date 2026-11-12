/** 本地用:截"新建世界"两步菜单(星系结构 / 行星与生命 / 技术路线)和「技术路线」页签。 */
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.argv[2] ?? '5188'}/`;
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
const logs: string[] = [];
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

// 1) 新建世界弹窗:第 1 步 → 第 2 步(参数分组)
await p.goto(BASE);
await p.waitForTimeout(2500);
const newBtn = p.locator('button', { hasText: '新建世界' }).first();
if ((await newBtn.count()) > 0) {
  await newBtn.click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'out/p4-menu-1.png' });
  const next = p.locator('[data-act="dlg-next"]').first();
  if ((await next.count()) > 0) {
    await next.click();
    await p.waitForTimeout(1000);
    await p.screenshot({ path: 'out/p4-menu-2.png' });
    console.log('menu', 'out/p4-menu-2.png');
  } else console.log('✗ 找不到下一步');
} else console.log('✗ 找不到新建世界按钮');

// 2) 世界页 → 概览 → 技术路线 页签
await p.goto(`${BASE}?seed=21&astro=1&life=1&system=2&tilt=30&geo=1.6`);
await p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 180000 }).catch(() => {});
await p.waitForTimeout(1500);
const ov = p.locator('[data-act="overview"]').first();
if ((await ov.count()) > 0) {
  await ov.click();
  await p.waitForTimeout(600);
  const tab = p.locator('[data-tab="tech"]').first();
  if ((await tab.count()) > 0) {
    await tab.click();
    await p.waitForTimeout(800);
    await p.screenshot({ path: 'out/p4-tech.png' });
    console.log('tech', 'out/p4-tech.png');
  } else console.log('✗ 概览里没有「技术路线」页签');
  // 顺便看一眼星球系页里的呼吸状态
  const sys = p.locator('[data-tab="system"]').first();
  if ((await sys.count()) > 0) {
    await sys.click();
    await p.waitForTimeout(800);
    await p.screenshot({ path: 'out/p4-system.png' });
    console.log('system', 'out/p4-system.png');
  }
}
if (logs.length) console.log(logs.slice(0, 8).join('\n'));
await b.close();
