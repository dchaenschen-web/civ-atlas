import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../src/gen/util';
import { crc32, parseZip as parseAt, readZip as readAt, writeZip as writeAt, ZIP_LOCAL_MAX_BYTES, ZIP_MAX_ENTRIES, type ZipEntry, type ZipInput } from '../src/gen/zipStore';

/** 上限由调用方传;这里的测试都按上传的上限(最严的),本机的上限在「上限由调用方定」里单独试 */
const ZIP_MAX_BYTES = 64e6;
const parseZip = (b: Uint8Array) => parseAt(b, ZIP_MAX_BYTES);
const readZip = (b: Blob) => readAt(b, ZIP_MAX_BYTES);
const writeZip = (e: readonly ZipInput[]) => writeAt(e, ZIP_MAX_BYTES);

const text =(s: string) => new TextEncoder().encode(s);
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-store-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
/** 这台机器上有没有这个软件(CI 和各人电脑上不一定都有) */
const has = (cmd: string) => spawnSync(cmd, ['--help'], { stdio: 'ignore' }).error === undefined;
/** zip 真的能按这里的用法打出一个包吗(本机 MiKTeX 自带的那份 zip 会失败,不能只看有没有这个命令) */
const zipWorks = (() => {
  if (!has('zip')) return false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-probe-'));
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  const r = spawnSync('zip', ['-0', '-q', path.join(dir, 'x.zip'), 'x.txt'], { cwd: dir });
  return r.status === 0;
})();

const SAMPLE = [
  { name: 'manifest.json', data: text('{"kind":"world"}') },
  { name: 'parts/地图.gz', data: new Uint8Array(4096).map((_, i) => i & 0xff) },
  { name: 'parts/空的', data: new Uint8Array(0) },
];

/**
 * 手工拼一个 ZIP:默认拼出来是合格的,各项可以单独改掉,造各种坏文件。
 * local、central 里的项只改条目自己的头或者目录那一边;都不给的项两边一样
 */
interface Forge {
  name?: string | Uint8Array;
  data?: Uint8Array;
  flags?: number;
  method?: number;
  crc?: number;
  /** 压缩后的大小 */
  packed?: number;
  size?: number;
  extra?: Uint8Array;
  /** 目录里写的条目位置(不给 = 实际的位置) */
  at?: number;
  /** 写不写进文件(目录照写):造几个条目指同一段字节 */
  noBody?: boolean;
  local?: Partial<Pick<Forge, 'name' | 'flags' | 'method' | 'crc' | 'packed' | 'size' | 'extra'>>;
}
function forge(items: Forge[], end: { count?: number; disk?: number; comment?: number; centralAt?: number; centralSize?: number; extraAtEnd?: Uint8Array } = {}): Uint8Array {
  const out: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  let realAt = 0;
  const fields = (f: Forge) => {
    const nameBytes = typeof f.name === 'string' ? text(f.name) : (f.name ?? text('a'));
    const data = f.data ?? text('hello');
    return { nameBytes, extra: f.extra ?? new Uint8Array(0), flags: f.flags ?? 0x0800, method: f.method ?? 0, crc: f.crc ?? crc32(data), packed: f.packed ?? data.length, size: f.size ?? data.length, data };
  };
  for (const item of items) {
    const c = fields(item);
    const l = fields({ ...item, ...item.local });
    const local = new Uint8Array(30 + l.nameBytes.length + l.extra.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 10, true);
    lv.setUint16(6, l.flags, true);
    lv.setUint16(8, l.method, true);
    lv.setUint32(14, l.crc, true);
    lv.setUint32(18, l.packed, true);
    lv.setUint32(22, l.size, true);
    lv.setUint16(26, l.nameBytes.length, true);
    lv.setUint16(28, l.extra.length, true);
    local.set(l.nameBytes, 30);
    local.set(l.extra, 30 + l.nameBytes.length);
    const head = new Uint8Array(46 + c.nameBytes.length + c.extra.length);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 10, true);
    cv.setUint16(6, 10, true);
    cv.setUint16(8, c.flags, true);
    cv.setUint16(10, c.method, true);
    cv.setUint32(16, c.crc, true);
    cv.setUint32(20, c.packed, true);
    cv.setUint32(24, c.size, true);
    cv.setUint16(28, c.nameBytes.length, true);
    cv.setUint16(30, c.extra.length, true);
    cv.setUint32(42, item.at ?? realAt, true);
    head.set(c.nameBytes, 46);
    head.set(c.extra, 46 + c.nameBytes.length);
    central.push(head);
    if (!item.noBody) {
      out.push(local, c.data);
      realAt += local.length + c.data.length;
    }
    at = realAt;
  }
  const centralSize = central.reduce((n, h) => n + h.length, 0);
  const tail = new Uint8Array(22);
  const v = new DataView(tail.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(4, end.disk ?? 0, true);
  v.setUint16(8, end.count ?? items.length, true);
  v.setUint16(10, end.count ?? items.length, true);
  v.setUint32(12, end.centralSize ?? centralSize, true);
  v.setUint32(16, end.centralAt ?? at, true);
  v.setUint16(20, end.comment ?? 0, true);
  const all = [...out, ...central, ...(end.extraAtEnd ? [end.extraAtEnd] : []), tail];
  const r = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    r.set(p, o);
    o += p.length;
  }
  return r;
}

