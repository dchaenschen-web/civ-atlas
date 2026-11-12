/**
 * 技术路线页:现实 / 魔法 / 修真三条路线各自的时代链。
 *
 * 现在只是把路线单独拎出来(以前挤在星球系页里):同一套推演引擎,路线只换时代链的名字与门槛。
 * 以后细化(魔法/修真真正接进 development 的时代门槛、资源与事件)会在这页上加。
 */
import { useMemo } from 'react';
import type { World } from '../gen/world';
import { techPackOf } from '../gen/techPack';

const box: React.CSSProperties = { border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8, padding: '10px 12px', marginTop: 10 };
const title: React.CSSProperties = { fontWeight: 600, marginBottom: 6 };
const muted: React.CSSProperties = { opacity: 0.7, fontSize: 12.5, lineHeight: 1.6 };

export function TechPage({ world }: { world: World | null }) {
  const tech = useMemo(() => (world ? techPackOf(world.params) : null), [world]);
  if (!tech) return <div style={muted}>这个页面要开了星球系、有历史的世界才能看。</div>;
  return (
    <div style={{ padding: '2px 2px 12px' }}>
      <div style={{ ...title, fontSize: 15 }}>技术路线 · {tech.name}</div>
      <div style={muted}>{tech.desc}</div>
      <div style={box}>
        <div style={title}>时代链</div>
        {tech.eras.map((e, i) => (
          <div key={e.name} style={{ display: 'flex', gap: 10, padding: '3px 0', ...muted }}>
            <span style={{ width: 28, opacity: 0.6 }}>{i + 1}</span>
            <span style={{ width: 96 }}>{e.name}</span>
            <span style={{ opacity: 0.75 }}>{e.need === '—' ? '起点' : `需要:${e.need}`}</span>
          </div>
        ))}
      </div>
      <div style={{ ...muted, marginTop: 10 }}>
        路线只换时代链的名字与门槛,推演骨架(立国、战争、灾荒……)不变。魔法 / 修真要真正影响资源、造物与事件,是后续版本的事。
      </div>
    </div>
  );
}
