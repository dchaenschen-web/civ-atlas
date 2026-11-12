/**
 * Studio 的「3D 系统预览」:星系视角 ↔ 地表详情。
 * 星系视角:选中行星→点按钮进地表详情、「← 回到星系视角」回来。
 */
import { useState } from 'react';
import { SystemGlobe } from './SystemGlobe';
import { SystemPage } from './SystemPage';
import type { AstroDesign } from '../gen/astroDesign';
import type { BeltDesign } from '../gen/system';
import type { World } from '../gen/world';
import type { Civ } from '../gen/civ/types';

export interface SystemPreview3DProps {
  design: AstroDesign;
  names: string[];
  belts: readonly BeltDesign[];
  selected: number;
  onSelect: (index: number) => void;
  /** 看选中行星的地表(SystemPage 需要的世界数据) */
  world: World | null;
  civ: Civ | null;
  phone?: boolean;
}

export function SystemPreview3D({ design, names, belts, selected, onSelect, world, civ, phone }: SystemPreview3DProps) {
  const [surfaceMode, setSurfaceMode] = useState(false);
  const p = design.planets[selected];

  if (surfaceMode && world) {
    return <SystemPage world={world} civ={civ} phone={phone} backLabel="星球系" onBack={() => setSurfaceMode(false)} />;
  }

  return (
    <div data-act="system-preview-3d" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
        <b style={{ fontSize: 13 }}>星系视角 · 3D</b>
        <span style={{ opacity: 0.6 }}>拖拽旋转 / 滚轮缩放 / 点行星选中</span>
      </div>
      <SystemGlobe design={design} names={names} belts={belts} selected={selected} onSelect={onSelect} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
        <span style={{ opacity: 0.7 }}>
          选中:{names[selected] ?? `行星 ${selected + 1}`}
          {p ? ` · ${p.kind === 'gas' ? '气态' : '岩石'} · ${(p.tempK - 273.15).toFixed(0)}°C · 半径 ${p.radius.toFixed(2)} R⊕` : ''}
        </span>
        {world && (
          <button className="ov-btn" data-act="preview-open-surface" onClick={() => setSurfaceMode(true)}>
            看这颗行星的地表
          </button>
        )}
      </div>
    </div>
  );
}
