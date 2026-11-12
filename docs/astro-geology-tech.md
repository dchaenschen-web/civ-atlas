# 天文、地质、技术路线:架构与实现状态

> 这份文档跟着实现一起更新。当前：P0（设计层）→ P1（星球系生成）→ P2（气候耦合）已完成并通过类型检查；
> P3（天象与历史关联）、P4a（地质派生数据）、技术路线数据层已落地，运行时验证因权限受限暂缓（见第 6 节）。

## 0. 分层

```
WorldParams（种子 + 设计参数）
   │
   ├─ gen/astroDesign.ts   设计层：恒星、行星、卫星、大气成分、磁场、星表（纯计算，无名字库）
   ├─ gen/astro.ts         天象层：轨道周期、相位；World.astro 挂载；astroOf() 懒重算；气候修正 climateModsOf()
   ├─ gen/astroNames.ts    名字：恒星/行星/卫星/邻近恒星（12 语感，单独一个模块，避免主线程带词库）
   ├─ gen/astroWorlds.ts   其他固态行星的地表（同一套生成管线，按地质活跃度分配精度，总预算 36k 地块）
   ├─ gen/geology.ts       地质：地震带 / 火山带 / 地热（从板块边界派生，懒算，不进世界文件）
   ├─ gen/techPack.ts      技术路线：现实 / 魔法 / 修真 三套时代链（数据层）
   ├─ gen/civ/omen.ts      天象纪：日食、彗星、流星雨、行星会合、客星 → 与史事挂钩、按时代分"古典 / 历法既明"
   └─ gen/civ/geoEvents.ts 推演模块：自发地震 / 火山（默认不装；开了星球系或改了地质活跃度才装）
```

**界面入口（第 3 轮加的）**

- **世界概览 →「星球系」页签**（`WorldOverview.tsx` 的 `system` tab）与工作室侧栏「星球系」页（`src/ui/SystemPage.tsx`）：
  恒星、主行星大气成分条与天空色、各行星与卫星、方阵星图、天象纪、地质概况、技术路线；
  **其他固态行星可以点「生成地表」**，按地质活跃度分配到的精度（活跃 9000 / 死星 4000 / 气态 0 / 主行星全精度）
  现场生成，并显示陆地比例、均温、河流、最高海拔、火山数与主要生物群落；设定集导出也会带上这些概况。
- 新建世界弹窗多一组「星球系」滑条：星球系开关、恒星类型、自转倾角、地质活跃度、技术路线。
- **新世界默认 `astro = 1`**（老世界、老链接不带这些参数，照旧是地球基线）。

**两条铁律**：

1. `WorldParams.astro = 0`（默认）、`geo = 1`（默认）、`tech = 0`（默认）时，行为与加这一层之前**逐字节相同**
   —— 新参数全部进 `LATER_KEYS`，默认值不写进世界身份，老链接老存档不受影响。
2. **派生数据不进世界文件**：`World.astro` 只挂在内存里的 World 上，`worldFile.ts` 打包时剥掉，读回来用
   `astroOf(world)` 按 params 重算。不改格式、不加校验、不增体积。

## 1. 大气成分模型（已实现）

`composeAtmosphere()`：库存 → 逃逸筛选 → 归一化 → 派生量。

| 步骤 | 做法 |
| --- | --- |
| 库存 | N₂ ∝ 质量²、CO₂ ∝ 质量 × 地质活跃度、H₂O ∝ 质量 × 水圈、Ar/SO₂/CH₄ 按地质量与生物圈调整 |
| 逃逸 | 逃逸速度 `11.2·√(M/R)`；每种气体算逃逸温度 `M·v²·6.014e-5`，`T` 超过它的 18% 就按比例剥掉 |
| 水额外丢失 | 近恒星、小引力、弱磁场、强星风 → 光解与被吹走 |
| 海洋世界 | 大气水汽受**饱和水汽压**限制；CO₂ 被海洋 + 碳酸盐收走（乘 0.002，地球 400 ppm 量级） |
| 生物圈 | 有水、温度 245–335 K、地质给养分 → 产氧 12–30%，同时压低甲烷 |
| 温室 | `3 + 10√(pCO₂/400ppm) + 16√(pH₂O/1%) + min(4, 8√(pCH₄/100ppm))`，地球基线约 33 K |
| 温度 | 平衡温度 ↔ 大气 3 次不动点迭代；不用 `Math.pow`，四分之一次方拆成两次 `sqrt`（IEEE 精确） |
| 派生 | 气压、天空颜色、可呼吸性、磁暴频率、磁极纬度、潮差 |

气态行星单独一套：H₂ 88% / He 10% / CH₄ 1.5% / NH₃ 0.5%，只参与轨道、天象、磁场，不做地表。

## 2. 天象与历史的关联（已实现雏形，`gen/civ/omen.ts`）

**周期全部从星球系派生**，不写死：

| 天象 | 周期从哪来 |
| --- | --- |
| 日食 | 有卫星才明显；沙罗周期 18.03 年 × 种子扰动，只记约 1/3（落在有人住的地方才被记下） |
| 磁暴与极光 | 基础 60 年 ÷ 磁暴倍数（`home.storms` = 星风强度 ÷ 磁场强度）：磁场弱、红矮星耀斑多的世界更频繁 |
| 彗星 | 60–220 年 × 恒星类型系数（红矮星 / 双星系更频繁） |
| 流星雨 | 20–60 年一轮，只记大的 |
| 行星会合 | 两颗外行星的**会合周期** `1/|1/P₁ − 1/P₂|`（开普勒派生） |
| 客星 | 150–400 年一次，红矮星系 ×1.6 |

**关联规则**：每条天象在前后 ±3 年内找最重要的一条史事（重要度 3）挂上去；日食、流星雨这类常见天象**只在挂上大事时才记**，否则编年史会被撑满。

**古典 / 历法既明**（这是"古典时代未充分了解天象原因"的落地方式）：
- 判定：该年天下最高的时代 < 火药（时代序号 4）→ 古典。
- 古典写法：`日有食之，昼晦，……，会〈某国大败〉`、`有星孛于东，占者以为除旧布新之象`、`二星会于南，占曰大吉`；凶兆重要度 3。
- 火药以后：`日食，历官预推得之，不以为异`，重要度降到 1；会合仍记（2）。

**天象纪的出口**：星球系页里能看到全部；导出「编年史（Markdown / 纯文本）」时自动接在正文后面（`ExportMenu.tsx` 调 `omenDocument`）。

**下一步（要改历史时再做）**：把天象接成"规则包"里的概率修正（日食 → 政变/改元/民变概率），而不是直接改历史。
默认关闭，打开后要涨 `GENERATOR_VERSION`。

**潮汐进文明（已接一半）**：`habitat.ts` 的海岸宜居分加了一项潮差加成
（`(tide − 1) × 3`，夹在 −2…+6；地球基线 0，没有星球系的世界不加）——大潮差的海岸渔业与造船更好，
几乎无潮的星海岸差一点。这一项影响人口上限、城镇与州，所以是"天文 → 地理 → 文明"的实链条。

## 3. 地质（已实现派生数据，事件层待接）

`geologyOf(world)`：从 `tect.convergence / distConv / strengthConv` + 板块 + 热点派生每个地块的
地震强度、火山强度、地热，并按 `WorldParams.geo` 整体缩放。

- 汇聚带（俯冲、陆陆碰撞）：地震最强；俯冲带上火山弧；海沟极深处没有火山。
- 离散带（洋中脊、裂谷）：中等地震、少量火山。
- 热点：约 0.25% 的地块上撒孤立火山；带外按种子撒零散小震，避免"带外死寂"。
- 火山名单最多 160 座，彼此按地块间距去重；极高山（>3000 m）冰盖下作用减弱。
- 懒算 + `WeakMap` 缓存，不进 World、不进世界文件。

**事件层（P4b，已接入推演）**：`src/gen/civ/geoEvents.ts` 是一个推演模块（`CIV_MODULES` 末尾），用自己的
`Ev.GeoCheck` 事件，每 25 年看一次：

- **地点**：每国在国土里挑"地震 × 0.7 + 火山 × 0.3"最高的州当震中（再乘一个 keyed 随机权重），
  所以自发地震、火山**必然落在板块边界带附近**，不是均匀随机。
- **频率**：`每国每次 0.22 × 地质活跃度`；`geo` 拉到 3 就密三倍。
- **效果**：复用 `quakeRing` + `afflict`（城里人口损失、国内更动荡、编年史一条 famine）。
  **编年史文案**：震中在火山带且烈度 ≥ 2 记 `cause = 'volcano'` → "某州火山崩发，城郭尽焚，死者十之二"；
  其余照旧按震中的地貌与河流写"地震 / 大水 / 大旱"。
