/**
 * 「星系」这一层的参数面板——只放星系整体相关的三项。
 *
 * 用户要求:恒星相关的挪去「恒星属性」(SystemEditor 的 B2.1);
 * 子星系类型 / 行星数 / 卫星数 都在左侧树上改。这里只留开关 + 一句说明。
 */
import type { WorldParams } from '../gen/params';

const optRow = (label: string, value: number, options: { v: number; label: string }[], onPick: (v: number) => void) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} data-sys-row={label}>
    <span style={{ fontSize: 12, opacity: 0.7, minWidth: 76 }}>{label}</span>
    {options.map((o) => {
      const on = Math.round(value) === o.v;
      return (
        <button
          key={o.v}
          className="ov-btn"
          role="radio"
          aria-checked={on}
          data-sys-opt={`${label}-${o.v}`}
          onClick={() => onPick(o.v)}
          style={on ? { borderColor: '#5fa85f', color: '#5fa85f' } : undefined}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

const numRow = (label: string, value: number, min: number, max: number, step: number, onSet: (v: number) => void, fmt: (v: number) => string) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-sys-row={label}>
    <span style={{ fontSize: 12, opacity: 0.7, minWidth: 76 }}>{label}</span>
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={Math.round(value * 1000) / 1000}
      data-sys-num={label}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onSet(Math.min(max, Math.max(min, v)));
      }}
      style={{ width: 76, fontSize: 12, padding: '2px 4px' }}
    />
    <span style={{ fontSize: 11, opacity: 0.6 }}>{fmt(value)}</span>
  </div>
);

export function SystemLevelPanel({ params, onParams }: { params: WorldParams; onParams: (patch: Partial<WorldParams>) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }} data-act="system-level-panel">
      <div style={{ gridColumn: '1/-1', fontSize: 12.5, fontWeight: 600, opacity: 0.8 }}>星系</div>
      {optRow('星球系', params.astro, [{ v: 1, label: '开' }, { v: 0, label: '关' }], (v) => onParams({ astro: v }))}
      {optRow('撞击频率', params.impact, [{ v: 0, label: '关' }, { v: 1, label: '自然' }, { v: 2, label: '频繁' }], (v) => onParams({ impact: v }))}
      {numRow('整系重掷', params.salt, 0, 999, 1, (v) => onParams({ salt: v }), (v) => (Math.round(v) ? '第 ' + Math.round(v) + ' 次' : '不重掷'))}
      <div style={{ gridColumn: '1/-1', fontSize: 11.5, opacity: 0.55, marginTop: 2 }} data-act="system-level-hint">
        恒星在「恒星属性」里改；子星系类型、行星与卫星数量都在左侧树里改（右键节点）。
      </div>
    </div>
  );
}
