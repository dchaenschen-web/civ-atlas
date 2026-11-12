/**
 * 照手绘图新建那一页的零件(Studio.tsx 摆):
 *
 *   ImageCard   左边最上面那张图:缩略图、文件名、多大、彩色还是灰度,右边「换一张」(重新认,第 2 步画的笔留着)
 *   StepGroup   一步一组:组头 = 圆圈序号(做到这步是蓝的,做过的打勾)+ 名字 + 右边一句现在怎样 + 箭头;展开的在组头下面接着放
 *   StepParams  第 3 步的世界参数(没有陆地比例 —— 海陆照图定):拖动时只改数字,松手才重新生成;
 *               接着是「拓荒」:民族扩散、国家扩张,「地形难走程度」点开八样(随机生成那页世界参数里的同一套);
 *               最后是开关「推演超过 3000 年」、那段说明,开了多一条「推演到」
 *   ViewBar     地图上方的切换条:原图 / 认出来的 / 长出来的;长出来的时候有「叠上原图」和样式;平面 / 地球仪
 *
 * 状态(哪一步开着、看的是什么)在 Studio;认图的状态、留着的图在 ImportImage.tsx。
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { WorldParams } from '../../gen/world';
import type { BaseParamKey } from '../../gen/params';
import { getEdits, setEndYear, setFrontier, useEdits } from '../editsStore';
import { terrainChangedCount, terrainValue } from '../../gen/civ/frontier';
import { EXPAND_SLIDER, SPREAD_SLIDER, TERRAIN_SLIDERS, withSpeed, withTerrain, withoutTerrain } from '../frontierUi';
import { pickImage, setImportView, setSourceView, useImport, useSource, useSourceView, type SourceShow } from '../ImportImage';
import { CONT_SLIDERS, SLIDERS, YEARS_NOTE, YEARS_ON, YEARS_SLIDER, YEARS_SWITCH, type SliderLike } from '../WorldOverviewGenesis';
import { END_YEAR_DEFAULT, cleanEndYear } from '../../gen/edits';
import { Icon } from '../icons';
import { ParamField, rangeFill } from '../ParamField';
import type { MapLayer } from '../mapLayers';

export function ImageCard({ phone }: { phone: boolean }) {
  const now = useImport();
  const kept = useSource();
  const saved = useEdits().sketch?.image?.name;
  const s = now ?? kept;
  const name = s?.name ?? saved ?? '';
  const box = phone ? [48, 32] : [60, 40];
  const tw = s ? Math.round(Math.min(box[0], (box[1] * s.w) / s.h)) : box[0];
  const th = s ? Math.round((tw * s.h) / s.w) : box[1];
  return (
    <div className="sb-group">
      <div className="imp-file sk-image" data-act="image-card">
        {s ? (
          <img src={s.url} width={tw} height={th} alt="" />
        ) : (
          <span className="sk-noimg" style={{ width: tw, height: th }}>
            <Icon name="image" size={18} />
          </span>
        )}
        <span className="imp-file-tx">
          <b title={name}>{name}</b>
          {s && (
            <span>
              {s.w} × {s.h}，{s.pic.colorful ? '彩色' : '灰度'}
            </span>
          )}
        </span>
        <button className="sb-link" data-act="import-repick" onClick={pickImage}>
          换一张
        </button>
      </div>
    </div>
  );
}

export function StepGroup({
  n,
  title,
  summary,
  open,
  done,
  locked,
  onToggle,
  children,
}: {
  n: 1 | 2 | 3;
  title: string;
  summary: string;
  open: boolean;
  done: boolean;
  locked: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`sb-group sk-group${locked ? ' dimmed' : ''}`} data-step={n}>
      <button className="sk-head" data-act={`step-${n}`} aria-expanded={open} disabled={locked} onClick={onToggle}>
        <span className={`sk-no${open ? ' on' : done ? ' ok' : ''}`}>{done && !open ? <Icon name="check" size={13} /> : n}</span>
        <b>{title}</b>
        <span className="sk-s">{summary}</span>
        <Icon name={open ? 'down' : 'chevron'} size={14} className="sb-chev" />
      </button>
      {open && children && <div className="sk-body">{children}</div>}
    </div>
  );
}

/** 第 3 步列哪几样参数(陆地比例不列:海陆照图定) */
const STEP_KEYS: BaseParamKey[] = ['plates', 'mountains', 'hardness', 'temperature', 'rainfall', 'cells'];