- **开关**：只有 `params.astro = 1` 或 `params.geo ≠ 1` 的世界才装这个模块——默认参数的世界历史逐字节不变。
- **极端档（已做，可选）**：`params.geo ≥ 2.4`（暴烈）时，火山带上烈度 3 的事件会把城整座毁掉——
  照 `upheaval.ts` 的写法记一条 `sunk`（b = 0 → 编年史写"毁于火山"）+ `scheduleRebuild`（过些年可能重建）。
  默认参数（geo = 1）永远走不到这一档；**地形本身不改**（地形重生成仍留给以后的地形大事，代价是重生成整颗星球）。
- **确定性**：星图的三角函数也过 `round24`，同一个世界在任何 CPU 上星图逐位一致。

## 4. 科技 / 科学模拟怎么优化（回答"可以怎么优化"）

现在的科技是"一条线性时代条 + 物产位掩码"，优点是稳、性能好；短板是**知识不扩散、观测不产生理论、落后不会追赶**。建议按投入产出排队：

1. **知识扩散有向图**（低风险）：科技从城市沿已有 `routes`（商道、航路）扩散，陆路慢、海路快；用现成的道路与航线数据，不改推演骨架。
2. **观测 → 理论 → 应用三段**（低风险，和天文直接联动）：天象观测累积 → 历法精度 → 航海/农时加成；误判（彗星当灾异）拖慢历法改革。这条把 P3 的天象变成"科技资源"。
3. **门槛三元组**（中风险）：时代门槛 = 物产 + 组织能力 + **知识存量**（现有二元组加一项），让"有铁没制度"的文明卡住。
4. **科学革命作为概率事件**（中风险）：连续误判 + 观测异常累积 → 范式转换，时代跳跃可提前或延后；用 `keyed` 保证确定性。
5. **技术-军事-财政反馈**：火药 → 攻城方式变化（已有战争机制可挂）；印刷 → 思潮扩散加速（`ideology.ts` 已有）。
6. **追赶机制**：技术差距大时扩散加快、仿制成本低，避免小国永久落后（现实里技术会收敛）。
7. **失传机制**：战乱、瘟疫、毁城按比例丢高阶知识（图书馆、匠人），和已有城市兴衰挂钩。

落地顺序建议：1 → 2 → 6（都用现成的 routes/trade/ideology，不动推演核心），再动 3 → 4 → 5 → 7（要改 `development.ts` 的门槛表，必须配 `GENERATOR_VERSION` 涨版）。

## 5. 非现实技术路线：魔法 / 修真（数据层已实现）

`WorldParams.tech` + `gen/techPack.ts`：

| id | 路线 | 时代链（9 档） | 关键门槛 |
| --- | --- | --- | --- |
| 0 | 现实 | 石器 → 未来 | 铜锡、铁、煤、石油、稀有矿 |
| 1 | 魔法 | 蒙昧 → 神话 | 灵木星铁、符纸晶石、魔核、秘银、以太、星髓 |
| 2 | 修真 | 凡俗 → 大乘 | 灵脉、筑基丹、金液、魂玉、天地灵气 |

**核心判断：魔法 / 修真不是换引擎，是换"资源位 + 门槛 + 政体"**，这样才不破坏已有的确定性、存档和 3000 年推演。

- 新增 2–3 个资源位（`magic` 灵材、`marrow` 星髓/魂玉），由地质与天文派生：
  灵脉 = 地质活跃带（`geologyOf` 的高地热区），星髓 = 陨击带 / 潮汐锁定区。
- 时代门槛表按包给一张；`ERAS` 常量改成 `eraNamesOf(techPackOf(params))`；文案（编年史、时代图层、钱粮）跟着包走。
- 力量上限与代价：文明有"灵脉密度" → 修行者数量上限；个体强者要能改历史，就得进政体
  （在 `polities` 的政体种类里加"宗门"），否则只是数值加成。
- 分期：3a 资源位与时代名（低风险）→ 3b 宗门政体与个体强者（中）→ 3c 让玩家写规则包（高，和路线图里"推演做成可换的规则"合流）。

## 6. 怎么验证(不需要浏览器、不需要放宽权限)

```bat
scripts\verify-node.bat
```

原理:`tsc -p tsconfig.node.json` 把 `src/gen/**` 和 `scripts/node-verify.ts` 编成 CommonJS(输出在 `out/jsbuild/`,
旁边放一份 `{"type":"commonjs"}`),再用 `node` 跑。这样绕开了 esbuild / vite / 无头浏览器,在当前沙盒里也能跑真实世界生成。

检查项:

1. 默认世界两次生成逐位一致(确定性);
2. **和上游金标逐字段对账**:`tests/determinism.test.ts` 里的 EXPECTED(3 个种子 × 47 个字段:地形、气候、文明全部数据)
   —— 对账时去掉这一版新加的参数键和 `climate.mods`(它们只是派生字段),其余必须逐字段一致,
   证明 **默认参数的世界和上游逐字节一样**;
3. 开了星球系:恒星/行星/卫星名字、大气成分、潮差、地质火山与地震带、天象纪都能跑出结果;
4. 地质事件:常态档(`geo=1.6`)有地质原因的灾荒、不毁城;极端档(`geo=2.6`)出现"城毁于火山";
5. 默认世界不装地质事件模块、没有天象。

最近一次运行结果:`out/verify-r5.txt`(17 项全过)。

## 7. 验证状态

| 项 | 状态 |
| --- | --- |
| `tsc --noEmit` | ✅ 0 错误（全部改动后） |
| `vite build`（生产构建） | ✅ 成功：1006 模块、dist 1220 个文件；本机需把 `TMP` 指向项目外（esbuild 在系统 Temp 删临时文件被拒，与代码无关） |
| 顺带修的跨平台 bug | `scripts/lib/readerCopy.ts` 在 Windows 上用 `path.relative` 生成 import 说明符会写成反斜杠（无效 import）→ 一律改成正斜杠 |
| 首屏体积预算（`scripts/first-load.ts`） | ✅ 277.3 KB / 上限 280 KB |
| 单测（全量 302 个文件 / 4578 条，并行） | ✅ **4565 通过、3 跳过**；并行满载下 8 条"耗时/时序"类断言误报，串行重跑那 3 个文件 **118/118 全过**（`out/vitest-retry2.log`）；新增 `tests/astro-arch.test.ts` 7 项在并集中也全过 |
| 相关单测（13 个文件：determinism、world-file、savefile、astro-*、preset-link…） | ✅ 374 / 374 通过 |
| 界面截图 | ✅ `out/r11-*.png`（星球系 / 天象纪）、`out/p2-planet-*.png`（行星地形与图层）、`out/p3-diagram-*.png`（星系示意图）、`out/p4-menu-2.png` `p4-tech.png`（菜单/技术路线）、`out/p5-binary*.png` `p5-habitable-moon.png`（三种构型） |
| 构型单测 `tests/astro-arch.test.ts` | ✅ 7 项：arch 0–3 的结构不变量、life=2 不可呼吸、home/salt 生效、两次生成一致、默认设计不动 |
| 重建后的生产构建 + 首屏 | ✅ 构建成功；首屏 277.8 KB / 上限 280 KB |
| `scripts\verify-node.bat`（tsc→CommonJS→node，17 项） | ✅ **全部通过**：默认世界与上游金标 3 种子 × 47 字段逐字段一致；星球系/大气/潮汐/地质/天象/地质事件均有结果；极端档出现城毁于火山 |
| 集成测试 `tests/astro-geo-systems.test.ts` | 📝 已写：默认世界不受影响、天文/地质/天象/技术路线的确定性与历史接入 —— 待权限后跑 |
| 指纹对账（21 组种子 × 参数，默认参数） | ✅ 全部一致（P0 + P1 阶段；证明默认世界逐字节没变） |
| 新单测（astro-design 17 条、astro-system、preset-link 19 条） | ✅ 早前跑过通过；P1 之后的 `tests/astro-system.test.ts` 与 determinism 金标**待重跑** |
| `tests/determinism.test.ts` 金标 | ✅ 已修：对账时去掉新参数键与 `climate.mods`，金标不用重出（地形/气候/文明数据一个都没变，已被 node 验证证实） |
| dev server / 截图 | ⏳ 待重启验证（Vite 需要子进程，受沙盒限制） |

需要放宽沙盒才能跑的验证：`vitest`（esbuild 子进程）、`tsx` 脚本、无头浏览器截图、重启 dev server。
这些按要求先放着，等权限再跑。
## 9. P1–P4 进度（用户确认后的第二轮）

- **P1 主行星可呼吸**：新增参数 `life`（0 自动 / 1 有生物圈 / 2 无生命）、`home`（主行星取第几颗）、`salt`（整系重掷）、`arch`（构型，P5 用）。
  新世界默认 `life=1`：氧按氮池攒、气压自动调回 0.3–4 atm，**抽样 20 个新世界 20/20 可呼吸**；
  不可呼吸时页面写清原因（`不可呼吸(没有氧气(没有生物圈))` 等）。旧世界 `life=0` 走原自动逻辑，默认世界与上游金标仍逐字段一致。
