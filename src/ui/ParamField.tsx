/**
 * 滑条右边能直接打字的数值框(新建弹窗、新建页左边「世界参数」、照手绘图第 3 步共用)。
 *
 * 平时写着现在的数(单位用浅灰字跟在后面:"33 %""1.00 ×""36 k",打字时也在);点进去直接改,回车或点别处算数,Esc 放弃。
 * 打的是显示的单位:陆地比例打 40 = 40%,地块打 80 = 80k,倍数打 1.5。精度比滑条细一档(倍数到 0.01、比例到 1%)。
 * 打超了范围:框变红,onBad 交出一句"板块数量在 8 到 60 之间，按回车会改成 60"(放在哪由用的地方定),
 * 回车 / 点别处改成最近的边界;打的不是数:onBad 说"只能填数字",点别处还原。
 * 南北偏向写"北 40""南 40",打"北40""南 40""-40""40"都认,"均匀" = 0。点进去没改就点出来,不算改。
 *
 * 另有几样大家共用的零件:滑条的填色(南北偏向从正中往两边填)、大陆数量的分段按钮(自动 / 1–6)、大陆五样的默认值。
 */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PARAMS, continentCap, type WorldParams } from '../gen/params';
import type { SliderLike } from './genesisSliders';
import './params.css';

/** 数值框怎么写:显示的数 = 值 × mul ÷ div,保留 digits 位小数;unit 跟在后面 */
export interface FieldSpec {
  unit?: string;
  mul?: number;
  div?: number;
  digits?: number;
  /** 打完以后按这么大的格子取整(推演年数按 1000 年);不给 = 按 digits 位小数 */
  snap?: number;
  /** 正负数写成字:[负, 正](南北偏向) */
  signs?: [string, string];
  /** 0 写成什么("均匀") */
  zero?: string;
}

const specOf = (s: SliderLike): FieldSpec => s.field ?? {};

/** 显示成框里的字(不带单位) */
export function fieldText(s: SliderLike, v: number): string {
  const f = specOf(s);
  const d = s.shown ? s.shown(v) : (v * (f.mul ?? 1)) / (f.div ?? 1);
  const t = d.toFixed(f.digits ?? 0);
  if (f.signs) {
    if (Number(t) === 0) return f.zero ?? '0';
    return `${d < 0 ? f.signs[0] : f.signs[1]} ${t.replace('-', '')}`;
  }
  // -0 写成 0
  return Number(t) === 0 ? (0).toFixed(f.digits ?? 0) : t;
}

