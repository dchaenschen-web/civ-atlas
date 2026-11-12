/**
 * 世界文件的格式定义(第 1 版):后缀、清单的字段、有哪几块、读不了时的几种错。这一层只有定义,打包和读在 worldFile.ts,逐项核对在 worldValidate.ts。
 *
 * 文件是一个不压缩的 ZIP(zipStore.ts),任何解压软件都打得开:
 *
 *   manifest.json        清单(UTF-8 的 JSON,缩进两格,人也能读)
 *   parts/map.gz         地图(World,不带形成过程的回放快照)
 *   parts/eras.gz        地形大事以后的各段世界(没有地形大事就不写)
 *   parts/civ.gz         整段历史(Civ)
 *   parts/chronicle.gz   编年史(第 2 版 ChronicleBlock:名字写成占位符,gen/civ/story/nameTokens.ts;第 1 版是算好的文字 ChronicleEntry[])
 *   parts/flags.gz       各国历代的旗(FlagBook)
 *   parts/author.gz      作者的内容:AI 写的正文(可选)
 *   parts/thumb.jpg      封面(可选)
 *   parts/ext.xxx.gz     插件放的附加数据(可选,见下面 need)
 *
 * 带 .gz 的块:字节是 gzip 压缩过的 CIVSNAP1(snapshot.ts 的 packValue)。外壳不再压缩。
 * ZIP 里只能有清单和清单列出的块,多一个、少一个都不认:每一个字节都有清单担保,校验、审核才能看全。
 *
 * 清单的字段(WorldManifest):
 * - app:固定是 WORLD_APP
 * - kind:这个文件是什么。现在只有 world(整个世界);以后的种子作品之类用别的值,认不出的提示更新软件
 * - format:外壳和清单的版本。只有旧软件读了会读错才加一;加可选字段不算(认不出的字段原样留着,另存也带着)
 * - id、title:世界的编号、名字
 * - made:什么时候用哪一版软件做的(app 软件版本、generator 生成器版本、commit 提交、at 时间)
 * - readers:读这个世界要用第几版读取规则(terrain 铺地形、query 查某年的归属和人口)。比软件新的提示更新软件
 * - parts:每一块一项(WorldPartInfo)
 * - recipe:存档的全部内容(savefile.ts 的 SaveFile:参数、作者的修改、投影、出处……)
 * - plugins:用过的插件(WorldPlugin):只记编号、第几版、文件指纹,**绝不放插件的代码**。看世界永远不需要插件,接着推才需要
 * - revision:第几次修订(n)、上一份清单的指纹(parent:上一份 manifest.json 字节的 SHA-256;第一份没有)
 *
 * 每一块(WorldPartInfo):
 * - name:块名。file:块在 ZIP 里的路径。两者都只认 parts/ 底下的小写字母、数字、点、连字符
 * - schema:这一块的结构版本。读的时候逐级迁移到现在的结构(worldMigrate.ts)
 * - sum、bytes:解压后字节的 SHA-256、字节数(和 snapshot.ts 的 SnapshotPart 一样);zip:gzip / none
 * - need:view = 看世界必须有;extra = 可选。by(可选):哪个插件放的
 *
 * 版本的规矩:比软件新的 format、kind、readers、need 是 view 的 schema,读的时候报「要更新软件」(newer),不当文件坏了。
 * need 是 extra 的块读不懂也不碍事:认不出的、结构比软件新的只当字节,**不解开、不执行**,另存时原样带着。
 *
 * 纯定义,不碰 DOM,网页、worker、Node(服务器)共用一份。
 */
import type { SaveFile } from './savefile';

/** 文件的后缀 */
export const WORLD_FILE_EXT = '.civworld';
/** 清单里 app 的值 */
export const WORLD_APP = '文明与地图';
/** 清单里 kind 的值(现在只有这一种) */
export const WORLD_KIND = 'world';
/** 这一版软件读写的外壳和清单版本 */
export const WORLD_FORMAT = 1;
/** 清单在 ZIP 里的路径 */
export const MANIFEST_FILE = 'manifest.json';

/** 看世界必须有 / 可选 */
export type PartNeed = 'view' | 'extra';

/** 清单里的一块 */
export interface WorldPartInfo {
  name: string;
  /** 在 ZIP 里的路径 */
  file: string;
  /** 这一块的结构版本 */
  schema: number;
  /** 解压后字节的 SHA-256(十六进制) */
  sum: string;
  /** 解压后的字节数 */
  bytes: number;
  /** 压缩方式:gzip / none;need 是 extra 的块可以是认不出的写法(只当字节留着) */
  zip: string;
  need: PartNeed;
  /** 哪个插件放的 */
  by?: string;
}

/** 什么时候用哪一版软件做的 */
export interface WorldMade {
  /** 软件版本("1.6.0") */
  app: string;
  /** 生成器版本(GENERATOR_VERSION) */
  generator: number;
  /** 提交(不知道 = 空串) */
  commit: string;
  /** 时间(ISO 8601) */
  at: string;
}