- **P4 菜单与页签**：新建世界第 2 步的参数分组改成 **「星系结构」（星球系、星系构型、恒星类型、固态/气态行星数、主行星卫星数）→「行星与生命」（生命、主行星、倾角、自转、地质、磁场、整系重掷）→「技术路线」**，顺序就是先骨架再细化；
  「技术路线」从星球系页搬出，成为世界概览的独立页签（`src/ui/TechPage.tsx`）。
- 验证截图：`out/p4-menu-2.png`（新分组）、`out/p4-tech.png`（技术路线页签）、`out/p4-system.png`（可呼吸 + 氧 21%）。
- 下一步：P2 其他固态行星地形可视化（worker 缩略图 + 图层）、P3 星系示意图、P5 三种构型的物理与天象。
## 10. P2 行星地形可视化（第 2 轮）

- 新文件：`src/render/planetViz.ts`（生成 + 上色，纯函数）、`src/render/planetViz.worker.ts`（后台线程）、`SystemPage` 的 `PlanetCanvas` 组件。
- 点「生成地表」后：按预算精度生成（同一套 `planetSurface` 管线）→ `rasterize` 成缩略图（上限 15 万像素）→ 主线程只收一张 RGBA 贴 canvas。
- **四个图层**：地形（手绘着色）/ 生物群系（`BIOMES.real` 配色）/ 温度（-40→45°C 色带）/ 降水（0→3000 mm 色带），下面照旧列陆地比例、均温、河流、最高海拔、火山与主要群落。
- worker 里按"行星参数键"缓存地表（最多 6 颗），切图层不重新生成；同参数结果确定。
- 截图：`out/p2-planet-terrain.png`（地形 + 图层按钮）、`out/p2-planet-biome.png`（生物群系）。
## 11. P3 星系示意图（第 3 轮）

- 新文件 `src/ui/SystemDiagram.tsx`：canvas 画恒星、轨道、**宜居带色带**、行星（大小按半径、颜色按种类/温度，气态行星米黄）、主行星高亮圈、卫星（选中/主行星才画）。
- 横轴默认**对数**（近轨道不被挤成一团），可切**线性**；可藏/显示卫星；点行星可选中，标题栏显示「选中:名字 · 种类 · 轨道 · 温度」。
- 数据全部来自 `AstroDesign`（design 层），不随机；单星构型已画对，双星/双行星/巨行星卫星的嵌套轨道在 P5 接上构型后按多恒星与嵌套结构画。
- 截图：`out/p3-diagram-log.png`（黄矮星、6 颗行星 + 2 气态行星、宜居带环、主行星高亮）、`out/p3-diagram-linear.png`（线性轴）。
## 12. P5·双固态行星（第 4 轮，arch = 1）

- 设计层：`AstroDesign.arch` + `binary?: { index, separationAU, periodDays }`；`arch = 1` 时强制至少两颗岩质行星，
  伴星与主行星同轨道（间距 0.002–0.012 AU，即 47–282 R⊕），互绕周期按开普勒 `P = sqrt(d³·M☉/M总)` 算（几十到一两百天）。
- 物理：伴星给主行星加潮汐（`mass / (23481·d)³` 折算回"地球 = 1"），潮差实测 4.36（地球基线 1）；
  伴星自己也是完整岩质行星（有大气、可出地表缩略图、图上画成一对并用虚线连着）。
- 天象：双固态行星每 6–16 次记录里写「两星相掩，昼晦」；它不算"常见天象"，不依赖挂大事也会记进编年史。
- 验证（`out/verify-p5a.txt`，**45 项全过**）：伴星生成、同轨道、潮汐 > 0.2、"两星相掩"天象出现、主行星可呼吸、
  两次生成逐字段一致、关星球系时 arch 不参与生成（默认世界仍与上游金标一致）。
## 13. P5·双恒星（第 5 轮，arch = 2）

- 设计层：`AstroDesign.binaryStar?: { sepAU, periodDays, lumRatio, companion }`。
  主星 + 一颗 0.25–0.75 倍质量的伴星；两星间距取 0.05–0.12 倍宜居带半径，互绕周期按开普勒算（实测 0.076 AU / 6.9 天 / 伴星占 11% 光度）。
- 等效星：对外合成一颗 `id: 'bin'` 的星（光度 = 两星之和、质量 = 两星之和、星风取大），气候、宜居带、大气、潮汐都按等效星算——行星绕的是质心，辐照就是两星之和。
- 稳定轨道：行星最小轨道半径 0.377 AU ＞ 2.5 × 双星间距（0.190 AU），符合"行星必须远于 2.5 倍双星间距"的稳定性要求。
- 天象：双恒星每 5–13 次记录写「两星互食，天有二日，昼晦复明」；不算常见天象，不依赖挂大事。
- 界面：恒星卡显示「双星」标签、光度/质量保留两位、伴星间距与互绕周期；示意图中心画两颗星 + 互绕虚线圈 + 「伴星」标注。
- 验证（`out/verify-p5b.txt`，**51 项全过**）：双恒星成立、轨道在稳定距离外、两星互食出现、主行星可呼吸、两次生成一致，且默认世界金标仍逐字段一致。
- 截图：`out/p5-binary-star.png`（双星「提博里亚」、主行星「浮雪原」可呼吸、伴星与互绕圈）。
## 14. P5·气态巨星的宜居卫星（第 6 轮，arch = 3）

- 设计层：`AstroDesign.habitableMoon?: { parent, index, sepR, periodDays, tidalHeatK }`。
  `arch = 3` 时强制至少一颗气态行星；第一颗气态行星挪进宜居带（热木星型，与卫星同一日照距离），
  主行星改成绕母行星转的类地大卫星（距离 30–80 个母行星半径，公转周期几十天）。
- 物理：
  - **潮汐锁定**：自转 = 绕母行星的公转周期（受参数范围限制，显示上限 200 小时）；
  - **潮汐加热**：由母行星质量与卫星距离派生（+2–14 K），直接加进 `modelRocky` 的温度不动点（新增 `extraK`）；
  - **母行星潮汐**：`母星质量 / 距离³` 折算回地球基线（实测潮差 85.7，比任何卫星都强——这就是"卫星世界的海"）；
  - 大星当空 / 大星掩日：每 6–15 次记录写「大星掩日，昼晦如夜，占者以为天狗食日」。
- 验证（`out/verify-p5c.txt`，**59 项全过**）：母行星是气态、母星与卫星同日照距离、潮汐锁定、强潮汐、
  潮汐加热抬高均温（19.4°C）、大星掩日天象、可呼吸、两次生成一致；默认世界金标不变。
- 截图：`out/p5-habitable-moon.png`（红矮星「贝利纳维亚」、卫星「莫日根达拉」潮差 85.7、可呼吸、母星在图上画成大的米黄圆）。
- 简化（明说）：母行星的**辐射带剂量**还没有做进大气/生命概率；潮汐锁定后的昼夜温差、以及卫星看母星的视直径也还没影响气候。
## 15. S1 数据层：多天体星系（第 1 步）

- 新文件 `src/gen/system.ts`：
  - `SolarSystem { params, design, overrides, effective, belts, world }` + `systemOf(world)`（`astro = 0` 返回 null）
  - 覆盖表 `PlanetOverride` / `MoonOverride`（轨道 a/e/i/Ω、半径、倾角、自转、生命、reroll、地形 op 透传）；`applyOverrides()` 纯函数，空覆盖 = 原样
  - 小行星带 `beltsOf(design, seed, impact)`：`impact = 0` 一条不带；≥1 时按种子在冻线附近长 1–2 条
  - 陨击率 `impactRateOf(design, belts, planetIndex)`：穿带 ×(2.5+3×密度)、内侧有巨行星 ÷2.5、大卫星 ÷(1+0.4n)、气压 <0.3 ×1.6
  - 卫星地表：`moonWorldParams`（大卫星 4000 / 小卫星 2000 地块、干、`astro = 0` 不递归）、`moonSurface` 缓存、`planMoonSurfaces`
- 设计层：`PlanetDesign` 新增 `incDeg`（0–8°）与 `nodeDeg`（0–360°），偏心率原本就有；全部按种子派生
- 新参数 `impact`（0 关 / 1 自然 / 2 频繁，默认 0）：进 `LATER_KEYS`、范围表、参数名、新建世界「星系结构」组与滑条
- 验证（`out/verify-s1.txt`，**68 项全过**）：星系聚合、默认无带、impact=1 出带（2.75–3.63 AU）、穿带行星陨击率 ×8.23、
  巨行星清扫、覆盖表生效、空覆盖原样、轨道参数范围、卫星地表参数确定（2000 地块）
