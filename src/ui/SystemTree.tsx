/**
 * 星系树的左树(点节点 = 右侧换属性;右键 = 改结构)。
 *
 * N2:按「子星系」分组渲染 —— 一个星系里可以有多个子星系(地月系、木星系、双固态行星系…),
 * 每组是一个 ◫ 节点,组名可右键改(N13)。
 * 结构入口都在这里:恒星(单星/双恒星)、子星系(改名/设为主行星系)、行星(设主行星/改名/换一颗/改地形/地表/删除)、
 * 卫星(设为宜居卫星/改名/删除)。
 */
import { useMemo, useState } from 'react';
import type { WorldParams } from '../gen/params';
import type { SystemOverrides } from '../gen/astroDesign';
import type { SystemSpec } from '../gen/systemSpec';
import type { AstroSystem } from '../gen/astro';
import { buildBodyViews, type BodyView } from '../gen/bodyView';
import { addGroup, addGroupMember, deleteGroup, SUB_SYSTEM_NAME, applyStarCount, applySubSystem, deleteNode, resolveStarCount, setBodyCount, setHabitableMoon } from '../gen/systemRole';
import { PLANET_TYPE_NAME, planetTypeOf } from '../gen/astroDesign';
import { renameGroup, subSystemGroupsOf, type SubSystemGroup } from '../gen/systemGroups';

export type TreeSel = { kind: 'star' | 'companion' | 'planet' | 'moon'; i?: number; p?: number; m?: number };

export interface SystemTreeProps {
  /** 有效星系(给了就用 BodyView 的名字/类型,单一数据源) */
  sys?: AstroSystem | null;
  spec: SystemSpec;
  names: { star: string; planets: string[]; moons: Record<number, string[]> | string[][] };
  params: WorldParams;
  overrides: SystemOverrides;
  sel: TreeSel;
  onSel: (s: TreeSel) => void;
  onChange: (o: SystemOverrides) => void;
  onParams: (patch: Partial<WorldParams>) => void;
  onRename: (node: TreeSel) => void;
  onTerrain: (planet: number) => void;
  onSurface: (planet: number) => void;
  onReroll: (planet: number) => void;
}

interface MenuItem {
  label: string;
  on?: boolean;
  sep?: boolean;
  run: () => void;
}
interface Menu {
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
}

const GROUP_ICON: Record<SubSystemGroup['role'], string> = {
  planet: '◫',
  binaryPair: '⇄',
  gasSystem: '⬤',
  habitableMoonSystem: '◍',
};
const GROUP_ROLE_NAME: Record<SubSystemGroup['role'], string> = {
  planet: SUB_SYSTEM_NAME[0],
  binaryPair: SUB_SYSTEM_NAME[1],
  gasSystem: '气态行星系',
  habitableMoonSystem: SUB_SYSTEM_NAME[3],
};

function moonName(names: SystemTreeProps['names'], planet: number, moon: number): string {
  const row = Array.isArray(names.moons) ? names.moons[planet] : names.moons[planet];
  return row?.[moon] ?? `卫星 ${moon + 1}`;
}

