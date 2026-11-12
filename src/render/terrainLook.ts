/**
 * 地貌配色表(步 7):同一套「按高程/温度上色」的逻辑,按行星类型换色板。
 *
 * 为什么单独一份:星系树右栏「改地形」底图以前写死一套地球色(海蓝、森林绿、雪白),
 * 拿到冰封/熔岩/干旱/矮行星上就全是"地球的样子"。这里按地貌风格给出各自的颜色带,
 * 界面(地形编辑器)与离线预览图共用,保证同一颗行星看到的颜色一致。
 *
 * 纯数据 + 纯函数,不碰 canvas / DOM,Node 里能直接测、也能在脚本里出 PNG。
 */
import type { SurfaceSkin } from '../gen/surfaceKinds';

export interface TerrainLook {
  /** 深水 / 浅水 */
  deep: [number, number, number];
  shallow: [number, number, number];
  /** 冰盖(冻结的水面) */
  ice: [number, number, number];
  /** 陆地按归一化高程(0 = 海岸,1 = 最高峰)取色,从低到高 */
  land: [number, number, number][];
  /** 极冷处的地面色(温度 < -20 时的覆盖色,没有 = 不覆盖) */
  cold?: [number, number, number];
  /** 极热处的地面色(温度 > 40 时的覆盖色) */
  hot?: [number, number, number];
  /** 水像素怎么画:海(默认)/ 盆地岩 / 熔岩海 */
  waterAs?: 'sea' | 'rock' | 'lava';
  /** 熔岩裂隙/熔岩海的亮色(只有熔岩行星用) */
  lava?: [number, number, number];
  /** 一句话说明(界面提示用) */
  name: string;
}

const c = (r: number, g: number, b: number): [number, number, number] => [r, g, b];

export const TERRAIN_LOOKS: Record<SurfaceSkin, TerrainLook> = {
  earth: {
    name: '大陆与海洋',
    deep: c(18, 58, 99),
    shallow: c(42, 110, 166),
    ice: c(223, 232, 238),
    land: [c(196, 186, 130), c(120, 152, 92), c(96, 128, 76), c(143, 134, 99), c(185, 189, 189)],
    waterAs: 'sea',
  },
  ocean: {
    name: '多洋少陆',
    deep: c(10, 44, 86),
    shallow: c(30, 104, 168),
    ice: c(226, 236, 242),
    land: [c(214, 206, 158), c(104, 156, 104), c(88, 134, 82), c(150, 144, 108), c(196, 200, 200)],
    waterAs: 'sea',
  },
  desert: {
    name: '干旱沙海',
    deep: c(64, 78, 88),
    shallow: c(96, 118, 122),
    ice: c(232, 228, 216),
    land: [c(224, 196, 132), c(206, 168, 96), c(188, 146, 78), c(164, 124, 68), c(206, 190, 156)],
    hot: c(196, 150, 86),
    waterAs: 'sea',
  },
  frozen: {
    name: '冰封',
    deep: c(96, 128, 152),
    shallow: c(150, 186, 202),
    ice: c(226, 238, 244),
    land: [c(210, 224, 232), c(190, 206, 218), c(172, 190, 206), c(214, 226, 234), c(240, 246, 250)],
    cold: c(236, 244, 250),
    waterAs: 'sea',
  },
  lava: {
    name: '熔岩',
    deep: c(58, 24, 20),
    shallow: c(120, 46, 24),
    ice: c(120, 120, 124),
    land: [c(30, 26, 26), c(44, 34, 30), c(58, 42, 34), c(76, 52, 38), c(100, 66, 44)],
    hot: c(214, 96, 34),
    lava: c(244, 132, 42),
    waterAs: 'lava',
  },
  airless: {
    name: '无大气岩石',
    deep: c(56, 56, 60),
    shallow: c(78, 78, 84),
    ice: c(196, 200, 206),
    land: [c(88, 88, 92), c(112, 110, 108), c(132, 128, 122), c(154, 150, 144), c(186, 184, 180)],
    waterAs: 'rock',
  },
  dwarf: {
    name: '矮行星坑原',
    deep: c(70, 74, 82),
    shallow: c(96, 100, 108),
    ice: c(206, 212, 220),
    land: [c(118, 118, 122), c(138, 136, 134), c(158, 154, 150), c(178, 174, 168), c(206, 202, 196)],
    cold: c(226, 230, 236),
    waterAs: 'rock',
  },
  gas: {
    name: '气态(无地表)',
    deep: c(120, 96, 60),
    shallow: c(180, 150, 96),
    ice: c(200, 200, 200),
    land: [c(196, 170, 120), c(214, 186, 140), c(186, 158, 112), c(224, 198, 152), c(238, 216, 176)],
    waterAs: 'rock',
  },
};