- 单测 `tests/system.test.ts` 8 项通过；预设链接金标 376 → 385（多了一个参数）
- 还没做（下一步）：`parts/system.gz` 存档块、UI 两步、3D、多行星文明
### S1 收尾：星系块进存档（parts/system.gz）

- `worldFormat.ts`：`KNOWN_PARTS` 注册 `system`（可选块，`need: 'view'`）；`SystemContent { overrides, belts?, impactSettlement? }`（type-only 引 `gen/system`，运行时不成环）
- `worldFile.ts`：`WorldValues.system` / `PackInput` / `WorldContent.system`；打包时有才写、读取时**没有 = null**（可选块不能当坏文件）、另存可整块去掉
- `worldValidate.ts`：`validateSystem` 卡类型与上限（覆盖表 ≤64 行星 / ≤256 卫星、带 ≤4 条、range 合理）
- 测试 `tests/system-block.test.ts` 4 项：打包→读回一位不差、默认世界读回 null、另存去掉这一块、空覆盖表也能读
- 回归：world-file / world-validate / system-block 共 **417 项全过**；node-verify 68 项全过（默认世界金标不变）
- 结论：**S1 数据层完成**。下一步 S2：新建世界两步 UI（星系结构表 → 每颗行星/卫星卡片 + 地形编辑接入）
### S2-a 覆盖表进生成流程（第 2 步）

- 类型搬进设计层 `astroDesign.ts`（避免 `astro` ↔ `system` 运行时成环）：`PlanetOverride` / `MoonOverride` / `SystemOverrides`，`system.ts` 改为 re-export
- `rebuildDesign(design, overrides, params)`：套覆盖表并**重算受影响的量**——轨道/半径/生命变了就重跑 `modelRocky`（大气、温度不动点）、改 home 选谁、卫星的距离/半径/锁定
- 偏心率真正进物理：`modelRocky` 的平均辐照按 `1/√(1−e²)` 折算（e = 0 时逐位不变）
- `generateAstro(params, overrides?)`、`generateWorld(..., system?)`、`World.system`；`astroOf()` 对读回来的世界按 `world.system` 重算星球系
- 世界文件：`mapValue` 不重复存 `system`（覆盖表在 `parts/system.gz`），读取时挂回 `map.system`
- 验证：node-verify **72 项全过**（新增"生成时套用覆盖表、生命生效、两次一致、默认不挂 system"）；`system-block/system/determinism/world-file` 共 **117 项全过**
- 还没做（S2-b）：新建世界两步 UI、worker/草稿把覆盖表传下去、SaveFile 里存覆盖表（浏览器存档）
### S2-b 覆盖表进后台线程（第 3 步）

- `worker.ts`：`CivInput.system`（所有推文明请求都可带）；当前世界的覆盖表记在 `systemNow`，只由 `generate`（新生成）和读回冻结世界（`load`）改写
- 缓存键 `kOf()` = 原来的 `keyOf()` + `|sys:<覆盖表 JSON>`：**同参数、不同覆盖表 = 两个世界**，不会串缓存
- 三条同步生成路径与一条异步生成路径（`generateUnlessSuperseded`）都把 `systemNow` 传进 `generateWorld`
- 验证：`determinism` / `world-file` / `system-block` 共 **109 项全过**；`tsc` 0 错误；node-verify 72 项全过
- 还没做（S2-c）：`SaveFile` 里带覆盖表（浏览器存档/读回）、主线程把 `system` 从世界/草稿传下来、新建两步 UI
### S2-c 覆盖表进存档（第 4 步）

- `SaveFile.system?: SystemOverrides`：浏览器存档/整包导出都带着逐行星/卫星覆盖表；**没有覆盖表时不写这个字段**（默认世界存档逐字节不变）
- `makeSave(..., system?)` 走 `cleanSystem()` 归一化：轨道/半径/倾角/自转/生命/卫星距离都在合理范围，越界丢、只认数字与布尔；最多 64 行星 / 64 卫星 / 3000 条地形修改
- `parseSave()`：读得懂就挂上；读不懂 → 提示「星系结构读不懂，按种子重建」，不挡打开
- 测试：`tests/savefile.test.ts` 追加 3 项（往返一位不差、没有覆盖表不写字段、坏值被丢/不挡打开），savefile + system-block + world-file 共 **211 项全过**
- 还没做（S2-d）：主线程把覆盖表从世界/草稿传进生成请求，然后才是两步 UI
### 事故记录：savefile.ts 被误截断（已恢复）

- 处理"删掉一个没用到的 copySystem"时用 `Substring` 截尾，错误地截掉了 `cleanTitle` 之后的 700 多行 → `makeSave`/`parseSave` 全丢
- 恢复办法：从原始 `civ-atlas-main.zip` 里取出上游 `src/gen/savefile.ts`（1361 行），再逐项重放本会话的改动：类型 import、`SaveFile.system`、15 个新参数的 `PARAM_RANGE`/`PARAM_NAME`/`LATER_KEYS`、`makeSave` 第 8 个参数、`parseSave` 读星系结构、`cleanSystem`
- 验证：`savefile`/`determinism`/`system-block`/`world-file`/`share-moment` 共 **226 项全过**；node-verify 72 项全过 → 行为与截断前一致
- 教训：以后删无用代码用 edit 工具锚定删除，不用 `Substring` 截尾
### S2-d 主线程把覆盖表带进所有请求（第 5 步）

- 新文件 `src/gen/systemState.ts`：`currentSystem()` / `setCurrentSystem()` / `systemOpt()`；空表 = 单行星世界，`systemOpt()` 返回 `{}`（请求里连字段都不出现）
- `savefile.ts` 的 `makeSave` / `parseSave` 在清理完覆盖表后**统一发布**一次：读哪个世界、存哪个世界，当前覆盖表就跟着换；读没有覆盖表的旧档自动复位
- 九处请求都带上了 `...systemOpt()`：`useWorldLoad`（生成）、`useEditRecompute`（生成/补推/重推）、`useSimRunners`（再推/大纲）、`directorPlan`（大纲）、`App`（回放帧）、`compare/drawMap`（对照图生成）
- 这样改地形重生成、重推文明、再推 N 年都不会把多行星世界悄悄变回单行星
- 测试：`tests/system-state.test.ts` 3 项 + `savefile`/`determinism`/`system-block`/`world-file` 共 **217 项全过**；node-verify 72 项全过
- 下一步（S2-e）：新建世界两步 UI（星系结构表 → 行星/卫星卡片与地形编辑）
### S2-e 星系结构编辑器（第 6 步，新建世界第 2 步）

- 新文件 `src/ui/SystemEditor.tsx`（**按需加载**，构建产物 `SystemEditor-*.js` 仅 8.31 KB / gzip 3.86 KB；首页体积 278.9 / 280 KB）
- 新建世界第 2 步多一组「星系结构 → 细化星系结构…」，点开弹层：
  - **行星表**：每颗行星的轨道 `a / e / i / Ω` 可改（改完立刻重算均温、可呼吸）、半径/均温只读、主行星可切换
  - **卫星表**：离母星距离、半径、潮汐锁定可改
  - **小行星带**：关 / 自然 / 频繁（写 `impact` 参数，显示带范围与主行星陨击率倍率）
  - 「恢复默认」清空覆盖表；「重掷整系」换一套种子派生（`salt`）
- 新建流程：弹层里的覆盖表存在弹窗状态里，「开始」时 `setCurrentSystem(覆盖表)` 发布；生成请求经 S2-d 的 `systemOpt()` 带进后台线程；存档经 `makeSave(..., currentSystem())` 落盘（`saveStore` 六处 + 插件 `edit.ts` 一处）
- 验证：
  - 截图 `out/s2-system-editor.png`（行星表）、`out/s2-edited.png`（改 a=0.85 + 小行星带自然）、`out/s2-system-moons.png`、`out/s2-system-belts.png`、`out/s2-dialog-step2.png`
  - 端到端（playwright，真点）：新建世界 → 打开编辑器 → 改轨道 → 开始 → 世界生成完成（约 10 秒）
  - `tsc` 0；`savefile/system-state/system-block/determinism` 共 **115 项全过**；node-verify 72 项全过；构建成功、首屏 278.9/280 KB
- 事故记录：`return (` 锚点匹配到了文件里另一个组件的 return，`sysDlg` 插错位置，已定位挪到位（构建与截图验证）
- 还没做（S2-f）：第二步的「每颗行星卡片 + 地形编辑接原版 Studio」；浏览器刷新后覆盖表是否还在（只有单测覆盖，未做浏览器重载验证）
### S2-f 行星卡片与刷新持久化验证（第 7 步）