/** 把打的字读成值;读不懂 = null(没夹到范围里) */
export function parseField(s: SliderLike, text: string): number | null {
  const f = specOf(s);
  let t = text.trim().replace(/[，,\s]/g, '');
  if (f.unit) t = t.replace(f.unit, '');
  let sign = 1;
  if (f.signs) {
    if (f.zero && t === f.zero) return 0;
    if (t.startsWith(f.signs[0])) {
      sign = -1;
      t = t.slice(f.signs[0].length);
    } else if (t.startsWith(f.signs[1])) t = t.slice(f.signs[1].length);
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const digits = f.digits ?? 0;
  const p = 10 ** digits;
  const shown = (sign * Math.round(Number(t) * p)) / p;
  let v = s.fromShown ? s.fromShown(shown) : (shown * (f.div ?? 1)) / (f.mul ?? 1);
  if (f.snap) v = Math.round(v / f.snap) * f.snap;
  return v;
}

/** 夹进滑条的范围 */
export const clampTo = (s: SliderLike, v: number) => Math.min(s.max, Math.max(s.min, v));

/** 超出范围时的那句话 */
function rangeNote(s: SliderLike, v: number): string {
  const lo = fieldText(s, s.min);
  const hi = fieldText(s, s.max);
  const unit = specOf(s).unit ?? '';
  return `${s.name}在 ${lo} 到 ${hi}${unit} 之间，按回车会改成 ${fieldText(s, clampTo(s, v))}${unit}`;
}

export function ParamField({
  s,
  value,
  onCommit,
  onBad,
  disabled,
  changed,
}: {
  s: SliderLike;
  value: number;
  onCommit: (v: number) => void;
  /** 打的字不对 / 超出范围时那句话(好了 = null) */
  onBad?: (msg: string | null) => void;
  disabled?: boolean;
  /** 和所选预设不一样:数字用主色 */
  changed?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const skip = useRef(false);
  const inRef = useRef<HTMLInputElement>(null);
  /** 点进来时框里写的(没动过就不算改了) */
  const shown = useRef<string | null>(null);
  const unit = specOf(s).unit;
  // 外面改了(拖滑条、换预设、刚改的数生效):还没动过的框跟着换;正在打的字不动
  useEffect(() => {
    if (text === null) return setBad(false);
    if (text === shown.current) {
      const t = fieldText(s, value);
      shown.current = t;
      setText(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const report = (msg: string | null) => {
    setBad(!!msg);
    onBad?.(msg);
  };
  const check = (t: string) => {
    const v = parseField(s, t);
    if (v === null) report(t.trim() ? '只能填数字' : null);
    else report(v < s.min || v > s.max ? rangeNote(s, v) : null);
  };
  const commit = () => {
    if (text === null) return;
    const v = parseField(s, text);
    setText(null);
    report(null);
    // 没动过(点进来又点出去):不算改
    if (v === null || text === shown.current) return;
    const c = clampTo(s, v);
    if (c !== value) onCommit(c);
  };
  return (
    <span
      className={`pf k-${s.key}${text !== null ? ' editing' : ''}${bad ? ' bad' : ''}${changed && text === null ? ' chg' : ''}${disabled ? ' off' : ''}`}
      title={s.hint}
      onPointerDown={(e) => {
        // 点在单位上、框边上:也是点进框里
        if (e.target === inRef.current || disabled) return;
        e.preventDefault();
        inRef.current?.focus();
      }}
    >
      <input
        ref={inRef}
        className="pf-in"
        aria-label={s.name}
        data-field={s.key}
        inputMode={specOf(s).signs ? 'text' : 'decimal'}
        disabled={disabled}
        value={text ?? fieldText(s, value)}
        onFocus={(e) => {
          shown.current = fieldText(s, value);
          setText(shown.current);
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => {
          setText(e.target.value);
          check(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            // 放弃这次打的字(不关掉弹窗)
            e.stopPropagation();
            e.preventDefault();
            skip.current = true;
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (skip.current) {
            skip.current = false;
            setText(null);
            report(null);
          } else commit();
        }}
      />
      {unit && <u>{unit}</u>}
    </span>
  );
}

/** 滑条的填色:一般从左边填到圆钮;南北偏向从正中填到圆钮 */
export function rangeFill(s: SliderLike, v: number): React.CSSProperties {
  const f = ((v - s.min) / (s.max - s.min)) * 100;
  if (s.key !== 'north') return { '--fill': `${f}%` } as React.CSSProperties;
  return {
    '--fill': `${f}%`,
    '--lo': `${Math.min(50, f)}%`,
    '--hi': `${Math.max(50, f)}%`,
  } as React.CSSProperties;
}

/** 大陆数量的几档(0 = 自动,按种子 2~5 块) */
export const CONTINENT_CHOICES = [0, 1, 2, 3, 4, 5, 6];

/** 大陆数量:自动 / 1–6 块(分段按钮) */
export function ContinentSeg({ value, onChange, disabled, plates, land }: { value: number; onChange: (n: number) => void; disabled?: boolean; plates: number; land: number }) {
  // 板块或陆地太少时分不出那么多块:多出来的按钮不能点,选着的按实际能长出的块数亮
  const cap = continentCap(plates, land);
  const on = value > 0 ? Math.min(value, cap) : 0;
  const tip = `${plates} 个板块、陆地 ${Math.round(land * 100)}% 时最多分出 ${cap} 块大陆`;
  return (
    <span className="seg-n" role="radiogroup" aria-label="大陆数量">
      {CONTINENT_CHOICES.map((n) => (
        <button
          key={n}
          className={`${n === 0 ? 'w' : ''}${on === n ? ' on' : ''}`}
          role="radio"
          aria-checked={on === n}
          data-cont={n}
          data-tip={n > cap ? tip : undefined}
          disabled={disabled || n > cap}
          onClick={() => onChange(n)}
        >
          {n === 0 ? '自动' : n}
        </button>
      ))}
    </span>
  );
}

/** 大陆五样回到默认(按种子来) */
export const CONT_RESET: Pick<WorldParams, 'continents' | 'gather' | 'rugged' | 'hardness' | 'north'> = {
  continents: DEFAULT_PARAMS.continents,
  gather: DEFAULT_PARAMS.gather,
  rugged: DEFAULT_PARAMS.rugged,
  hardness: DEFAULT_PARAMS.hardness,
  north: DEFAULT_PARAMS.north,
};
/** 有具体名字的几档(恒星类型/构型/生命/撞击频率…):渲染成分段按钮,点了直接生效 */
export function OptionRow({ s, value, onCommit, disabled }: { s: SliderLike; value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label={s.name} data-param={s.key}>
      {(s.options ?? []).map((o) => {
        const on = Math.round(value) === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            data-opt={`${s.key}-${o.v}`}
            disabled={disabled}
            onClick={() => onCommit(o.v)}
            className="ov-btn"
            style={on ? { borderColor: '#5fa85f', color: '#5fa85f', background: 'rgba(95,168,95,0.12)' } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}