function StepSlider({ s, value, onCommit, disabled, changed }: { s: SliderLike; value: number; onCommit: (v: number) => void; disabled: boolean; changed?: boolean }) {
  const k = s.key;
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <label className="sk-pr" title={s.hint} data-param={k}>
        <b>{s.name}</b>
        <span className="tp-range">
          <input
            type="range"
            aria-label={s.name}
            min={s.min}
            max={s.max}
            step={s.step}
            value={v}
            disabled={disabled}
            style={rangeFill(s, v)}
            onChange={(e) => setV(s.snap ? s.snap(Number(e.target.value)) : Number(e.target.value))}
            onPointerUp={() => v !== value && onCommit(v)}
            onKeyUp={() => v !== value && onCommit(v)}
          />
        </span>
        <ParamField s={s} value={v} onCommit={onCommit} onBad={setErr} disabled={disabled} changed={changed} />
      </label>
      {err && <span className="sk-err">{err}</span>}
    </>
  );
}

export function StepParams({ params, onParams, disabled }: { params: WorldParams; onParams: (p: WorldParams) => void; disabled: boolean }) {
  const edits = useEdits();
  const raw = edits.endYear;
  const on = raw !== undefined;
  const f = edits.frontier;
  const terrN = terrainChangedCount(f);
  const [terrOpen, setTerrOpen] = useState(false);
  return (
    <>
      <div className="tp-opts sk-params">
        {STEP_KEYS.map((k) => (
          <StepSlider
            key={k}
            s={(SLIDERS.find((x) => x.key === k) ?? CONT_SLIDERS.find((x) => x.key === k))!}
            value={params[k]}
            disabled={disabled}
            onCommit={(v) => onParams({ ...params, [k]: v })}
          />
        ))}
        <StepSlider s={SPREAD_SLIDER} value={SPREAD_SLIDER.pos(f?.spread ?? 1)} disabled={disabled} onCommit={(v) => setFrontier(withSpeed(getEdits().frontier, 'spread', SPREAD_SLIDER.value(v)))} />
        <StepSlider s={EXPAND_SLIDER} value={EXPAND_SLIDER.pos(f?.expand ?? 1)} disabled={disabled} onCommit={(v) => setFrontier(withSpeed(getEdits().frontier, 'expand', EXPAND_SLIDER.value(v)))} />
      </div>
      <button className={`sb-row nw-terr${terrOpen ? ' open' : ''}`} data-act="terrain-cost" aria-expanded={terrOpen} disabled={disabled} onClick={() => setTerrOpen((o) => !o)}>
        <span className="sb-row-main">
          <b>地形难走程度</b>
        </span>
        {terrOpen ? (
          terrN > 0 && (
            <span
              className="sb-link"
              role="button"
              data-act="terrain-cost-reset"
              onClick={(e) => {
                e.stopPropagation();
                setFrontier(withoutTerrain(getEdits().frontier));
              }}
            >
              恢复默认
            </span>
          )
        ) : (
          <span className="sb-row-side">{terrN ? `改过 ${terrN} 样` : '默认'}</span>
        )}
        <Icon name={terrOpen ? 'down' : 'chevron'} size={14} className="sb-chev" />
      </button>
      {terrOpen && (
        <div className="tp-opts sk-params">
          {TERRAIN_SLIDERS.map(({ g, s }) => {
            const v = terrainValue(f, g);
            return <StepSlider key={g.key} s={s} value={s.pos(v)} disabled={disabled} changed={v !== g.def} onCommit={(x) => setFrontier(withTerrain(getEdits().frontier, g, s.value(x)))} />;
          })}
        </div>
      )}
      <button className="sb-row nw-years" role="switch" aria-checked={on} data-act="years-switch" disabled={disabled} onClick={() => setEndYear(on ? undefined : YEARS_ON)}>
        <span className="sb-row-main">
          <b>{YEARS_SWITCH}</b>
        </span>
        <span className={`ai-switch${on ? ' on' : ''}`} aria-hidden="true" />
      </button>
      <p className="nw-years-note">{YEARS_NOTE}</p>
      {on && (
        <div className="tp-opts sk-params">
          <StepSlider s={YEARS_SLIDER} value={cleanEndYear(raw) ?? END_YEAR_DEFAULT} disabled={disabled} onCommit={setEndYear} />
        </div>
      )}
    </>
  );
}

/** 第 3 步收起时组头右边写的(还没起名):"30 个板块，0°C" */
export function paramsBrief(p: WorldParams): string {
  return `${p.plates} 个板块，${SLIDERS.find((x) => x.key === 'temperature')!.fmt(p.temperature)}`;
}