/** 读这个世界要用第几版读取规则 */
export type WorldReaders = {
  terrain: number;
  query: number;
};

/** 用过的插件:世界里只记这些,绝不放插件的代码 */
export interface WorldPlugin {
  id: string;
  /** 第几版("1.2.0") */
  version: string;
  /** 插件文件的 SHA-256(十六进制) */
  sum: string;
  /** 它干什么用的(sim 换推演规则之类) */
  role: string;
  /** 插件的参数(只有数据,大小有上限) */
  params?: Record<string, unknown>;
}

/** 第几次修订 */
export interface WorldRevision {
  n: number;
  /** 上一份 manifest.json 字节的 SHA-256;第一份没有 */
  parent?: string;
}

/** 清单 */
export interface WorldManifest {
  app: typeof WORLD_APP;
  kind: typeof WORLD_KIND;
  format: typeof WORLD_FORMAT;
  id: string;
  title?: string;
  made: WorldMade;
  readers: WorldReaders;
  parts: WorldPartInfo[];
  recipe: SaveFile;
  plugins: WorldPlugin[];
  revision: WorldRevision;
}

/** 这一版软件认得的块:路径照这个写;required = 一个世界必须有 */
export const KNOWN_PARTS: ReadonlyMap<string, { file: string; required: boolean; need: PartNeed }> = new Map([
  ['system', { file: 'parts/system.gz', required: false, need: 'view' }],
  ['map', { file: 'parts/map.gz', required: true, need: 'view' }],
  ['eras', { file: 'parts/eras.gz', required: false, need: 'view' }],
  ['civ', { file: 'parts/civ.gz', required: true, need: 'view' }],
  ['chronicle', { file: 'parts/chronicle.gz', required: true, need: 'view' }],
  ['flags', { file: 'parts/flags.gz', required: true, need: 'view' }],
  ['author', { file: 'parts/author.gz', required: false, need: 'extra' }],
  ['thumb', { file: 'parts/thumb.jpg', required: false, need: 'extra' }],
]);

import type { BeltDesign, SystemOverrides } from './system';

/** 星系那一块:逐行星/卫星覆盖表、小行星带、撞击结算(都没有 = 单行星、和以前一样) */
export interface SystemContent {
  overrides: SystemOverrides;
  belts?: BeltDesign[] | null;
  /** 推演结束以后结算出来的撞击记录(还没应用 = null) */
  impactSettlement?: { records: unknown[] } | null;
}

/** 作者内容里的一条 AI 正文(和浏览器里存的 AiNote 同样的字段) */
export interface AuthorNote {
  /** 功能内唯一的键 */
  key: string;
  /** 哪个功能写的:"史书""释名"…… */
  kind: string;
  /** 显示用的标题 */
  title: string;
  text: string;
  /** ISO 时间 */
  createdAt: string;
  provider: string;
  model: string;
}

/** author 这一块:作者的内容。作者的改名、标记、人物在清单的 recipe 里,这里放的是配方以外的正文 */
export interface AuthorContent {
  notes: AuthorNote[];
}

/**
 * 读世界文件的错分几种,调用方照这个告诉用的人不同的话:
 * - broken:文件坏了(或者被改过),这个文件打不开
 * - newer:文件比这一版软件新,**更新软件就能打开**,文件本身没问题
 * - readonly:文件是好的,但这一版软件没法把它转成现在的结构,只能只读提示,原件不动
 * - memory:这台设备内存不够,读不下这么大的世界。文件可能是好的,不能说成坏了(用的人会把它删掉)
 */
export type WorldFileErrorKind = 'broken' | 'newer' | 'readonly' | 'memory';

/** 读世界文件的错 */
export class WorldFileError extends Error {
  readonly kind: WorldFileErrorKind;
  constructor(kind: WorldFileErrorKind, message: string) {
    super(message);
    this.name = 'WorldFileError';
    this.kind = kind;
  }
}

/** 文件坏了:报错 */
export function broken(message: string): never {
  throw new WorldFileError('broken', message);
}

/** 比软件新:报错 */
export function newer(message: string): never {
  throw new WorldFileError('newer', message);
}

/**
 * 不管抛出来的是什么,都折成 WorldFileError:底下的解压、JSON、读包函数抛的普通错一律算文件坏了,
 * 只有开不出内存这一种(各家浏览器的说法:Array buffer allocation failed、Out of memory)算 memory。
 * 浏览器读不出文件的字节(NotReadableError)也算 memory:Chromium 内存不够时就报这个,文件被挪走了也报这个,都不能说文件坏了
 */
export function asWorldFileError(err: unknown): WorldFileError {
  if (err instanceof WorldFileError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const noRoom = (err instanceof RangeError && /alloc|memory/i.test(message)) || (err as { name?: unknown } | null)?.name === 'NotReadableError';
  return new WorldFileError(noRoom ? 'memory' : 'broken', message);
}