describe('ZIP:写', () => {
  it('CRC-32 算得对,分段算和一次算一样', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(text('56789'), crc32(text('1234')))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('写的读得回来:中文文件名、空文件、三种字节来源', async () => {
    const buf = text('来自 ArrayBuffer').slice().buffer as ArrayBuffer;
    const blob = new Blob([text('来自 '), text('Blob')]);
    const zip = await writeZip([...SAMPLE, { name: 'b.bin', data: buf }, { name: 'c.bin', data: blob }]);
    expect(zip.size).toBeGreaterThan(4096);
    const back = await readZip(zip);
    expect(back.map((e) => e.name)).toEqual(['manifest.json', 'parts/地图.gz', 'parts/空的', 'b.bin', 'c.bin']);
    for (let i = 0; i < SAMPLE.length; i++) expect(back[i].data).toEqual(SAMPLE[i].data);
    expect(new TextDecoder().decode(back[3].data)).toBe('来自 ArrayBuffer');
    expect(new TextDecoder().decode(back[4].data)).toBe('来自 Blob');
    expect(parseZip(await bytesOf(await writeZip([])))).toEqual([]);
  });

  it('同样的内容打出同样的字节', async () => {
    const a = await bytesOf(await writeZip(SAMPLE));
    const b = await bytesOf(await writeZip(SAMPLE));
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('用 Blob 拼接:写的时候不把字节读成一整块', async () => {
    const big = new Blob([new Uint8Array(1 << 20)]);
    const spy = vi.spyOn(Blob.prototype, 'arrayBuffer');
    const zip = await writeZip([{ name: 'big.bin', data: big }]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await readZip(zip))[0].data.length).toBe(1 << 20);
  });

  it('不写自己读不回来的:名字不合规矩、重复、超上限', async () => {
    const one = text('x');
    for (const name of ['', '../a', 'a/../b', '/a', 'a\\b', 'C:/a', 'a/', 'a//b', './a', 'a.', 'a ', 'dir./a', 'dir /a', 'a\u0001', '\ud800']) await expect(writeZip([{ name, data: one }]), JSON.stringify(name)).rejects.toThrow();
    await expect(
      writeZip([
        { name: 'a', data: one },
        { name: 'a', data: one },
      ]),
    ).rejects.toThrow();
    await expect(
      writeZip([
        { name: 'Parts/A', data: one },
        { name: 'parts/a', data: one },
      ]),
    ).rejects.toThrow();
    // 同一个字的两种 Unicode 写法
    await expect(
      writeZip([
        { name: '\u00e9', data: one },
        { name: 'e\u0301', data: one },
      ]),
    ).rejects.toThrow();
    // 既当文件又当目录:解压时后一个放不下
    await expect(
      writeZip([
        { name: 'parts', data: one },
        { name: 'parts/map.gz', data: one },
      ]),
    ).rejects.toThrow('撞了');
    await expect(writeZip([{ name: 'a'.repeat(256), data: one }])).rejects.toThrow('太长');
    await expect(writeZip([{ name: 'big', data: new Blob([new Uint8Array(ZIP_MAX_BYTES + 1)]) }])).rejects.toThrow();
    await expect(writeZip([{ name: 'full', data: new Blob([new Uint8Array(ZIP_MAX_BYTES)]) }])).rejects.toThrow();
    await expect(writeZip(Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}`, data: one })))).rejects.toThrow();
  });
});

describe('ZIP:上限由调用方定', () => {
  const big = new Blob([new Uint8Array(ZIP_MAX_BYTES)]);

  it('超过上传上限的文件:传不上去,本机照样能存能读', async () => {
    await expect(writeAt([{ name: 'big', data: big }], ZIP_MAX_BYTES)).rejects.toThrow('太大');
    const local = await writeAt([{ name: 'big', data: big }], ZIP_LOCAL_MAX_BYTES);
    expect(local.size).toBeGreaterThan(ZIP_MAX_BYTES);
    await expect(readAt(local, ZIP_MAX_BYTES)).rejects.toThrow('太大');
    expect(() => parseAt(new Uint8Array(ZIP_MAX_BYTES + 1), ZIP_MAX_BYTES)).toThrow('太大');
    const back = await readAt(local, ZIP_LOCAL_MAX_BYTES);
    expect(back[0].data.length).toBe(ZIP_MAX_BYTES);
  });

  it('本机也有上限:打开别人的文件时大小不读进内存就拒绝', async () => {
    const spy = vi.spyOn(Blob.prototype, 'arrayBuffer');
    await expect(readAt(new Blob([new Uint8Array(1025)]), 1024)).rejects.toThrow('太大');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    await expect(writeAt([{ name: 'a', data: new Uint8Array(1025) }], 1024)).rejects.toThrow('太大');
  });

  it('上限本身不对(不是数、超过 32 位 ZIP 放得下的)就报错,不当没有上限', async () => {
    for (const max of [NaN, Infinity, -1, 1.5, 2 ** 32]) {
      expect(() => parseAt(new Uint8Array(0), max), String(max)).toThrow('上限不对');
      await expect(readAt(new Blob([]), max), String(max)).rejects.toThrow('上限不对');
      await expect(writeAt([], max), String(max)).rejects.toThrow('上限不对');
    }
  });
});

describe('ZIP:别的软件', () => {
  it.skipIf(!has('unzip'))('写出来的 unzip -t 全过,解出来的内容一样', async () => {
    const file = path.join(tmp, '世界.zip');
    fs.writeFileSync(file, await bytesOf(await writeZip(SAMPLE)));
    const t = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
    expect(t.status, t.stdout + t.stderr).toBe(0);
    expect(t.stdout).toContain('No errors detected');
    const p = spawnSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' });
    expect(p.stdout).toBe('{"kind":"world"}');
  });

  it.skipIf(!has('python3'))('Python 的 zipfile 读得到中文文件名和内容;它写的不压缩包也读得回来,写的压缩包不认', async () => {
    const file = path.join(tmp, 'for-python.zip');
    fs.writeFileSync(file, await bytesOf(await writeZip(SAMPLE)));
    const script = `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps([[i.filename, i.compress_type, len(z.read(i))] for i in z.infolist()]))
for path, kind in ((sys.argv[2], zipfile.ZIP_STORED), (sys.argv[3], zipfile.ZIP_DEFLATED)):
    with zipfile.ZipFile(path, 'w', kind) as out:
        out.writestr('manifest.json', '{"kind":"world"}' * 10)
        out.writestr('parts/地图.gz', b'123' * 10)
`;
    const stored = path.join(tmp, 'py-stored.zip');
    const deflated = path.join(tmp, 'py-deflated.zip');
    const r = spawnSync('python3', ['-I', '-c', script, file, stored, deflated], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([
      ['manifest.json', 0, 16],
      ['parts/地图.gz', 0, 4096],
      ['parts/空的', 0, 0],
    ]);
    const back = parseZip(new Uint8Array(fs.readFileSync(stored)));
    expect(back.map((e) => e.name)).toEqual(['manifest.json', 'parts/地图.gz']);
    expect(new TextDecoder().decode(back[1].data)).toBe('123'.repeat(10));
    expect(() => parseZip(new Uint8Array(fs.readFileSync(deflated)))).toThrow('不压缩');
  });

  it.skipIf(!zipWorks)('zip -0 打的(带额外字段)读得回来', () => {
    fs.writeFileSync(path.join(tmp, 'plain.txt'), 'hello zip');
    const file = path.join(tmp, 'by-zip.zip');
    const r = spawnSync('zip', ['-0', '-q', file, 'plain.txt'], { cwd: tmp });
    expect(r.status).toBe(0);
    const back = parseZip(new Uint8Array(fs.readFileSync(file)));
    expect(back[0].name).toBe('plain.txt');
    expect(new TextDecoder().decode(back[0].data)).toBe('hello zip');
  });
});

describe('ZIP:读的时候当它是坏文件', () => {
  it('手工拼的合格文件读得回来(下面的坏文件都是从它改的)', () => {
    const back = parseZip(forge([{ name: 'a', data: text('hello') }, { name: '中/文', data: text('x') }]));
    expect(back.map((e) => e.name)).toEqual(['a', '中/文']);
    expect(new TextDecoder().decode(back[0].data)).toBe('hello');
  });

  it('文件太大:不用读进内存就拒绝', async () => {
    expect(() => parseZip(new Uint8Array(ZIP_MAX_BYTES + 1))).toThrow('太大');
    const spy = vi.spyOn(Blob.prototype, 'arrayBuffer');
    await expect(readZip(new Blob([new Uint8Array(ZIP_MAX_BYTES + 1)]))).rejects.toThrow('太大');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('条目数超上限', () => {
    const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(0) }));
    expect(() => parseZip(forge(many))).toThrow('条目太多');
    expect(parseZip(forge(many.slice(1))).length).toBe(ZIP_MAX_ENTRIES);
  });

  it.each(['../x', 'a/../b', '..', '/etc/passwd', 'C:/x', 'C:\\x', 'a\\b', 'x/', 'a//b', './a', 'a/.', '.. /a', 'a.', 'a ', 'dir./a', 'dir /a', 'a\u0000b', 'a\nb', ''])('拒绝文件名 %j', (name) => {
    expect(() => parseZip(forge([{ name }]))).toThrow();
  });

  it('开头的点、中间的点和空格没事', () => {
    const names = ['.hidden', 'parts/map.gz', 'a b/c.d e'];
    expect(parseZip(forge(names.map((name) => ({ name })))).map((e) => e.name)).toEqual(names);
  });

  it('文件名不是 UTF-8:标了 UTF-8 但字节不对、没标却有非 ASCII', () => {
    expect(() => parseZip(forge([{ name: new Uint8Array([0xff, 0xfe, 0x61]) }]))).toThrow();
    expect(() => parseZip(forge([{ name: '中文', flags: 0 }]))).toThrow('不是 UTF-8');
    // 全是 ASCII 的不标也行(很多软件这么写)
    expect(parseZip(forge([{ name: 'ascii', flags: 0 }]))[0].name).toBe('ascii');
  });

  it('一个名字既当文件又当目录:先后不论、大小写不论;同一个目录下的几个文件没事', () => {
    expect(() => parseZip(forge([{ name: 'parts' }, { name: 'parts/map.gz' }]))).toThrow('撞了');
    expect(() => parseZip(forge([{ name: 'parts/map.gz' }, { name: 'parts' }]))).toThrow('撞了');
    expect(() => parseZip(forge([{ name: 'a/b' }, { name: 'A/B/c' }]))).toThrow('撞了');
    expect(parseZip(forge([{ name: 'parts/a' }, { name: 'parts/b' }, { name: 'parts/c/d' }, { name: 'partsx' }])).length).toBe(4);
  });

  it('文件名太长', () => {
    expect(parseZip(forge([{ name: 'a'.repeat(255) }]))[0].name.length).toBe(255);
    expect(() => parseZip(forge([{ name: 'a'.repeat(256) }]))).toThrow('太长');
  });

  it('重复条目:完全一样、只差大小写、只差 Unicode 写法', () => {
    expect(() => parseZip(forge([{ name: 'a' }, { name: 'a' }]))).toThrow('撞了');
    expect(() => parseZip(forge([{ name: 'Parts/A' }, { name: 'parts/a' }]))).toThrow('撞了');
    expect(() => parseZip(forge([{ name: '\u00e9' }, { name: 'e\u0301' }]))).toThrow('撞了');
  });

  it('加密:三种标记都拒绝', () => {
    for (const flags of [0x0801, 0x0840, 0x2800]) expect(() => parseZip(forge([{ flags }])), flags.toString(16)).toThrow('加密');
  });

  it('别的标记位(比如大小写在条目后面)认不出', () => {
    expect(() => parseZip(forge([{ flags: 0x0808 }]))).toThrow('标记位');
  });

  it('非「不压缩」的方式', () => {
    for (const method of [8, 12, 14, 93, 99]) expect(() => parseZip(forge([{ method }])), String(method)).toThrow('不压缩');
  });

  it('声明大小对不上:压缩前后不一样、比实际大、比实际小', () => {
    expect(() => parseZip(forge([{ size: 3 }]))).toThrow('大小对不上');
    expect(() => parseZip(forge([{ packed: 3 }]))).toThrow('大小对不上');
    expect(() => parseZip(forge([{ packed: 6, size: 6 }]))).toThrow();
    expect(() => parseZip(forge([{ packed: 4, size: 4 }]))).toThrow();
    expect(() => parseZip(forge([{ packed: 1e8, size: 1e8 }]))).toThrow();
  });

  it('CRC 对不上', () => {
    expect(() => parseZip(forge([{ crc: 12345 }]))).toThrow('校验');
    const ok = forge([{ name: 'a', data: text('hello') }]);
    ok[31] ^= 1;
    expect(() => parseZip(ok)).toThrow('校验');
  });

  it('ZIP64:结尾记录的三项、条目的三项、额外字段、定位记录', () => {
    expect(() => parseZip(forge([{}], { count: 0xffff }))).toThrow('ZIP64');
    expect(() => parseZip(forge([{}], { centralSize: 0xffffffff }))).toThrow('ZIP64');
    expect(() => parseZip(forge([{}], { centralAt: 0xffffffff }))).toThrow('ZIP64');
    expect(() => parseZip(forge([{ packed: 0xffffffff, size: 0xffffffff }]))).toThrow('ZIP64');
    expect(() => parseZip(forge([{ at: 0xffffffff }]))).toThrow('ZIP64');
    const z64 = new Uint8Array([1, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => parseZip(forge([{ extra: z64 }]))).toThrow('ZIP64');
    expect(() => parseZip(forge([{ local: { extra: z64 } }]))).toThrow('ZIP64');
    const locator = new Uint8Array(20);
    new DataView(locator.buffer).setUint32(0, 0x07064b50, true);
    expect(() => parseZip(forge([{}], { extraAtEnd: locator }))).toThrow('ZIP64');
  });

  it('额外字段长得不对', () => {
    expect(() => parseZip(forge([{ extra: new Uint8Array(3) }]))).toThrow('额外字段');
    expect(() => parseZip(forge([{ extra: new Uint8Array([9, 9, 200, 0]) }]))).toThrow('额外字段');
  });

  it('目录和条目自己的头说的不一样', () => {
    for (const local of [{ name: 'b' }, { flags: 0 }, { crc: 7 }, { packed: 4, size: 4 }]) expect(() => parseZip(forge([{ name: 'a', data: text('hello'), local }])), JSON.stringify(local)).toThrow();
    // 方式不一样:目录说不压缩,条目自己说压缩过
    expect(() => parseZip(forge([{ local: { method: 8 } }]))).toThrow('对不上');
  });

  it('条目重叠:一个条目的字节里藏几千个条目的头,都指同一大段字节,不用算校验就拒绝', () => {
    const big = new Uint8Array(32e6);
    const view = new DataView(big.buffer);
    const inner = Array.from({ length: ZIP_MAX_ENTRIES - 1 }, (_, i) => {
      const at = i * 64;
      const name = `f${i}`;
      const size = big.length - at - 30 - name.length;
      view.setUint32(at, 0x04034b50, true);
      view.setUint16(at + 6, 0x0800, true);
      view.setUint32(at + 14, 1, true);
      view.setUint32(at + 18, size, true);
      view.setUint32(at + 22, size, true);
      view.setUint16(at + 26, name.length, true);
      big.set(text(name), at + 30);
      // 第一个条目的字节从 35 开始(头 30 + 名字 first)
      return { name, crc: 1, packed: size, size, at: 35 + at, noBody: true };
    });
    const overlap = forge([{ name: 'first', data: big, crc: 1 }, ...inner]);
    const t0 = performance.now();
    // 校验都是乱写的:报的是重叠,说明没轮到算校验
    expect(() => parseZip(overlap)).toThrow('重叠');
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('两个条目指同一个位置:名字和头对不上', () => {
    expect(() => parseZip(forge([{ name: 'a' }, { name: 'b', at: 0, noBody: true }]))).toThrow('对不上');
  });

  it('条目之间、最后一个条目和目录之间留空', () => {
    const hello = text('hello');
    const junk = new Uint8Array([...hello, 1, 2, 3, 4, 5, 6, 7, 8]);
    const shortOf = { data: junk, crc: crc32(hello), packed: 5, size: 5 };
    expect(() => parseZip(forge([{ name: 'a', ...shortOf }, { name: 'b' }]))).toThrow('空隙');
    expect(() => parseZip(forge([{ name: 'a' }, { name: 'b', ...shortOf }]))).toThrow('空隙');
    // 第一个条目前面留空
    const before = forge([{ name: 'a', noBody: true, at: 8 }]);
    expect(() => parseZip(before)).toThrow();
  });

  it('文件前后多字节、结尾记录不对:带注释、分卷、条目数不对、目录位置不对、不是 ZIP', () => {
    const ok = forge([{}]);
    const before = new Uint8Array(ok.length + 4);
    before.set(ok, 4);
    expect(() => parseZip(before)).toThrow();
    const after = new Uint8Array(ok.length + 4);
    after.set(ok);
    expect(() => parseZip(after)).toThrow();
    expect(() => parseZip(forge([{}], { comment: 3 }))).toThrow();
    expect(() => parseZip(forge([{}], { disk: 1 }))).toThrow('分卷');
    expect(() => parseZip(forge([{}], { count: 2 }))).toThrow();
    expect(() => parseZip(forge([{}, { name: 'b' }], { count: 1 }))).toThrow();
    expect(() => parseZip(forge([{}], { centralAt: 1 }))).toThrow();
    expect(() => parseZip(new Uint8Array(0))).toThrow();
    expect(() => parseZip(new Uint8Array(100))).toThrow();
  });
});

describe('ZIP:乱改文件反复试', () => {
  const same = (a: ZipEntry[], b: ZipEntry[]) => a.length === b.length && a.every((e, i) => e.name === b[i].name && Buffer.compare(e.data, b[i].data) === 0);

  it('截断、翻字节、改长度:要么抛 Error,要么读到的和原来一模一样', async () => {
    const good = await bytesOf(await writeZip(SAMPLE));
    const want = parseZip(good);
    const rand = mulberry32(20261104);
    const pick = (n: number) => Math.floor(rand() * n);
    const check = (bad: Uint8Array) => {
      let back: ZipEntry[];
      try {
        back = parseZip(bad);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        return false;
      }
      // 没被拒绝的只能是改到了不影响内容的地方(时间、版本这些)
      expect(same(back, want)).toBe(true);
      return true;
    };
    // 截断:每个长度都试
    for (let n = 0; n < good.length; n += 1 + (n > 400 ? 37 : 0)) expect(check(good.subarray(0, n))).toBe(false);
    // 翻字节
    for (let i = 0; i < 4000; i++) {
      const bad = good.slice();
      for (let k = 1 + pick(3); k > 0; k--) bad[pick(bad.length)] ^= 1 << pick(8);
      check(bad);
    }
    // 专挑文件尾部和目录(长度、位置都在这)改成特别的数
    const tailFrom = good.length - 400;
    const special = [0, 1, 0x7fff, 0xffff, 0xffffffff, 0x7fffffff, good.length, good.length + 1];
    for (let i = 0; i < 4000; i++) {
      const bad = good.slice();
      const at = tailFrom + pick(396);
      const v = new DataView(bad.buffer);
      const x = special[pick(special.length)];
      if (rand() < 0.5) v.setUint16(at, x & 0xffff, true);
      else v.setUint32(at, x, true);
      check(bad);
    }
  });
});
