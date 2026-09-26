#!/usr/bin/env node
/**
 * patch-context-units.cjs — dsh-context 的中文单位补丁（幂等，可重复执行）
 *
 * 上游 `fmt()` 用 k/M/B（千 / 百万 / 十亿）缩写，中文语境里心算麻烦。
 * 本补丁把它换成 k/万/亿：
 *     485,100,000 → 4.85亿      730,400 → 73.0万      2,500 → 2.5k（不变）
 * 只动这一个函数：轮次 / 步数 / 工具调用在 1 万以下照旧；字节数走的是另一个
 * `fmtBytes()`（kB/MB），不受影响。
 *
 * 为什么用脚本而不是直接改文件：dsh-context 是 npm 装的第三方包
 * （bowenliang123/dsh-context），`pnpm install` / 升级会把 lib/client.js
 * 覆盖回上游版本。本脚本挂在 profile 的 postinstall 链尾，每次装完自动重打；
 * 已经打过则直接跳过（幂等）。
 *
 * 用法：
 *   node scripts/patch-context-units.cjs          # 打补丁
 *   node scripts/patch-context-units.cjs --check  # 只判断是否需要打，不写盘
 */
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '..', 'node_modules', 'dsh-context', 'lib', 'client.js');

/* 上游原文（三行一组；行首缩进用捕获组保留，不写死 tab 数量）。 */
const OLD_RE = /^([\t ]*)if \(a >= 1e9\) return sign \+ \(a \/ 1e9\)\.toFixed\(1\) \+ "B";\n[\t ]*if \(a >= 1e6\) return sign \+ \(a \/ 1e6\)\.toFixed\(1\) \+ "M";\n[\t ]*if \(a >= 1e3\) return sign \+ \(a \/ 1e3\)\.toFixed\(1\) \+ "k";$/m;

const NEW =
  '$1if (a >= 1e8) return sign + (a / 1e8).toFixed(2) + "亿";\n' +
  '$1if (a >= 1e4) return sign + (a / 1e4).toFixed(1) + "万";\n' +
  '$1if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + "k";';

const MARK = 'toFixed(2) + "亿"';
const check = process.argv.includes('--check');

if (!fs.existsSync(TARGET)) {
  console.log('[patch-context-units] dsh-context 未安装，跳过');
  process.exit(0);
}

const src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARK)) {
  console.log('[patch-context-units] 已是中文单位（k/万/亿），跳过');
  process.exit(0);
}
if (!OLD_RE.test(src)) {
  console.log('[patch-context-units] ⚠️ 没匹配到预期的 fmt() 片段（上游可能改过），未做任何修改');
  process.exit(0);
}
if (check) {
  console.log('[patch-context-units] 需要打补丁（--check 模式，未写盘）');
  process.exit(0);
}

const next = src.replace(OLD_RE, NEW);

/* pnpm 在 node_modules 里放的是指向 store 的硬链接：直接写会连 store 一起改
 * （污染引用同一 store 的其它 profile）。写临时文件再 rename 覆盖，得到新
 * inode，从而断开链接。 */
const tmp = TARGET + '.patch-tmp';
fs.writeFileSync(tmp, next);
fs.renameSync(tmp, TARGET);

console.log('[patch-context-units] ✅ fmt() 已改为 k/万/亿');
