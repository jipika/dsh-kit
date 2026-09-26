#!/usr/bin/env node
/**
 * patch-smooth-stream-icons.cjs — dsh-smooth-stream 的图标名兼容补丁（幂等，可重复执行）
 *
 * DSH 0.1.7 的 @deepseek-ai/dsh-client-ui-primitives 把图标导出改名成
 * `IconXxx{Outline}{Regular|Medium|Artwork}` —— 旧名（带尺寸后缀的
 * `IconXxxOutline14` / `IconXxxOutline16`）已不存在（整份 app.asar 里 0 次出现）。
 * 插件里 `primitives.IconChevronDownOutline14` 于是求值为 undefined，React 渲染
 * 这个元素时抛 "Element type is invalid ... got: undefined"，被宿主的
 * SlotErrorBoundary 接住，那片 UI 变成 `<div data-slot-error="..."></div>` 空白
 * （症状是「面板不显示」，不是整个插件不加载）。
 *
 * 本补丁把 8 个旧名换成宿主实际提供的 Regular 名。图标尺寸由 props.size 决定，
 * 与名字里的旧尺寸后缀无关，所以 Regular 是正确对应。
 *
 * 为什么用脚本而不是直接改文件：dsh-smooth-stream 是 npm 装的第三方包，
 * `pnpm install` / 升级会把 lib/client.js 覆盖回上游版本。本脚本挂在 profile 的
 * postinstall 链尾，每次装完自动重打；已无旧名则跳过（幂等）；匹配不到只告警不改
 * （上游改版时不误伤）。
 *
 * 用法：
 *   node scripts/patch-smooth-stream-icons.cjs          # 打补丁
 *   node scripts/patch-smooth-stream-icons.cjs --check  # 只判断是否需要打，不写盘
 */
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '..', 'node_modules', 'dsh-smooth-stream', 'lib', 'client.js');

const MAP = {
  IconChevronDownOutline14: 'IconChevronDownOutlineRegular',
  IconCloseOutline16: 'IconCloseOutlineRegular',
  IconCodeOutline16: 'IconCodeOutlineRegular',
  IconCopyOutline16: 'IconCopyOutlineRegular',
  IconQuestionOutline14: 'IconQuestionOutlineRegular',
  IconRefreshOutline14: 'IconRefreshOutlineRegular',
  IconRefreshOutline16: 'IconRefreshOutlineRegular',
  IconThinkOutline14: 'IconThinkOutlineRegular',
};

const check = process.argv.includes('--check');

if (!fs.existsSync(TARGET)) {
  console.log('[patch-smooth-stream-icons] dsh-smooth-stream 未安装，跳过');
  process.exit(0);
}

const src = fs.readFileSync(TARGET, 'utf8');
const present = Object.keys(MAP).filter((oldName) => src.includes(oldName));

if (present.length === 0) {
  console.log('[patch-smooth-stream-icons] 已无旧图标名，跳过');
  process.exit(0);
}
if (check) {
  console.log('[patch-smooth-stream-icons] 需要打补丁（--check 模式，未写盘）：' + present.join(', '));
  process.exit(0);
}

let next = src;
let total = 0;
for (const [oldName, newName] of Object.entries(MAP)) {
  const re = new RegExp(oldName + '\\b', 'g');
  const hits = (next.match(re) || []).length;
  if (hits === 0) continue;
  next = next.replace(re, newName);
  total += hits;
  console.log(`  ${oldName} → ${newName}（${hits} 处）`);
}

if (next === src) {
  console.log('[patch-smooth-stream-icons] ⚠️ 没匹配到可替换的旧图标名，未做任何修改');
  process.exit(0);
}

/* pnpm 在 node_modules 里放的是指向 store 的硬链接：直接写会连 store 一起改
 * （污染引用同一 store 的其它 profile）。写临时文件再 rename 覆盖，得到新
 * inode，从而断开链接。 */
const tmp = TARGET + '.patch-tmp';
fs.writeFileSync(tmp, next);
fs.renameSync(tmp, TARGET);

console.log(`[patch-smooth-stream-icons] ✅ 已替换 ${total} 处旧图标名`);