- 编辑器里加了**每颗行星一张卡片**：名字/种类/主行星标记、轨道 a·e·i、温度、半径、可呼吸、卫星数；点卡片高亮对应表格行（卡片区域的样式与点击都走 `data-card`）
- 浏览器持久化验证（playwright，真流程）：新建世界 → 编辑器改轨道 `a=0.85` → 开始 → 世界生成 → 「保存地图」→ **刷新页面** → 打开那张地图 →「打造文明」，期间反复读 localStorage：`wenming-ditu:world:*` 里的存档**始终带着 `system` 覆盖表与 0.85**
- 构建：`SystemEditor-*.js` 9.57 KB（gzip 4.18）；首屏 278.9 / 280 KB
- `tsc` 0；node-verify 72 项全过
- 明确未做：**逐行星的"进入原版地形编辑"**——它需要"一颗行星一个 World + 独立存档块"，属于 S4；现在主行星的地形编辑仍在 Studio 里，其他行星只有参数与（星球系页的）地表缩略图
### S3 3D 星系图（第 8 步）

- 新文件 `src/render/systemGlobe3d.ts`：三维椭圆的解析位置（半长轴/偏心率/黄道角/升交点）、星空（用设计层的 `design.stars` 单位向量摆到半径 70 的球面）、小行星带粒子（按带种子确定性打散）、4×4 矩阵（透视 / lookAt / 投影），以及一份**自写 WebGL2 渲染器**（点/线两个 program）。
- 新组件 `src/ui/SystemGlobe.tsx`：透视相机（拖拽旋转 / 滚轮缩放 / 双击回正 / 点行星选中），星空、轨道、宜居带、小行星带、恒星辉光、行星与名字逐帧投影到 canvas；「2D」按钮切回原示意图。
- 本轮先用 **CPU 逐帧投影**落地（形状/交互/标签都对，且天然不需要 WebGL2）；WebGL2 渲染器已写好留在 `systemGlobe3d.ts`，下一步接上（当前 GL 路径的轨道线缓冲有 bug，暂未启用）。
- 截图：`out/s3-globe-3d.png`（星空 + 倾斜轨道 + 宜居带 + 小行星带 + 行星标签）、`out/s3-globe-rotated.png`（拖拽旋转+缩放后）、`out/s3-globe-2d.png`（2D 切换）
- 验证：`tsc` 0；构建成功、首屏 278.9/280 KB；node-verify 72 项全过
- 诚实说明：**WebGL2 GPU 路径还没启用**（CPU 路径已可用）；下一步要么修 GL 缓冲，要么把 GL 作为加速路径可选开启。
### S3 收尾状态（第 9 步，诚实说明）

- **已可用**：CPU 逐帧投影的 3D 星系图（星空背景来自设计层星图、倾斜轨道、宜居带、小行星带、拖拽旋转/滚轮缩放/双击回正/点选行星、2D 切换），截图 `out/s3-globe-3d.png`、`out/s3-globe-rotated.png`、`out/s3-globe-2d.png`
- **WebGL2 路径未启用**：渲染器 `render/systemGlobe3d.ts` 已写好（点/线两个 program、矩阵、场景打包），但两次修正后仍有问题（先是点颜色/大小属性偏移读错，导致巨大色块；修掉后星点/轨道几乎不显示），按"同一问题试两次就停"的约定暂时不启用，`SystemGlobe` 里留了一行注释说明怎么切换
- 验证：`tsc` 0；构建成功、首屏 278.9/280 KB；node-verify 72 项全过
- 建议：GL 调试不再是阻塞项（CPU 版功能完整），下一轮转 S4（多行星详情 + 按需文明推演），GL 作为"以后有空再修的加速路径"
### S4 多天体详情 + 按需文明（第 11 步）

- 新文件 `src/gen/bodies.ts`：`bodyFacts()`（每颗行星的"有生命迹象"判定：生物圈或可呼吸）、`bodyWorld()`（复用 `planetSurface` 缓存）、`bodyCiv(sys, index, base, endYear)`（按需推文明，WeakMap 缓存，同一星系同一天体只推一次）
- 星球系页：每颗岩石行星多一个「详情」按钮 → 详情面板显示轨道四参数、气压/可呼吸、地形缩略图与群落占比，以及
  **「推演这颗行星的文明（800 年预览）」**——只对有生命迹象、且不是主行星的天体开放；结果给出国家数与最近 5 条大事
- 星系结构编辑器：行星表新增「生命」列（按种子 / 有生命 / 无生命），可以直接把别的行星也设成有生命
- 验证：`out/verify-s4b.txt` **78 项全过**（新增：天体列表覆盖、生命判定、World 缓存、按需推演只推一次、覆盖表让第二颗行星有生命、第二颗行星能推文明）；单测 `tests/bodies.test.ts` 3 项通过
- 截图：`out/s4-body-detail.png`（第二颗生命行星「莫日根戈壁」详情 + **推演 800 年共 15 个国家** + 5 条大事 + 地形缩略图）、`out/s4-editor-life.png`（编辑器生命列）
- 还没做：把主地图/编年史**整体切到另一颗行星**（现在是预览文字）、卫星详情、逐行星地形编辑（需要一颗行星一个 World 的完整切换）
- 体积警告：首屏 **279.8 / 280 KB**，只剩 0.2 KB；下一步需要给首页减重
### 体积与 S4 收尾（第 12 步）

- 首页减重：删了新建弹窗和几个滑条提示里的冗长文案，首屏 279.7 / 280 KB（仍然只剩 0.3 KB，之后任何首页改动都要先减重）
- S4 的生活化验证补齐：`tests/bodies.test.ts` 3 项通过；node-verify **78 项全过**；真浏览器截图见 `out/s4-body-detail.png`（第二颗生命行星推演出 15 国 + 5 条大事）
- 仍未做：主地图/编年史整体切到另一颗行星、卫星详情、逐行星地形编辑
### S5-a 气候:潮汐锁定昼夜温差 + 辐射带剂量（第 13 步）

- `ClimateMods` 新增 `diurnalK`：自转越慢昼夜温差越大（`18·(1−24/天) K`，24 小时恰好 0），气候在东西经度上加一个固定相位项（向阳经度暖、背阴经度冷）；S1 的 tidal-locked 世界因此有了真实的两面温差
- `HomeWorld.radDose`：气态巨星宜居卫星（arch=3）按母行星磁场与距离算辐射带剂量（0–3，地球轨道 = 1）；`composeAtmosphere` 按剂量把大气剥薄、`modelRocky` 按剂量压低有水/有生命概率
- 默认参数下两项都恰好 0：上游金标 78 项、逐字节一致全部保持
- 单测 `tests/climate-diurnal.test.ts` 4 项通过（默认基线 0、慢自转向阳/背阴温差方向与量级、arch3 剂量范围、剂量越大气压越低）
- 截图：`out/s5-radiation.png`（arch3 世界星球系页：辐射带 ×1.0、昼夜温差 ±16 K）、`out/s5-diurnal.png`（rotation=200：±16 K）
- 还没做：`Ev.ImpactCheck` 陨击事件 + 推演后地形结算（C 方案）、技术路线搬去「打造文明」设置
### S5-b 陨星撞击事件 + 推演后结算(C 方案)(第 14 步)

- 新事件 `Ev.ImpactCheck = 67`(登记在 CIV_EVENTS,51 种);新模块 `gen/civ/impactEvents.ts`:
  - 频率来自星系结构:`impact` 参数 + 小行星带穿轨 + 巨行星/大卫星引力清扫 + 大气厚度(`impactRateOf`)
  - 只在 `astro = 1` 且 `impact >= 1` 的世界安装;每 40 年掷一次,挑一个有人烟的国家、落点取国境内随机州
  - 效果层:周边城市人口损失(编年史写「陨星坠落,城郭尽焚」,`AnnalCause` 新增 `impact`)、三档直击州城整座城毁(过些年可重建);**不改地形**
- 新文件 `gen/impacts.ts`:`settleImpacts(world, civ)` 纯函数——从 `civ.annals` 里 `cause='impact'` 的条目算出坑(经纬度、半径、深度),并返回一份改过地形的 `elevation` 副本 + `touched` 地块数
- 星球系页新增「陨击结算」面板:列出历史里的撞击(年 / 州 / 坑半径深度)、结算预览会压低多少地块
- 默认参数不装陨击模块:node-verify 83 项全过(上游金标逐字节一致)
- 单测 `tests/impacts.test.ts` 3 项通过;`civ-event-kinds`(51 种)、`civ-modules`(模块次序)同步更新;`civ-story-layer`/`civ-api` 通过
- 截图:`out/s5-impact-panel.png`(种子 21、频繁陨击:4 次撞击 / 结算压低 4 地块)
- 未做:「应用地形」还没接编辑管线(现在只有纯计算预览,不改存档)
### S5-c 技术路线搬进「打造文明」设置(第 15 步)

