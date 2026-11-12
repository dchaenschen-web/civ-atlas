/** 本地用:截「星系结构编辑器」(新建世界第 2 步里打开)。 */
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.argv[2] ?? '5188'}/`;
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
const logs: string[] = [];
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error') logs.push('[console] ' + m.text());
});

await p.goto(BASE);
await p.waitForTimeout(2500);
await p.locator('button', { hasText: '新建世界' }).first().click();
await p.waitForTimeout(800);
const next = p.locator('[data-act="dlg-next"]').first();
if ((await next.count()) === 0) {
  console.log('✗ 没有「下一步」');
  process.exit(0);
}
await next.click();
await p.waitForTimeout(800);
await p.screenshot({ path: 'out/s2-dialog-step2.png' });

const open = p.locator('[data-act="open-system-editor"]').first();
if ((await open.count()) === 0) {
  console.log('✗ 没有「细化星系结构」按钮');
  process.exit(0);
}
await open.click();
await p.waitForFunction(() => !!document.querySelector('[data-act="system-editor"]'), null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(1200);
await p.screenshot({ path: 'out/s2-system-editor.png' });
console.log('editor', 'out/s2-system-editor.png');

// 改一颗行星的轨道半长轴(第一行第一个数字框)
const first = p.locator('[data-planet="0"] input[type="number"]').first();
if ((await first.count()) > 0) {
  await first.fill('0.85');
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'out/s2-system-changed.png' });
  console.log('changed', 'out/s2-system-changed.png');
}
// 小行星带调成「频繁」
const belt = p.locator('[data-act="impact-2"]').first();
if ((await belt.count()) > 0) {
  await belt.click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: 'out/s2-system-belts.png' });
  console.log('belts', 'out/s2-system-belts.png');
}
// 卫星页
const moonTab = p.locator('[data-act="system-tab-moons"]').first();
if ((await moonTab.count()) > 0) {
  await moonTab.click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'out/s2-system-moons.png' });
  console.log('moons', 'out/s2-system-moons.png');
}
if (logs.length) console.log(logs.slice(0, 6).join('\n'));
await b.close();
