#!/usr/bin/env node
/**
 * patch-ego-browser-no-autotab.cjs — 关掉 dsh-ego-browser 的「侧栏自动弹出」补丁
 *
 * 现象：agent 一调用 ego_* 浏览器工具，右侧栏就自己弹出「Agent 浏览器」tab。
 * 根因在 `lib/client.js` 的 `mountSidebarTab()`：它开一条 SSE 探针
 * （`/api/ego/stream` 的 `tool-call` 事件），一旦发现本会话的工具调用计数上涨，
 * 就 `betterSidebar.openTab({ type: "ego-browser:watch" }, { sessionId })`。
 * 这段逻辑不读任何配置项 —— host 侧 22 个 Config 键里没有对应开关
 * （唯一沾边的是 `disableFrameRelay`，但它会把实时投屏整体关掉），所以只能打补丁。
 *
 * 本补丁把 `openWatchTab` 变成空实现：tab 仍然注册在侧栏（手动点开照样有实时画面），
 * 只是不再被自动打开。
 *
 * 为什么用脚本而不是直接改文件：dsh-ego-browser 是 git 安装的第三方包，
 * 任何 `pnpm install` / 升级都会覆盖回上游版本。本脚本挂在 profile 的 postinstall
 * 链尾，每次装完自动重打；已打过则跳过（幂等）；匹配不到只告警不改。
 *
 * 用法：
 *   node scripts/patch-ego-browser-no-autotab.cjs          # 打补丁
 *   node scripts/patch-ego-browser-no-autotab.cjs --check  # 只判断是否需要打，不写盘
 *
 * 回滚：删掉本脚本 + profile package.json postinstall 里对应的那一节，
 *       然后在 profile 目录跑一次 `pnpm install`（或手改回原实现）。
 */
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '..', 'node_modules', 'dsh-ego-browser', 'lib', 'client.js');

/* 上游原文（tab 缩进逐字匹配）。 */
const OLD_RE = /\tvar openWatchTab = function\(sessionId\) \{\n\t\tvar key = sessionId \|\| "";\n\t\tif \(autoOpened\[key\] === true\) return;\n\t\tautoOpened\[key\] = true;\n\t\ttry \{\n\t\t\tbetterSidebar\.openTab\(\{ type: "ego-browser:watch" \}, sessionId \? \{ sessionId \} : void 0\);\n\t\t\} catch \(e\) \{\}\n\t\};/;

/* 打过补丁的标记 = 替换后的函数签名。 */
const MARK = 'var openWatchTab = function(sessionId) { return; };';

const NEW =
  '\t/* 本地补丁：侧栏「Agent 浏览器」tab 只手动打开 —— agent 的 ego_* 工具调用不触发\n' +
  '\t * 自动弹出；tab 与实时画面本身保持可用。 */\n' +
  '\tvar openWatchTab = function(sessionId) { return; };';

const check = process.argv.includes('--check');

if (!fs.existsSync(TARGET)) {
  console.log('[patch-ego-browser-no-autotab] dsh-ego-browser 未安装，跳过');
  process.exit(0);
}

const src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARK)) {
  console.log('[patch-ego-browser-no-autotab] 已是「只手动打开」，跳过');
  process.exit(0);
}
if (!OLD_RE.test(src)) {
  console.log('[patch-ego-browser-no-autotab] ⚠️ 没匹配到预期的 openWatchTab 实现（上游可能改过），未做任何修改');
  process.exit(0);
}
if (check) {
  console.log('[patch-ego-browser-no-autotab] 需要打补丁（--check 模式，未写盘）');
  process.exit(0);
}

const next = src.replace(OLD_RE, NEW);

/* pnpm 在 node_modules 里放的是指向 store 的硬链接：直接写会连 store 一起改
 * （污染引用同一 store 的其它 profile）。写临时文件再 rename 覆盖，得到新
 * inode，从而断开链接。 */
const tmp = TARGET + '.patch-tmp';
fs.writeFileSync(tmp, next);
fs.renameSync(tmp, TARGET);

console.log('[patch-ego-browser-no-autotab] ✅ openWatchTab 已改为空实现（不再自动弹侧栏）');