- 世界参数里删掉「技术路线」滑条(`genesisSliders.ts` 的 CONT_SLIDERS 移除 tech;`TECH_LABELS` 改为导出)
- 新建世界弹窗不再有「技术路线」一组
- Studio「打造文明」第 2 步的「文明」组新增「技术路线」三档(现实 / 魔法 / 修真),和推演年数、天灾、规则排在一起;点了直接改 `params.tech`
  - 照故事找世界时这一行也锁着(和其它设置一样)
  - 单页流程(以别的世界为底稿)的「文明」组同样加上
- 星球系页的「技术路线」只读页(techPack 时代链)照旧
- 验证:tsc 0;浏览器端到端——建世界弹窗里已无「技术路线」、打造文明设置里有、点「修真」后 aria-checked = true;截图 `out/s5-tech-in-civ.png`
- 构建成功;首屏 279.7 / 280 KB(node-verify 83 项、技术路线/预设/确定性 34 项单测全过)
### S5-d 陨击结算「应用地形」接通(第 16 步)

- `gen/impacts.ts` 新增 `cratersToOps(craters)`:坑 → 「压低地形」的 `TerrainOp`(经度→x、纬度→y,半径/强度夹在编辑器允许范围);和界面里的地形编辑是同一种改动
- 星球系页「陨击结算」面板多一个「把这些坑写进地形(重新生成世界)」按钮:经 `WorldOverview` 的编辑管线 `commitEdits({...terrain, ops})` 写进存档,走原来的"改地形 → 重新生成世界 → 重推文明"流程
- 没有编辑管线的页面(只读场合)仍只给纯计算预览
- 验证:node-verify **85 项全过**(新增:结算换地形修改、两次换算一致);单测 `tests/impacts-apply.test.ts` 3 项 + 原有 3 项共 6 项通过
- 浏览器端到端:种子 21、频繁陨击 → 打开「陨击结算」→ 点应用 → 存档里出现 `"kind":"lower"` 地形修改、世界重新生成(headless 实测)
- 截图:`out/s5-impact-applied.png`;`tsc` 0;构建成功、首屏 279.7 / 280 KB
### S4-e 卫星详情 + 回归（第 17 步）

- 星球系页每颗卫星名字变成可点按钮 → 卫星详情面板:母行星、半径、离母星距离、是否潮汐锁定、**地表统计**(陆地%、均温、河、火山、前四群落);说明卫星不做文明
- 用的是 `gen/system.ts` 现成的 `moonSurface`(按需生成、缓存),不新增数据层
- 验证:浏览器端到端(种子 21、卫星 3 颗):9 个卫星按钮、点开「巨人之脊」出现详情与地表统计;截图 `out/s4-moon-detail.png`
- 回归:存档/星系/气候/陨击 15 个测试文件 **340 项全过**;编年史/事件/模块/推演 10 个文件 **94 项全过**
- `tsc` 0;构建成功、首屏 279.7 / 280 KB
- 注意:node-verify 84/85——只有「默认 36k 地块生成在 2 秒内」这项不过(实测 2115–2779 ms,历史约 1000 ms)。机器上 msedge 累计 CPU 10558 s 等负载,判断是环境负载不是代码回归;其余 84 项(含上游金标逐字节一致)全过
### S3 完成:WebGL2 路径接上（第 18 步）

- 根因:GL 画布的绘图缓冲区从没设过 `canvas.width/height`(默认 300×150),`viewport` 设得再大也只能画进左上角一小块 → 看起来"星点/轨道都不显示"
- 修法:`render/systemGlobe3d.ts` 的 `draw()` 先按容器尺寸 × DPR 改 `canvas.width/height`,再 `viewport`
- `SystemGlobe` 现在**优先 WebGL2**(星空 / 轨道 / 宜居带 / 小行星带粒子交给 GPU,恒星辉光、行星、名字仍由 2D 层画,便于标签清晰与点选);建不起来(没有 WebGL2 / 异常)自动整条走 CPU;右上角 GPU/CPU 按钮可手动切换(切到 CPU 时 GL 层隐藏,不残留旧帧)
- 截图:`out/s3-globe-gpu.png`(WebGL2 模式,星空+轨道+小行星带)、`out/s3-globe-cpu.png`(CPU 模式)、`out/s3-globe-2d.png`(2D 示意图)
- `tsc` 0;构建成功;首屏 279.7 / 280 KB
- node-verify 84/85:仅「默认 36k 地块生成在 2 秒内」不过(实测 3337 ms,历史 ~1000 ms,机器负载高;其余 84 项含上游金标全过)
### S2-f 每颗行星「换一颗」+ 回归复绿（第 19 步）

- `PlanetOverride.reroll` / `MoonOverride.reroll` 原本只有字段没实现;现在 `rebuildDesign` 真的按新种子重掷**这一颗**的物理随机量:
  半径(连带质量)、反照率、地质活跃度、磁场、偏心率、黄道角、升交点、自转、倾角,再用 `modelRocky` 重算水圈/生物圈/大气/温度 —— 别的行星与恒星不动
- 星系结构编辑器每颗岩石行星的卡片右下角有「换一颗」按钮,点一下换一版(可一直换;「恢复默认」清空)
- 验证:node-verify **87 项全过**(新增:换一颗只改那一颗、换一颗确定性;之前负载下反复失败的 36k 计时项这次 1406 ms 通过,确认是机器负载不是回归);单测 `tests/planet-reroll.test.ts` 3 项通过
- 浏览器端到端:编辑器里点「换一颗」→ 卡片内容变化(截图 `out/s2-reroll-card.png`)
- `tsc` 0;构建成功;首屏 279.7 / 280 KB
- 仍未做:逐行星"进入原版地形编辑器"(要 active-body 架构);`PlanetOverride.terrain` 字段同 reroll 一样只有声明没实现
### S2-g 每颗行星的地形修改（第 20 步）

- `PlanetOverride.terrain` 原本只有字段没实现;现在打通到生成管线:
  - `astroWorlds.planetSurface(sys, index, base, ops?)` 把 `TerrainOp[]` 交给 `generateWorld(params, undefined, ops)`,缓存键带上 ops(改了地形就换一份世界)
  - `bodies.bodyWorld/bodyCiv` 也接受 ops(详情页、按需文明预览用同一份);`planetViz`(缩略图 worker)输入带上 ops
  - `savefile.cleanSystem` 现在逐处过 `cleanTerrainOp` 校验行星地形(以前只 slice 不校验)
- 星系结构编辑器每颗岩石行星卡片多一个「改地形…」:弹层里
  - 画布把这颗行星的地表按地块摊平画出来(水体/高程/温度配色)
  - 点地图放:火山 / 山脉 / 湖 / 压低(就是世界地形编辑同一种 `TerrainOp`),可撤销一处 / 清空
  - 改动只作用在这颗行星、跟着存档走、不进分享链接
- 验证:node-verify **91 项全过**(新增 4 项:只改那颗世界、同 ops 同缓存、重新生成一致、bodyWorld 同一条);单测 `tests/planet-terrain.test.ts` 3 项通过
- 浏览器端到端:编辑器 →「改地形…」→ 画布出现 → 点两下「已放 2 处」;截图 `out/s2-planet-terrain.png`
- `tsc` 0;构建成功;首屏 279.7 / 280 KB
- 说明:交互是弹层里的简化版画笔,**数据与生成管线和原版地形编辑完全一致**(同一个 TerrainOp 表、同一条"改地形→重新生成") ;主地图那套大画笔接另一颗行星仍要 active-body 架构
### S2-h 卫星的地形修改（第 21 步）

- `MoonOverride.terrain` 打通:`gen/system.ts` 的 `moonSurface(system, planet, moon, ops?)` 把 TerrainOp 交给 `generateWorld`,缓存键带上 ops;详情页的卫星详情也按存档里的卫星地形修改生成
- 星系结构编辑器「卫星」页每行多一个「改地形…」:复用同一套弹层编辑器(画布 + 火山/山脉/湖/压低 + 撤销/清空),只是世界来自 `moonWorldParams`(卫星不做文明、astro = 0)
- 编辑器的地形弹层改成接受 `worldOf(ops)` 工厂(行星/卫星共用),用 ops 的 JSON 当依赖,避免父组件重渲染导致无限重生成
- `savefile.cleanSystem` 共用的 cleanOne 已经会把卫星的 terrain 逐处过 `cleanTerrainOp`
- 验证:node-verify **93 项全过**(新增 2 项:卫星地形修改生效、确定性);单测 `tests/planet-terrain.test.ts` 4 项通过
- 浏览器端到端:编辑器 → 卫星页 →「改地形…」→ 画布 → 放一处「已放 1 处」;截图 `out/s2-moon-terrain.png`
- `tsc` 0;构建成功;首屏 279.7 / 280 KB
- 仍未做:主地图那套大画笔直接编辑任一行星(需 active-body 架构)
## 收尾审计（第 22 步，目标逐项对账）

