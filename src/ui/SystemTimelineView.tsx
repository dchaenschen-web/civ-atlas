/**
 * S5 系统页顶部的时间轴:0…endYear、播放/暂停、1/4/16× 倍速。
 * 只驱动「天体位置」这一个观测量,不写文明状态、不动国界、不进存档。
 */
import { useEffect, useRef, useState } from 'react';
import { clampSystemYear, timelineStep } from './systemClock';

export interface SystemTimelineProps {
  endYear: number;
  year: number;
  onYear: (year: number) => void;
  /** 1× 时每秒过多少年(按主行星公转周期 T 的 1/8 算;不传 = 1) */
  yearsPerSec?: number;
  /** 选中天体的公转周期(地球日);给了就能切换"当地年"显示 */
  localYearDays?: number;
}

export function SystemTimeline({ endYear, year, onYear, yearsPerSec = 1, localYearDays }: SystemTimelineProps) {
  const [playing, setPlaying] = useState(false);
  /** 步10:时间单位(地球年 / 当地年) */
  const [unit, setUnit] = useState<'earth' | 'local'>('earth');
  const [speed, setSpeed] = useState(1);
  const current = useRef(year);
  current.current = year;
  useEffect(() => {
    if (!playing || endYear <= 0) return;
    let frame = 0;
    let previous: number | undefined;
    const tick = (now: number) => {
      if (previous !== undefined) {
        const next = timelineStep(current.current, Math.min(0.25, (now - previous) / 1000), speed, endYear, yearsPerSec);
        current.current = next;
        onYear(next);
        if (next >= endYear) {
          setPlaying(false);
          return;
        }
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, endYear, onYear, yearsPerSec]);

  // 空格 = 播放/暂停(输入框里打字不抢)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      e.preventDefault();
      if (endYear <= 0) return;
      setPlaying((p) => {
        const next = !p;
        if (next && current.current >= endYear) onYear(0);
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endYear, onYear]);
  return (
    <div data-act="system-timeline" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0' }}>
      <button
        className="ov-btn"
        data-act="system-timeline-play"
        disabled={endYear <= 0}
        onClick={() => {
          if (!playing && year >= endYear) onYear(0);
          setPlaying(!playing);
        }}
      >
        {playing ? '暂停' : '播放'}
      </button>
      <label>
        倍速{' '}
        <select aria-label="系统时间轴倍速" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {[0.5, 1, 2, 4, 8].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <span data-act="system-timeline-year">
        第 {(unit === 'local' && localYearDays ? (year * 365.25) / localYearDays : year).toFixed(2)} {unit === 'local' ? '当地年' : '地球年'}
      </span>
      <button
        className="ov-btn"
        data-act="system-timeline-unit"
        title="切换时间单位:地球年 / 当地年(选中天体的公转周期)"
        onClick={() => setUnit((u) => (u === 'earth' ? 'local' : 'earth'))}
        style={{ padding: '0 6px', fontSize: 11.5 }}
      >
        {unit === 'earth' ? '地球年' : '当地年'}
      </button>
      <input
        type="range"
        min={0}
        max={endYear}
        step={0.01}
        value={clampSystemYear(year, endYear)}
        disabled={endYear <= 0}
        style={{ flex: 1, minWidth: 120 }}
        onChange={(e) => {
          setPlaying(false);
          onYear(Number(e.target.value));
        }}
      />
      <span>{endYear} 年</span>
      <small style={{ opacity: 0.6 }}>只移动天体，不改变国界 · 1× ≈ 每 {yearsPerSec.toFixed(2)} 年/秒（主行星周期的 1/8）</small>
    </div>
  );
}