export interface ViewBarProps {
  phone: boolean;
  /** 正在认(第 1 步):只有原图 / 认出来的,平面 */
  importing: boolean;
  /** 已经照图长出了星球 */
  grown: boolean;
  flat: boolean;
  onFlat: (flat: boolean) => void;
  style: MapLayer;
  styles: { id: MapLayer; name: string }[];
  thumbs: Partial<Record<MapLayer, string>>;
  onStyle: (id: MapLayer) => void;
  /** 样式列表开着没有(Studio 管,点地图别处收起) */
  styleOpen: boolean;
  onStyleOpen: (open: boolean) => void;
  /** 新建界面停在中间那块的正中(电脑上跟着地图的中线) */
  left?: number;
}

export function ViewBar(p: ViewBarProps) {
  const im = useImport();
  const src = useSource();
  const sv = useSourceView();
  const show: SourceShow = im ? (im.view === 'original' ? 'original' : 'result') : p.flat ? sv.show : 'grown';
  const pick = (v: SourceShow) => {
    p.onStyleOpen(false);
    if (im) return setImportView(v === 'original' ? 'original' : 'result');
    setSourceView({ show: v });
    if (v !== 'grown') p.onFlat(true);
  };
  const views: { v: SourceShow; name: string; off: boolean }[] = [
    { v: 'original', name: '原图', off: !im && !src },
    { v: 'result', name: '认出来的', off: !im && !p.grown },
    { v: 'grown', name: '长出来的', off: !!im || !p.grown },
  ];
  const grownOn = !im && show === 'grown';
  const cur = p.styles.find((x) => x.id === p.style) ?? p.styles[0];
  const pct = Math.round(sv.overlay * 100);
  return (
    <div className={`sk-vbar${p.phone ? ' phone' : ''}`} style={p.left !== undefined ? { left: p.left } : undefined} role="toolbar" aria-label="地图上看什么">
      <div className="tp-seg" role="radiogroup" aria-label="看" data-act="source-view">
        {views.map((x) => (
          <button key={x.v} role="radio" aria-checked={show === x.v} className={show === x.v ? 'on' : ''} data-v={x.v} disabled={x.off} onClick={() => pick(x.v)}>
            {x.name}
          </button>
        ))}
      </div>
      {grownOn && p.flat && src && !p.phone && (
        <label className="sk-ov">
          叠上原图
          <span className="tp-range">
            <input
              type="range"
              aria-label="叠上原图"
              data-act="source-overlay"
              min={0}
              max={100}
              step={1}
              value={pct}
              style={{ '--fill': `${pct}%` } as React.CSSProperties}
              onChange={(e) => setSourceView({ overlay: Number(e.target.value) / 100 })}
            />
          </span>
          <em>{pct}%</em>
        </label>
      )}
      {grownOn && (
        <span className="sk-sty-wrap">
          <button className={`sk-sty${p.styleOpen ? ' on' : ''}`} data-act="source-style" aria-expanded={p.styleOpen} onClick={() => p.onStyleOpen(!p.styleOpen)}>
            <i style={p.thumbs[cur.id] ? { backgroundImage: `url(${p.thumbs[cur.id]})` } : undefined} />
            {!p.phone && cur.name}
            <Icon name="down" size={12} />
          </button>
          {p.styleOpen && (
            <div className="sk-pop sb-group" role="radiogroup" aria-label="样式">
              {p.styles.map((s) => (
                <button
                  key={s.id}
                  className="sb-row st-opt"
                  role="radio"
                  aria-checked={p.style === s.id}
                  data-style={s.id}
                  onClick={() => {
                    p.onStyleOpen(false);
                    p.onStyle(s.id);
                  }}
                >
                  <span className="st-thumb" style={p.thumbs[s.id] ? { backgroundImage: `url(${p.thumbs[s.id]})` } : undefined} />
                  <span className="sb-row-main">
                    <b>{s.name}</b>
                  </span>
                </button>
              ))}
            </div>
          )}
        </span>
      )}
      <span className="sk-vbar-sep" />
      <div className="tp-seg" role="radiogroup" aria-label="平面还是地球仪" data-act="source-proj">
        <button role="radio" aria-checked={p.flat} className={p.flat ? 'on' : ''} data-v="flat" onClick={() => p.onFlat(true)}>
          平面
        </button>
        <button role="radio" aria-checked={!p.flat} className={p.flat ? '' : 'on'} data-v="globe" disabled={!!im || !p.grown} onClick={() => p.onFlat(false)}>
          地球仪
        </button>
      </div>
    </div>
  );
}
