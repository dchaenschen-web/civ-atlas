/**
 * 插件提的「改你写的东西」:改名、加标记、下干预。一次调用的整批先套在现在的修改上算好,有一条不合格整批不改;
 * 合格的由网站照办,整批记一步撤销。查的只是改完的世界能存、能打开,不替用的人判断改得对不对。
 */
import type { Civ } from '../gen/civ/types';
import {
  cleanIntervention,
  cleanMark,
  cleanName,
  markAiName,
  markRegionTotal,
  MARK_REGIONS_TOTAL,
  MARKS_MAX,
  nextMarkId,
  resolveKey,
  type AuthorMark,
  type Intervention,
  type WorldEdits,
} from '../gen/edits';
import { makeSave, saveText, SAVE_MAX_BYTES } from '../gen/savefile';
import { currentSystem } from '../gen/systemState';
import type { WorldParams } from '../gen/world';
import { argsOf, bad, isRec, list, over, PluginApiError } from './check';
import { approxBytes } from './protocol';
import type { ApplyResult } from './types';

/** 一次最多提几条 */
export const CHANGES_MAX = 200;
/** 一条最大多少字节(估的;最大的是圈满州的标记):同一个大数组可以被很多条引用,先挡住再清理 */
const CHANGE_MAX_BYTES = 64 * 1024;
/** 插件改完以后干预、改名最多几条 */
export const PLUGIN_INTERVENTIONS_MAX = 10_000;
export const PLUGIN_NAMES_MAX = 20_000;
/** 存档里修改以外的东西(校验、世界名、视角、出处)留的地方 */
const SAVE_ROOM = 64 * 1024;

export interface PlannedChanges {
  next: WorldEdits;
  result: ApplyResult;
  /** 这批碰到的稳定键(网站那边看现在能不能改) */
  keys: string[];
}

function needCiv(civ: Civ | null): Civ {
  if (!civ) throw new PluginApiError('unavailable', '这个世界还没有历史,改名、下干预要等历史推出来');
  return civ;
}

/** 一条干预点到的键(国家、对方、城、州、民族) */
function ivKeys(v: Intervention): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === 'string' && /^(polity|region|settlement|culture|person):/.test(x)) out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
  };
  for (const val of Object.values(v)) walk(val);
  return out;
}

/** 整批算好;不合格抛 PluginApiError(bad-args / limit / unavailable)。params = 这个世界的参数(量改完以后的存档有多大) */
export function planChanges(edits: WorldEdits, civ: Civ | null, raw: unknown, params: WorldParams): PlannedChanges {
  const changes = list(argsOf(raw).changes, 'changes', CHANGES_MAX);
  let names = edits.names;
  let aiNames = edits.aiNames;
  let interventions = edits.interventions;
  let marks = edits.marks ?? [];
  const keys: string[] = [];
  const result: ApplyResult = { applied: 0, skipped: 0, marks: [] };
  changes.forEach((c, i) => {
    const at = `changes[${i}]`;
    if (!isRec(c)) return bad(`${at} 要是对象`);
    if (approxBytes(c, CHANGE_MAX_BYTES) > CHANGE_MAX_BYTES) over(`${at} 太大`);
    if (c.kind === 'name') {
      const h = needCiv(civ);
      const key = c.key;
      const r = typeof key === 'string' ? resolveKey(h, key) : null;
      if (!r || typeof key !== 'string') return bad(`${at}.key 在这个世界里找不到`);
      if (c.name !== null && typeof c.name !== 'string') return bad(`${at}.name 要是字或 null(null = 恢复原名)`);
      const eastern = (r.kind === 'polity' || r.kind === 'dynasty') && !!h.polities[r.id]?.eastern;
      const name = c.name === null ? '' : cleanName(r.kind, c.name, eastern);
      if ((names[key] ?? '') === name) {
        result.skipped++;
        return;
      }
      if (names === edits.names) names = { ...names };
      if (name) names[key] = name;
      else delete names[key];
      aiNames = markAiName({ ...edits, names, aiNames }, key, name || null, false);
      keys.push(key);
    } else if (c.kind === 'mark') {
      if (marks.length >= MARKS_MAX) over(`标记最多 ${MARKS_MAX} 个`);
      const id = nextMarkId(marks);
      const m = isRec(c.mark) ? cleanMark({ ...c.mark, id }) : null;
      if (!m) return bad(`${at}.mark 不是合格的标记(要有 from 年份,at 一个点或 regions 几个州)`);
      if (m.regions && markRegionTotal(marks) + m.regions.length > MARK_REGIONS_TOTAL) over(`所有标记一共最多圈 ${MARK_REGIONS_TOTAL} 个州`);
      marks = [...marks, m as AuthorMark];
      result.marks.push(id);
    } else if (c.kind === 'intervention') {
      needCiv(civ);
      // plot、guide 是照大纲推演自己记的,插件下的就是作者自己下的
      const { plot: _p, guide: _g, ...plain } = isRec(c.v) ? c.v : {};
      const v = isRec(c.v) ? cleanIntervention(plain) : null;
      if (!v) return bad(`${at}.v 不是合格的干预`);
      const k = JSON.stringify(v);
      if (interventions.some((x) => JSON.stringify(x) === k)) {
        result.skipped++;
        return;
      }
      if (interventions.length >= PLUGIN_INTERVENTIONS_MAX) over(`干预最多 ${PLUGIN_INTERVENTIONS_MAX} 条`);
      interventions = [...interventions, v];
      keys.push(...ivKeys(v));
    } else return bad(`${at}.kind 只能是 name、mark、intervention`);
    result.applied++;
  });
  if (names !== edits.names && Object.keys(names).length > PLUGIN_NAMES_MAX) over(`改名最多 ${PLUGIN_NAMES_MAX} 个`);
  if (!result.applied) return { next: edits, result, keys };
  const next: WorldEdits = { ...edits, names, interventions };
  if (aiNames) next.aiNames = aiNames;
  else delete next.aiNames;
  if (marks.length) next.marks = marks;
  if (saveText(makeSave(params, next, '', undefined, undefined, undefined, undefined, currentSystem())).length > SAVE_MAX_BYTES - SAVE_ROOM) over('改完以后存档太大,存不下');
  return { next, result, keys };
}