export function lookOf(skin: SurfaceSkin): TerrainLook {
  return TERRAIN_LOOKS[skin] ?? TERRAIN_LOOKS.earth;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 一个地块的颜色。
 * @param elev 高程(米,负 = 水下)
 * @param tempC 表面温度(℃)
 * @param water 0 陆地 / 1 水
 * @param shade 明暗系数(按坡度算,默认 1)
 */
export function terrainColor(
  look: TerrainLook,
  elev: number,
  tempC: number,
  water: number,
  shade = 1,
): [number, number, number] {
  let base: [number, number, number];
  const mode = look.waterAs ?? 'sea';
  if (water === 1) {
    if (mode === 'lava') {
      // 熔岩海:越深越亮(深处是翻腾的熔岩)
      const t = clamp01((elev + 6000) / 6000);
      base = [Math.round(150 + 90 * t), Math.round(38 + 80 * t), Math.round(12 + 20 * t)];
    } else if (mode === 'rock') {
      // 没有液态水:水像素其实是低洼盆地,画成暗一点的岩色
      const t = clamp01((elev + 6000) / 6000);
      const a = look.land[0];
      base = [Math.round(a[0] * (0.55 + 0.25 * t)), Math.round(a[1] * (0.55 + 0.25 * t)), Math.round(a[2] * (0.55 + 0.25 * t))];
    } else if (tempC < -2 && look.ice) {
      base = look.ice;
    } else {
      const t = clamp01((elev + 6000) / 6000);
      base = [
        Math.round(look.deep[0] + (look.shallow[0] - look.deep[0]) * t),
        Math.round(look.deep[1] + (look.shallow[1] - look.deep[1]) * t),
        Math.round(look.deep[2] + (look.shallow[2] - look.deep[2]) * t),
      ];
    }
  } else if (look.lava && elev > 0 && tempC > 40 && look.hot) {
    // 熔岩行星:高处的热区亮成熔岩
    const t = clamp01(elev / 4000);
    const k = clamp01((tempC - 40) / 60) * (0.35 + 0.65 * t);
    base = [
      Math.round(look.land[look.land.length - 1][0] * (1 - k) + look.lava[0] * k),
      Math.round(look.land[look.land.length - 1][1] * (1 - k) + look.lava[1] * k),
      Math.round(look.land[look.land.length - 1][2] * (1 - k) + look.lava[2] * k),
    ];
  } else {
    // 陆地:按高程在色带上插
    const t = clamp01(elev / 4500);
    const x = t * (look.land.length - 1);
    const i = Math.floor(x);
    const f = x - i;
    const a = look.land[Math.min(look.land.length - 1, i)];
    const b = look.land[Math.min(look.land.length - 1, i + 1)];
    base = [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
    // 温度覆盖:极冷结霜、极热发红
    if (look.cold && tempC < -20) {
      const k = clamp01((-20 - tempC) / 40) * 0.8;
      base = [Math.round(base[0] * (1 - k) + look.cold[0] * k), Math.round(base[1] * (1 - k) + look.cold[1] * k), Math.round(base[2] * (1 - k) + look.cold[2] * k)];
    } else if (look.hot && tempC > 40) {
      const k = clamp01((tempC - 40) / 60) * 0.5;
      base = [Math.round(base[0] * (1 - k) + look.hot[0] * k), Math.round(base[1] * (1 - k) + look.hot[1] * k), Math.round(base[2] * (1 - k) + look.hot[2] * k)];
    }
  }
  if (shade === 1) return base;
  const s = Math.max(0.5, Math.min(1.45, shade));
  return [Math.min(255, Math.round(base[0] * s)), Math.min(255, Math.round(base[1] * s)), Math.min(255, Math.round(base[2] * s))];
}