export function SystemTree(p: SystemTreeProps) {
  const { spec, names, params, overrides, sys, sel, onSel, onChange, onParams, onRename, onTerrain, onSurface, onReroll } = p;
  const [menu, setMenu] = useState<Menu | null>(null);
  /** 正在改名的子星系(组主天体下标) */
  const [editGroup, setEditGroup] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const stars = resolveStarCount(params);
  const rocky = spec.planets.filter((b) => b.design.kind !== 'gas');
  const gasy = spec.planets.filter((b) => b.design.kind === 'gas');
  /** 单一数据源:天体视图(名字/类型) */
  const bodyViews = useMemo(() => {
    if (!sys) return null;
    try {
      return new Map(buildBodyViews(sys, { names: overrides.bodyNames ?? null, defaultNames: { planets: names.planets, moons: names.moons as Record<number, string[]> } }).map((v) => [v.id, v]));
    } catch {
      return null;
    }
  }, [sys, overrides.bodyNames, names]);
  const viewOf = (id: string): BodyView | null => bodyViews?.get(id) ?? null;
  const counts = { planets: rocky.length, gas: gasy.length, moons: Object.fromEntries(spec.planets.map((b) => [b.index, b.moons.length])) };
  const groups = subSystemGroupsOf({
    design: {
      planets: spec.planets.map((b) => ({ index: b.index, kind: b.design.kind, moons: b.moons })),
      home: { index: spec.home },
      binary: spec.binary ? { index: spec.binary.index } : undefined,
      habitableMoon: spec.habitableMoon ? { parent: spec.habitableMoon.parent, index: spec.habitableMoon.index } : undefined,
    },
    planetNames: names.planets,
    overrides,
  });

  const openMenu = (e: React.MouseEvent, title: string, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, title, items });
  };
  const run = (fn: () => void) => {
    fn();
    setMenu(null);
  };
  const startRenameGroup = (g: SubSystemGroup) => {
    setEditGroup(g.key);
    setEditText(overrides.bodyNames?.groups?.[String(g.key)] ?? g.name.replace(/系$/, ''));
  };
  const commitGroupRename = () => {
    if (editGroup === null) return;
    onChange(renameGroup(overrides, editGroup, editText));
    setEditGroup(null);
  };

  const planetNode = (index: number) => {
    const b = spec.planets[index];
    if (!b) return null;
    return (
      <div key={`p-${index}`}>
        <button
          className="ov-btn"
          data-act={`tree-node-planet-${index}`}
          onClick={() => onSel({ kind: 'planet', i: index })}
          onContextMenu={(e) =>
            openMenu(e, `${viewOf('p' + index)?.name ?? names.planets[index] ?? `行星 ${index + 1}`}`, [
              {
                label: '设为主行星',
                on: index === spec.home && params.homeMoon === undefined,
                run: () => {
                  onChange({ ...overrides, planets: setHome(overrides, index) });
                  onParams({ home: index + 1, homeMoon: undefined });
                },
              },
              { label: '改名…', run: () => onRename({ kind: 'planet', i: index }) },
              {
                label: '加一颗卫星',
                run: () => onChange({ ...overrides, planets: setMoonCount(overrides, index, (spec.planets[index]?.moons.length ?? 0) + 1) }),
              },
              {
                label: '复制这颗行星',
                run: () => {
                  const isGas = spec.planets[index]?.design.kind === 'gas';
                  onParams(setBodyCount(isGas ? 'gas' : 'rocky', (isGas ? counts.gas : counts.planets) + 1));
                  const src = overrides.planets.find((x) => x.index === index);
                  const nextIndex = isGas ? counts.gas + counts.planets : counts.planets;
                  if (src) {
                    const copy = { ...src, index: nextIndex, home: false };
                    onChange({ ...overrides, planets: [...overrides.planets.filter((x) => x.index !== nextIndex), copy].sort((a, b) => a.index - b.index) });
                  }
                },
              },
              { label: '换一颗', sep: true, run: () => onReroll(index) },
              { label: '改地形', run: () => onTerrain(index) },
              { label: '改地表', run: () => onSurface(index) },
              {
                label: '删除这颗行星',
                sep: true,
                run: () => {
                  const r = deleteNode(params, overrides, { kind: 'planet', index, bodyKind: b.design.kind === 'gas' ? 'gas' : 'rocky' }, counts);
                  if (r.refused) {
                    window.alert(r.refused);
                    return;
                  }
                  onParams(r.params);
                  onChange(r.overrides);
                },
              },
            ])
          }
          title="左键看属性；右键改结构"
          style={{ display: 'block', width: 'calc(100% - 14px)', marginLeft: 14, textAlign: 'left', marginBottom: 3, ...(sel.kind === 'planet' && sel.i === index ? { borderColor: '#5fa85f', color: '#5fa85f' } : {}) }}
        >
          {index === spec.home ? '★ ' : '· '}
          {names.planets[index] ?? `行星 ${index + 1}`}
          <span style={{ opacity: 0.5 }}> {viewOf('p' + index)?.typeLabel ?? PLANET_TYPE_NAME[planetTypeOf(b.design)]}</span>
          {(() => {
            const v = viewOf('p' + index);
            if (!v) return null;
            return (
              <span style={{ opacity: 0.42, fontSize: 10.5 }}>
                {' '}a={v.orbit.a?.toFixed(2)}AU · {(v.orbit.periodDays / 365.25).toFixed(2)}年
              </span>
            );
          })()}
        </button>
        {b.moons.map((m) => (
          <button
            key={`m-${index}-${m.moon}`}
            className="ov-btn"
            data-act={`tree-node-moon-${index}-${m.moon}`}
            onClick={() => onSel({ kind: 'moon', p: index, m: m.moon })}
            onContextMenu={(e) =>
              openMenu(e, moonName(names, index, m.moon), [
                { label: '设为宜居卫星', on: spec.habitableMoon?.index === index, run: () => onParams(setHabitableMoon(params, m.moon)) },
                { label: '设为主行星（宜居卫星系）', on: params.homeMoon === m.moon && params.home === index + 1, run: () => onParams({ home: index + 1, homeMoon: m.moon }) },
                { label: '改名…', run: () => onRename({ kind: 'moon', p: index, m: m.moon }) },
                {
                  label: '删除这颗卫星',
                  sep: true,
                  run: () => {
                    const r = deleteNode(params, overrides, { kind: 'moon', planet: index, moon: m.moon }, counts);
                    if (r.refused) {
                      window.alert(r.refused);
                      return;
                    }
                    onParams(r.params);
                    onChange(r.overrides);
                  },
                },
              ])
            }
            title="左键看属性；右键改结构"
            style={{ display: 'block', width: 'calc(100% - 28px)', marginLeft: 28, textAlign: 'left', marginBottom: 2, fontSize: 11.5, ...(sel.kind === 'moon' && sel.p === index && sel.m === m.moon ? { borderColor: '#5fa85f', color: '#5fa85f' } : {}) }}
          >
            {params.homeMoon === m.moon && params.home === index + 1 ? '★ ' : '↳ '}
{viewOf('m' + index + '-' + m.moon)?.name ?? moonName(names, index, m.moon)}
          {(() => {
            const v = viewOf('m' + index + '-' + m.moon);
            if (!v) return null;
            return (
              <span style={{ opacity: 0.42, fontSize: 10.5 }}>
                {' '}{v.orbit.distanceR?.toFixed(1)}R母 · {v.orbit.periodDays < 1 ? (v.orbit.periodDays * 24).toFixed(1) + '时' : v.orbit.periodDays.toFixed(1) + '天'}
              </span>
            );
          })()}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: '100%' }} onClick={() => menu && setMenu(null)} onContextMenu={(e) => { e.preventDefault(); const add = (role: 'planet' | 'binaryPair' | 'gasSystem' | 'habitableMoonSystem', label: string) => {  const used = new Set((overrides.groups ?? []).flatMap((x) => x.members));  const free = spec.planets.map((b) => b.index).find((k) => !used.has(k));  const wantGas = role === 'gasSystem' || role === 'habitableMoonSystem';  let idx: number | undefined = free;  if (idx === undefined) {   const cur = wantGas ? counts.gas : counts.planets;   const max = wantGas ? 4 : 6;   if (cur >= max) { e.preventDefault(); window.alert('行星数到上限了'); return null; }   idx = cur;   onParams(setBodyCount(wantGas ? 'gas' : 'rocky', cur + 1));  }  return { label, run: () => onChange(addGroup(overrides, role, [idx as number])) }; }; const items = ([  add('planet', '加子星系:单行星系'),  add('binaryPair', '加子星系:双固态行星系'),  add('gasSystem', '加子星系:气态母行星系'),  add('habitableMoonSystem', '加子星系:宜居卫星系'), ] as const).filter(Boolean) as { label: string; run: () => void }[]; if (items.length) openMenu(e, '星系树(空白处)', items); }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '2px 0 6px', fontSize: 12, color: 'rgba(30,30,40,0.65)' }} data-act="tree-head">
        <span>星系树</span>
      </div>

      <button
        className="ov-btn"
        data-act="tree-node-star"
        onClick={() => onSel({ kind: 'star' })}
        onContextMenu={(e) =>
          openMenu(e, '恒星', [
            { label: '单星', on: stars === 1, run: () => onParams(applyStarCount(params, 1)) },
            { label: '双恒星（伴星）', on: stars === 2, run: () => onParams(applyStarCount(params, 2)) },
            { label: '整系重掷', sep: true, run: () => onParams({ salt: (Math.round(params.salt) % 999) + 1 }) },
            { label: '恢复默认（清空覆盖表）', run: () => onChange({ planets: [], moons: [], bodyNames: undefined }) },
          ])
        }
        title="左键看属性；右键改恒星数量"
        style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4, ...(sel.kind === 'star' ? { borderColor: '#5fa85f', color: '#5fa85f' } : {}) }}
      >
        ☀ {names.star} <span style={{ opacity: 0.55 }}>· {stars === 2 ? '双恒星' : '单星'}</span>
      </button>

      {stars === 2 && (
        <button
          className="ov-btn"
          data-act="tree-node-companion"
          onClick={() => onSel({ kind: 'companion' })}
          onContextMenu={(e) => openMenu(e, '伴星', [{ label: '去掉伴星（回到单星）', run: () => onParams(applyStarCount(params, 1)) }])}
          title="左键看伴星属性；右键去掉伴星"
          style={{ display: 'block', width: 'calc(100% - 14px)', marginLeft: 14, textAlign: 'left', marginBottom: 4, fontSize: 11.5, ...(sel.kind === 'companion' ? { borderColor: '#5fa85f', color: '#5fa85f' } : {}) }}
        >
          ✦ 伴星
        </button>
      )}

      {groups.map((g) => (
        <div key={`g-${g.key}`} style={{ marginTop: 4 }} data-act={`tree-group-${g.key}`}>
          {editGroup === g.key ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
              <input
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitGroupRename();
                  if (e.key === 'Escape') setEditGroup(null);
                }}
                onBlur={commitGroupRename}
                aria-label="子星系组名"
                data-act="tree-group-rename-input"
                style={{ flex: 1, fontSize: 12, padding: '1px 4px', border: '1px solid rgba(60,60,67,0.25)', borderRadius: 4 }}
              />
              <span style={{ fontSize: 11, opacity: 0.55 }}>回车确定</span>
            </div>
          ) : (
            <button
              className="ov-btn"
              data-act={`tree-group-name-${g.key}`}
              onClick={() => onSel({ kind: 'star' })}
              onContextMenu={(e) =>
                openMenu(e, `子星系：${g.name}`, [
                  { label: '改名…', run: () => startRenameGroup(g) },
                  {
                    label: '设为本星系主行星系',
                    on: g.planets.includes(spec.home),
                    run: () => {
                      const target = g.planets.find((i) => spec.planets[i]?.design.kind === 'rocky') ?? g.planets[0];
                      onParams({ home: target + 1 });
                    },
                  },
                  ...(g.id === undefined
                    ? [{ label: '把这个子星系变成可编辑(显式成员)', run: () => onChange(addGroup(overrides, g.role, g.planets)) }]
                    : [
                        {
                          label: '加一颗行星到这个子星系',
                          run: () => {
                            const wantGas = g.role === 'gasSystem' || g.role === 'habitableMoonSystem';
                            const max = wantGas ? 4 : 6;
                            const cur = wantGas ? counts.gas : counts.planets;
                            if (cur >= max) {
                              window.alert('这个子星系的行星数已到上限(' + max + ')');
                              return;
                            }
                            onParams(setBodyCount(wantGas ? 'gas' : 'rocky', cur + 1));
                            onChange(addGroupMember(overrides, g.id!, cur));
                          },
                        },
                        { label: '删掉这个子星系', sep: true, run: () => onChange(deleteGroup(overrides, g.id!)) },
                      ]),
                  { label: `当前类型：${GROUP_ROLE_NAME[g.role]}`, run: () => undefined },
                  {
                    label: '改为：单行星系',
                    on: g.role === 'planet',
                    run: () => {
                      onParams(applySubSystem(params, 0));
                      onChange(clearRoles(overrides, g.planets));
                    },
                  },
                  {
                    label: '改为：双固态行星系',
                    on: g.role === 'binaryPair',
                    run: () => {
                      const rocky = g.planets.filter((x) => spec.planets[x]?.design.kind !== 'gas');
                      if (rocky.length < 2) {
                        window.alert('双固态行星系要两颗固态行星：先给这个子星系加一颗固态行星');
                        return;
                      }
                      onParams(applySubSystem(params, 1));
                    },
                  },
                  {
                    label: '改为：气态巨星的宜居卫星系',
                    on: g.role === 'habitableMoonSystem',
                    run: () => {
                      const gas = g.planets.find((x) => spec.planets[x]?.design.kind === 'gas');
                      if (gas === undefined) {
                        window.alert('宜居卫星系要一颗气态母行星：先把某颗行星的类型改成气态巨行星');
                        return;
                      }
                      onParams(applySubSystem(params, 3));
                    },
                  },
                ])
              }
              title="右键改子星系名 / 设为主行星系"
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 2, fontSize: 12, opacity: 0.92 }}
            >
              {GROUP_ICON[g.role]} {g.name}
            </button>
          )}
          {g.planets.map((i) => planetNode(i))}
        </div>
      ))}

      {/* 空白区:右键打开"加子星系"菜单 */}
      <div
        data-act="tree-blank-zone"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const add = (role: 'planet' | 'binaryPair' | 'gasSystem' | 'habitableMoonSystem', label: string) => {
            const used = new Set((overrides.groups ?? []).flatMap((x) => x.members));
            const free = spec.planets.map((b) => b.index).find((k) => !used.has(k));
            const wantGas = role === 'gasSystem' || role === 'habitableMoonSystem';
            let idx: number | undefined = free;
            if (idx === undefined) {
              const curN = wantGas ? counts.gas : counts.planets;
              const max = wantGas ? 4 : 6;
              if (curN >= max) return { label: label + '(已满)', run: () => window.alert('行星数到上限了') };
              idx = curN;
              return { label, run: () => { onParams(setBodyCount(wantGas ? 'gas' : 'rocky', curN + 1)); onChange(addGroup(overrides, role, [curN])); } };
            }
            return { label, run: () => onChange(addGroup(overrides, role, [idx as number])) };
          };
          openMenu(e, '星系树(空白处)', [add('planet', '加子星系:单行星系'), add('binaryPair', '加子星系:双固态行星系'), add('gasSystem', '加子星系:气态母行星系'), add('habitableMoonSystem', '加子星系:宜居卫星系')]);
        }}
        style={{ flex: 1, minHeight: 160, marginTop: 6, borderTop: '1px dashed rgba(120,130,150,0.25)', fontSize: 11, opacity: 0.55, paddingTop: 4, cursor: 'context-menu' }}
      >
        空白处右键 → 加子星系
      </div>
      {menu && (
        <>
          <div data-act="tree-menu-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 70 }} onPointerDown={() => setMenu(null)} />
          <div
            data-act="tree-menu"
            style={{ position: 'fixed', left: Math.min(menu.x, (typeof innerWidth === 'number' ? innerWidth : 1200) - 220), top: Math.min(menu.y, (typeof innerHeight === 'number' ? innerHeight : 800) - 40 - menu.items.length * 26), zIndex: 71, minWidth: 176, padding: 4, borderRadius: 8, background: '#fffdf8', border: '1px solid rgba(60,60,67,0.22)', boxShadow: '0 10px 30px rgba(0,0,0,0.22)', color: '#1d1d1f', fontSize: 12.5 }}
          >
            <div style={{ padding: '3px 8px 5px', fontSize: 11, opacity: 0.55 }}>{menu.title}</div>
            {menu.items.map((it, k) => (
              <div key={k}>
                {it.sep && <div style={{ height: 1, background: 'rgba(60,60,67,0.14)', margin: '3px 6px' }} />}
                <button
                  className="ov-btn"
                  data-act={`tree-menu-item-${k}`}
                  onClick={() => run(it.run)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', fontSize: 12.5, background: 'none', border: 0, ...(it.on ? { color: '#2f7a4a', fontWeight: 600 } : {}) }}
                >
                  {it.on ? '● ' : '　'}
                  {it.label}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 设为主行星(只改覆盖表) */
function setHome(o: SystemOverrides, index: number): SystemOverrides['planets'] {
  return o.planets.map((x) => (x.index === index ? { ...x, home: true } : x.home ? { ...x, home: undefined } : x));
}

/** 给某颗行星设卫星数 */
function setMoonCount(o: SystemOverrides, index: number, n: number): SystemOverrides['planets'] {
  const cur = o.planets.find((x) => x.index === index) ?? { index };
  const next = { ...cur, moonCount: Math.max(0, Math.min(12, n)) };
  const rest = o.planets.filter((x) => x.index !== index);
  return [...rest, next].sort((a, b) => a.index - b.index);
}


/** 把一组行星的角色覆盖清掉(改回「单行星系」时用) */
function clearRoles(o: SystemOverrides, planets: readonly number[]): SystemOverrides {
  return { ...o, planets: o.planets.map((x) => (planets.includes(x.index) ? { ...x, role: undefined } : x)) };
}