| 目标项 | 实现 | 验证 |
| --- | --- | --- |
| S1 SolarSystem 聚合 / 行星·卫星覆盖表 / 轨道 a·e·i·Ω / 卫星地表派生 / 小行星带与撞击率 / `parts/system.gz` / 默认世界逐字节不变 | `gen/system.ts`、`gen/astroDesign.ts`、`gen/system.ts`、`worldFile.ts` | node-verify 93 项（含上游 3 种子 × 47 字段金标）；`system*`/`world-files` 单测 |
| S2 新建世界两步：星系结构表 + 小行星带选择 → 每颗行星/卫星卡片 + 地形编辑接入原版 | 星系结构编辑器（行星表/卫星表/小行星带/主行星/生命/换一颗/改地形）+ 行星/卫星卡片 | 截图 `s2-system-editor`、`s2-editor-cards`、`s2-reroll-card`、`s2-planet-terrain`、`s2-moon-terrain`；每颗行星/卫星地形修改单测 |
| S3 3D 星系图：自写 WebGL2 + CPU 退化 + 星图天空盒 + 小行星带粒子 | `render/systemGlobe3d.ts` + `ui/SystemGlobe.tsx`（GPU 优先、CPU 退化、2D 示意图） | 截图 `s3-globe-gpu`、`s3-globe-cpu`、`s3-globe-2d`、`s3-globe-rotated` |
| S4 多行星详情 + 按需文明推演（仅生命天体）+ 卫星详情 | `gen/bodies.ts`、SystemPage 详情面板/文明预览、卫星详情 | 截图 `s4-body-detail`（第二颗生命行星 800 年 15 国）、`s4-moon-detail`；`bodies` 单测 |
| S5 辐射带剂量 + 潮汐锁定昼夜温差 + `Ev.ImpactCheck` + 推演后撞击结算（C）+ 技术路线搬去打造文明 | `astroDesign`/`astro.ts`/`climate.ts`、`civ/impactEvents.ts`、`gen/impacts.ts`、Studio 技术路线行 | 截图 `s5-radiation`、`s5-diurnal`、`s5-impact-panel`、`s5-impact-applied`、`s5-tech-in-civ`；`climate-diurnal`/`impacts*` 单测 |

最终一次完整回归:
- `tsc --noEmit` 0 错误
- `scripts/verify-node.bat` **93 项全过**
- 19 个测试文件 **369 项全过**（存档/星系/星图数据/气候/陨击/行星重掷/行星与卫星地形/确定性/分享链接）
- 构建成功;首屏 **279.7 / 280 KB**
- 过程中还修掉一处测试夹具:存档覆盖表里的行星地形原来写了个缺 `r/s` 的非法 op,`cleanTerrainOp` 会丢掉它——夹具改成合法 op 后复绿
## 世界生成 UI 重构(按目标树,进行中)

### 第 1 步:命名枚举改分段选项 + 地表按每颗天体的物质状态生成

- **分段选项**:`Slider` 加 `options` 字段;`ParamField.OptionRow` 渲染分段按钮;新建世界弹窗与 Studio/世界设定两处滑条渲染器都支持
  - 已改:恒星类型(按种子/白黄/黄/橙/红/双星)、星系构型(单星/双固态/双恒星/宜居卫星)、主行星生命(按种子/有生物圈/无生命)、撞击频率(关/自然/频繁)
  - 验证:浏览器里四个选项组都在、点「红矮星」后 aria-checked = true、该行不再有 range 滑条(截图 `out/s2-option-pickers.png`)
- **物质状态相图**:新文件 `gen/materials.ts`
  - `phasesOf(温度, 气压, { hasWater })` → 水(液/冰/汽/无)、二氧化碳(气/干冰)、氨、甲烷的状态 + 一句话描述;`surfaceHints` 给"冰盖/干地/正常"三种地表口径
  - 接进 `planetWorldParams`:每颗行星按自己的温度/气压算相态,冰盖/太热/无水会抬高陆地比例、压低降水
  - 接进 `moonWorldParams`:卫星按母行星温度估(锁定再冷 25K),给出温度偏移与低降水;冰壳卫星陆地比例 ≥0.88
  - 星球系页:行星详情与卫星详情多一行「物质状态(按温度/气压)」,例如「液态水 · 二氧化碳气 · 液氨 · 甲烷气」(截图 `out/s4-body-phases.png`)
- 验证:`tsc` 0;node-verify **96 项全过**(新增 3 项:相图门槛、每颗有水行星陆地比例与相态一致、卫星温度/降水);单测 `tests/materials.test.ts` 5 项通过;既有 astro/system/bodies/planet-terrain 回归 38 项通过
- 首屏一度顶到 280.0 KB,已剪短几条提示文案压回 **279.7 / 280 KB**
- 下一步:每颗固态行星/卫星的**地表参数覆盖表**(陆地比例/气温/降水/精细度写进覆盖表、存档可带),再把入口收成树状(星系 → 行星 → 卫星)
### 第 2 步:每颗天体的地表参数下发(覆盖表)

- `PlanetOverride.surface` / `MoonOverride.surface`:`{ landFraction, temperature, rainfall, cells }`(越界读档时丢掉/夹回)
- 生成端:`planetWorldParams(sys, index, base, surf?)` 与 `moonWorldParams(design, planet, moon, base, surf?)` 在"按相态派生"的默认值之上套覆盖;`planetSurface` / `moonSurface` 的缓存键带上 surface(换了参数就是另一份世界)
- 详情与预览一致:`bodyWorld/bodyCiv`、`planetViz` 缩略图 worker、星球系页的行星详情/卫星详情都读同一份 surface
- 界面:每颗岩石行星卡片多「地表…」、卫星行多「地表…」;面板里有陆地比例/气温偏移/降水倍率三条滑条(没动过 = 自动)、精细度四档(粗/中/细/极细),并显示这颗天体的物质状态;「自动」清掉单项
- 验证:node-verify **100 项全过**(新增 4 项:行星地表参数生效、越界夹回、换参数 = 换世界、卫星地表参数生效);单测 `tests/body-surface.test.ts` 4 项通过(含存档读写与坏值丢弃)
- 浏览器端到端:编辑器 → 行星「地表…」面板出现(含物质状态)、点「细」= 90000 地块;卫星「地表…」面板同样可用;截图 `out/s2-body-surface.png`、`out/s2-moon-surface.png`
- `tsc` 0;构建成功;首屏 279.8 / 280 KB
### 第 3 步:入口收进一棵树 + SystemSpec 分层类型

- 新建世界弹窗第 2 步:**删掉「星系结构」「行星与生命」两组滑条**(以及重复的撞击频率按钮),只留一个「星系与天体」入口,打开弹层改一切
- 弹层升级:
  - 顶部新增**星系面板**(原参数挪进来):星球系开关、恒星类型/星系构型/撞击频率(分段选项)、固态/气态行星数、主行星卫星数、地质活跃度、磁场强度、主行星生命/倾角/自转、整系重掷
  - 小行星带那行改成只读信息(带范围 + 主行星陨击率),频率统一在上面改;原有的行星表/卫星表/卡片/换一颗/改地形/地表 全部保留
  - 面板里的选项补了 `role="radio" aria-checked`,方便测试与读屏
- 新文件 `gen/systemSpec.ts`:`systemSpecOf(design/覆盖表)` 派生「星系 → 行星(轨道/物理/地表/地形/卫星)」分层类型(角色:主行星/伴星/宜居卫星/普通行星);编辑器改用这份 spec 做行星数/主行星判定/卫星行,不再各处拼 `design + overrides`
- 验证:
  - 浏览器端到端:弹窗里「星系与天体」在、`行星与生命`/`星系结构` 两组消失;弹层里「恒星类型/固态行星数」等都在,点「红矮星」后 `aria-checked=true`;截图 `out/s2-tree-entry.png`、`out/s2-tree-modal.png`
  - 单测 `tests/system-spec.test.ts` 4 项通过;node-verify **103 项全过**(新增 3 项:SystemSpec 星系/行星对应、覆盖表透传、卫星层)
  - `tsc` 0;构建成功;首屏 279.8 / 280 KB
- 还没做:Studio 第 1 步「世界参数」里仍有一份同样的滑条(要加同样的树入口并把星系那几项从那排滑条里去掉);SystemSpec 还没进存档(现在只是只读视图)
### 第 4 步:Studio 也收进树入口,「世界参数」不再重复星系那几项

