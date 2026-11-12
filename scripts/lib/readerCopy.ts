/**
 * 留读取代码的存底(scripts/freeze-reader.ts)要复制哪些文件、复制时改什么:
 * 从读取清单(src/gen/readers/terrainCode.ts)沿 import 走,真正运行要用到的文件都复制,目录结构不变,所以它们之间的 import 不用改;
 * 只为了类型才引的文件不复制(运行时没有它),import 路径改成指向原文件。
 */
import { dirname, join, posix, relative } from 'node:path';
import ts from 'typescript';

/** 读一个文件(路径从仓库根目录算);没有这个文件 = null */
export type ReadFile = (path: string) => string | null;

interface ImportRef {
  spec: string;
  /** 路径字符串(含引号)在文件里的位置 */
  start: number;
  end: number;
  /** 只为了类型 */
  typeOnly: boolean;
}

function importsOf(text: string): ImportRef[] {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: ImportRef[] = [];
  const add = (node: ts.Expression, typeOnly: boolean) => {
    if (ts.isStringLiteral(node) && node.text.startsWith('.')) out.push({ spec: node.text, start: node.getStart(sf), end: node.getEnd(), typeOnly });
  };
  const walk = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) {
      const c = n.importClause;
      const b = c?.namedBindings;
      const allTypes = !!c && !c.name && !!b && ts.isNamedImports(b) && b.elements.length > 0 && b.elements.every((e) => e.isTypeOnly);
      add(n.moduleSpecifier, !!c?.isTypeOnly || allTypes);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      const b = n.exportClause;
      add(n.moduleSpecifier, n.isTypeOnly || (!!b && ts.isNamedExports(b) && b.elements.length > 0 && b.elements.every((e) => e.isTypeOnly)));
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      add(n.argument.literal as ts.Expression, true);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments.length === 1) {
      add(n.arguments[0], false);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** 从 from 这个文件 import spec,落到哪个文件(路径从仓库根目录算,斜杠分隔) */
function resolve(read: ReadFile, from: string, spec: string): string | null {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  for (const f of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) if (read(f) !== null) return f;
  return null;
}

/** entry 运行时用到的所有文件(含它自己);必须都在 root 下面,不然存底的目录结构放不下 */
export function readerFiles(read: ReadFile, entry: string, root = 'src/gen'): string[] {
  const seen = new Set<string>();
  const go = (f: string) => {
    if (seen.has(f)) return;
    const text = read(f);
    if (text === null) throw new Error(`读不到 ${f}`);
    if (!f.startsWith(`${root}/`)) throw new Error(`${f} 不在 ${root} 下面:读取代码只能用纯计算的代码`);
    seen.add(f);
    for (const r of importsOf(text)) {
      if (r.typeOnly) continue;
      const t = resolve(read, f, r.spec);
      if (!t) throw new Error(`${f} 引的 ${r.spec} 找不到`);
      go(t);
    }
  };
  go(entry);
  return [...seen].sort();
}

/** 存底里这个文件的内容:加上只读的说明;只为类型引的、不在存底里的文件,路径改成指向原文件 */
export function frozenText(read: ReadFile, file: string, files: ReadonlySet<string>, targetDir: string, root: string, note: string): string {
  const text = read(file)!;
  const to = join(targetDir, relative(root, file));
  let out = text;
  for (const r of importsOf(text).sort((a, b) => b.start - a.start)) {
    if (!r.typeOnly) continue;
    const t = resolve(read, file, r.spec);
    if (!t || files.has(t)) continue;
    // 导入说明符一律用正斜杠(Windows 上 path.relative 会给反斜杠,写进 import 是错的)
    const rel = relative(dirname(to), t.replace(/\.tsx?$/, '')).replace(/\\/g, '/');
    out = `${out.slice(0, r.start)}'${rel.startsWith('.') ? rel : `./${rel}`}'${out.slice(r.end)}`;
  }
  return /\.tsx?$/.test(file) ? `// @ts-nocheck\n// ${note}\n${out}` : out;
}
