/**
 * 行星缩略图的后台线程:生成地表 + 上色都在这里算,主线程只收一张 RGBA。
 * 消息:{ id, input: PlanetVizInput } → { id, ok, out? , error? }
 */
import { planetViz, type PlanetVizInput, type PlanetVizOut } from './planetViz';

interface Req {
  id: number;
  input: PlanetVizInput;
}

self.onmessage = (ev: MessageEvent<Req>) => {
  const { id, input } = ev.data;
  try {
    const out: PlanetVizOut = planetViz(input);
    (self as unknown as { postMessage(m: unknown, t?: Transferable[]): void }).postMessage({ id, ok: true, out }, [out.px.buffer]);
  } catch (err) {
    (self as unknown as { postMessage(m: unknown): void }).postMessage({ id, ok: false, error: String(err) });
  }
};