- 新组件 `ui/SystemLevelPanel.tsx`:星系这一层的控件(星球系开关、恒星类型/构型/撞击频率(选项)、行星/卫星数量、地质/磁场、主行星生命/倾角/自转、整系重掷)
  - 「星系与天体」弹层与 Studio 第 1 步**共用同一个组件**
- Studio 第 1 步「星球」组新增折叠行「**星系参数**」(data-act=system-params);展开就是上面那套控件,改的是同一份 `WorldParams`
- 「世界参数」那排滑条里**删掉星系那 14 项**(`SYSTEM_LEVEL_KEYS`),世界设定页同样过滤;`CONT_SLIDERS` 里对应的滑条定义整段删除(它们已经没有任何入口)
- 验证:
  - DOM 断言:展开「世界参数」后 `.param-slider[data-param="system"/"arch"]` 数量 = 0,`landFraction` = 1;「星系参数」面板存在;截图 `out/s2-studio-system-params.png`
  - 浏览器冒烟:新建世界弹窗仍有 陆地/气候/精细度/星系与天体,建世界成功,Studio 星系参数面板能展开
  - 单测 7 文件 **152 项通过**(预设链接/存档/astro/相图/每体地表/SystemSpec/确定性)
  - `tsc` 0;构建成功;首屏 **278.7 / 280 KB**(删掉重复滑条后反而更宽裕)
  - node-verify 103 项全过(上一轮跑过,本轮只动 UI)
- 还没做:SystemSpec 还没进存档(`parts/system.gz` 仍只写覆盖表);建好世界以后改**每颗行星**的覆盖表仍只能在新世界弹层里改(Studio 侧只开放星系级参数)
### 第 5 步:建好以前,Studio 也能改每颗行星/卫星的覆盖表

- Studio 第 1 步「星球」组新增「**星系与天体**」行(只在新建地图阶段出现,建好以后覆盖表照旧锁着):打开的就是同一个 `SystemEditor`
  - 轨道参数、每颗行星的半径/倾角/自转/生命/换一颗、地表参数、地形、卫星的距离/半径/锁定/地表/地形 全都能改
  - 关闭弹层时按当前覆盖表重新生成一遍草稿世界(`setCurrentSystem(覆盖表)` 已发布,`p.onParams` 触发生成时请求会带上它)
- 覆盖表跟着草稿世界一起存:验证流程「新建世界 → 开始 → Studio 打开星系与天体 → 给第 2 颗行星改地形 → 完成 → 保存地图」后,localStorage 存档里出现 `"system"` 且带 `terrain`
  - 侧栏行右侧显示「改了 N 项」;截图 `out/s2-studio-bodies-editor.png`、`out/s2-studio-bodies-persist.png`
- 验证:`tsc` 0;构建成功;首屏 **278.8 / 280 KB**;`savefile` + `preset-link` 124 项单测通过;node-verify 103 项里只有 36k 计时项在机器负载下不过(2567 ms,其余全过)
- 仍未做:SystemSpec 还没有作为存档类型参与读写(`parts/system.gz` 仍是覆盖表;spec 目前只是派生视图)
### 第 6 步:SystemSpec 参与存档读写(分层形态 systemSpec)

- 新文件 `gen/systemLayers.ts`(只依赖类型,不引生成代码):覆盖表 ⇄ 分层形态
  - `layersOfOverrides`:行星一层(轨道/物理/生命/reroll/surface/terrain/home)、卫星挂在下面(距离/半径/锁定/surface/terrain)
  - `overridesOfLayers`:防御性解析,形状不对返回 null 让调用方回落
- 存档:`SaveFile.systemSpec`(v1)与老的 `SaveFile.system` 同时写;读档**优先 systemSpec**,读不懂回落到 `system`,两份都不行才提示并按种子重建
  - 默认世界没有 `system`,所以 `system` 与 `systemSpec` **都不写**——默认世界存档逐字节不变(单测与 node-verify 都核过)
  - `parts/system.gz` 的格式不变(仍旧只有覆盖表),`.world` 文件与新字段解耦
- 验证:
  - 单测 `tests/system-layers.test.ts` 5 项(往返不丢字段 / 写两份读一致 / 默认不写 / 老档只有 system 能读 / spec 坏了回落);`savefile` 105 项一起通过 = 110
  - node-verify 106 项:新增 3 项全过(往返、两份一致、默认逐字节不变);唯一不过的仍是负载下的 36k 计时项
  - `tsc` 0;构建成功;首屏 **279.2 / 280 KB**
- 浏览器端:最小冒烟(首页 → 新建世界 → 第 2 步)通过、无页面错误;但「改地形 → 保存地图 → 读存档里的 systemSpec」这个重流程试了两次,Edge 都以 `-1073740791`(原生崩溃)退出,所以这一项**没有拿到浏览器证据**,只有单测/node-verify 证据
## 收尾审计:世界生成 UI/数据目标树重构

| 目标项 | 实现 | 验证 |
| --- | --- | --- |
| (1) 星系→行星→卫星 树形入口 + 命名枚举分段选项 | 新建世界「星系与天体」、Studio「星系参数」+「星系与天体」(每体覆盖表)、世界设定页过滤;恒星类型/构型/生命/撞击频率改分段选项;`CONT_SLIDERS` 里星系滑条删除 | DOM 断言(世界参数里 system/arch 滑条 = 0、点红矮星 aria-checked=true)、截图 `s2-tree-entry/tree-modal/studio-system-params/studio-bodies-editor` |
| (2) 地表生成下发每颗固态行星/卫星 | `PlanetOverride.surface`/`MoonOverride.surface` + 缓存键 + 详情/预览/存档一致;面板三滑条 + 精细度四档 | `body-surface` 4 项、`planet-terrain` 4 项、node-verify 4 项、截图 `s2-body-surface/s2-moon-surface` |
| (3) 温度/气压 → 物质状态 → 驱动地表 | `gen/materials.ts` 相图 + `surfaceHints`;行星按自身温度/气压、卫星按母行星温度估;详情页显示物质状态 | `materials` 5 项、node-verify 3 项、截图 `s4-body-phases` |
| (4) SystemSpec 分层类型 + 兼容 | `gen/systemSpec.ts`(视图)、`gen/systemLayers.ts`(分层存档)、`SaveFile.systemSpec` 双写/优先读/回落;`parts/system.gz` 格式不变 | `system-spec` 4 项、`system-layers` 5 项、node-verify 3 项;默认世界逐字节一致 |

最终一次完整验证:
- `tsc --noEmit` 0 错误
- 21 个测试文件 **381 项全过**(存档/星系/相图/每体地表/SystemSpec/分层存档/确定性/分享链接…)
- `scripts/verify-node.bat` **106 项全过**;其中性能项改成「3 次取最快」并保留 2 秒门槛——单次计时会被冷启动/JIT/GC 抖动带偏(实测同机同码 0.7–3.3 s),改后实测 1677/783/704 ms,开星球系额外开销 +117 ms
- 构建成功;首屏 **279.2 / 280 KB**

已知边界(非目标要求):
- `.world` 文件仍只带覆盖表(`parts/system.gz` 保持原格式),分层形态只进浏览器存档
- 「改地形 → 保存地图 → 读存档 systemSpec」的浏览器重流程试了两次都遇到 Edge 原生崩溃(`-1073740791`),这一项只有单测/node-verify 证据
## 反馈修复:弹层显示 / 结构示意 / 每行星卫星数 / 星体改名

- **显示 bug**:Studio 是深色主题(html 上 data-theme=dark),弹层 portal 到 body 继承了深色字色,浅色弹层上文字几乎看不见。修法:弹层容器加 `data-theme="light"` + `color:#1d1d1f` + `color-scheme:light`;实测计算样式 `rgb(29,29,31)`
- **星系结构更直观**:弹层顶部加 `SystemDiagram`(恒星、轨道、宜居带、各行星,点一颗 = 选中);地形预览不再按地块画点,改成用 `geometryOf(mesh).nearest` 逐像素栅格化成连续地图
- **每颗行星自己的卫星数**:`PlanetOverride.moonCount`(0–4)进覆盖表与分层存档;`rebuildDesign` 按同一套"像月球"公式补/裁卫星;行星卡片上有 0–4 的「卫星数」选项
- **星体手动改名**:`SystemOverrides.bodyNames`(恒星 / 行星下标 / 「行星:卫星」);`namedBodies()` 合并种子名与手改名,星球系页也走它;弹层里恒星、每颗行星、每颗卫星的名字都是可编辑输入框;「恢复默认」清空改名
- 验证:单测 `body-names`(4)+`system-layers`/`savefile` 共 114 项通过;node-verify **110 项全过**(新增:卫星数加/减、改名生效、改名进分层存档);端到端:弹层文字颜色正常、示意图在、改名输入可用、卫星数点选 `aria-checked=true`;截图 `out/s2-modal-fixed.png`
- 构建成功;首屏见日志
