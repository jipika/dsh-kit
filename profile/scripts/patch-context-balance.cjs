#!/usr/bin/env node
/**
 * patch-context-balance.cjs — dsh-context 余额胶囊修复补丁 v2（幂等，可重复执行）
 *
 * 症状：Context 总览左上角的「DeepSeek 余额」胶囊不显示。面板每次打开
 * POST /api/dsh-context/balance，服务端永远返回 {ok:true, value:null}。
 *
 * 根因（宿主内探针实证，2026-09-26）：插件 resolveFacts() 用
 * `settings.get("llm-deepseek")` 读配置段，但当前宿主（0.1.7-rc.2）的
 * settings 服务**没有 `get` 方法**（真实接口是 `describe({redactSecrets})`，
 * 返回各命名空间视图；全 asar 无一处调用 settings.get）→ section 恒为 null →
 * resolveFacts 恒 null → value 恒 null → 胶囊永不渲染。
 * credentials.resolve 正常、key 有效、平台 /user/balance 正常（已直测 200）。
 *
 * 修法（lib/index.js，四处，均可独立幂等）：
 *   D. resolveFacts() 的 section 获取：settings.get 不存在时改用
 *      settings.describe({redactSecrets:true}) 找 ns === "llm-deepseek" 的
 *      value（探针证实：apiKeyEnv="DEEPSEEK_API_KEY"，baseURL 未设 →
 *      插件自身的 PUBLIC_BASE_URL 平台根 fallback 正好接住）。
 *   A. resolveFacts() 返回的 baseUrl 经 platformRootOf() 剥尾部 /anthropic
 *      （防以后把 baseURL 配成 Messages 前缀端点）。
 *   B. balance 路由 handler 双保险：首查 null 且 baseUrl 非平台根时回退平台根。
 *   C. platformRootOf() 帮助函数。
 *
 * 挂在 profile postinstall 链（patch-context-units.cjs 之后），装完自动重打。
 *
 * 用法：
 *   node scripts/patch-context-balance.cjs          # 打补丁
 *   node scripts/patch-context-balance.cjs --check  # 只判断是否需要打，不写盘
 */
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '..', 'node_modules', 'dsh-context', 'lib', 'index.js');

/* 每个补丁：name / done 标记 / old(正则或字符串) / next(生成替换文本)。按序应用。 */
const PATCHES = [
  {
    name: 'D(resolveFacts 改用 describe 回退)',
    done: (s) => s.includes('settingsDescribeViews'),
    old: /^([\t ]*)const settings = ctx\.get\("settings"\);\n[\t ]*const section = typeof settings\?\.get === "function" \? asRecord\$1\(settings\.get\(DEEPSEEK_SETTINGS_NS\)\) : null;$/m,
    next: (ind) =>
      `${ind}const settings = ctx.get("settings");\n` +
      `${ind}// 宿主 0.1.x 的 settings 服务没有 get(ns)，只有 describe({redactSecrets})（patch-context-balance）。\n` +
      `${ind}const settingsDescribeViews = typeof settings?.describe === "function" ? settings.describe({ redactSecrets: true }) : null;\n` +
      `${ind}const section = typeof settings?.get === "function" ? asRecord$1(settings.get(DEEPSEEK_SETTINGS_NS))\n` +
      `${ind}\t: Array.isArray(settingsDescribeViews) ? asRecord$1(settingsDescribeViews.find((view) => view?.ns === DEEPSEEK_SETTINGS_NS)?.value) : null;`,
  },
  {
    name: 'C(platformRootOf 帮助函数)',
    done: (s) => s.includes('function platformRootOf'),
    old: 'async function resolveFacts(ctx) {',
    next: () =>
      '/** Messages 端点（可带 /anthropic 之类的协议前缀）→ 平台侧余额 API 的根。 */\n' +
      'function platformRootOf(url) {\n' +
      '\treturn url.replace(/\\/anthropic\\/?$/u, "") || PUBLIC_BASE_URL;\n' +
      '}\n' +
      'async function resolveFacts(ctx) {',
  },
  {
    name: 'A(baseUrl 归一化)',
    done: (s) => s.includes('platformRootOf(baseUrl)'),
    old: /^([\t ]*)return apiKey === "" \? null : \{\n[\t ]*baseUrl,\n[\t ]*apiKey\n[\t ]*\};$/m,
    next: (ind) =>
      `${ind}return apiKey === "" ? null : {\n` +
      `${ind}\t// 余额查询打在平台侧 /user/balance，永远走平台根；baseURL 是 Messages 端点，\n` +
      `${ind}\t// 直接拼接会 404（patch-context-balance）。\n` +
      `${ind}\tbaseUrl: platformRootOf(baseUrl),\n` +
      `${ind}\tapiKey\n` +
      `${ind}};`,
  },
  {
    name: 'B(handler 平台根回退)',
    done: (s) => s.includes('let value = facts !== null ? await readBalance(facts) : null;'),
    old: /^([\t ]*)const handler = async \(\) => \{\n([\t ]*)const facts = await resolveFacts\(ctx\);\n([\t ]*)const value = facts !== null \? await readBalance\(facts\) : null;$/m,
    next: (_m, i1, i2) =>
      `${i1}const handler = async () => {\n` +
      `${i2}const facts = await resolveFacts(ctx);\n` +
      `${i2}let value = facts !== null ? await readBalance(facts) : null;\n` +
      `${i2}if (value === null && facts !== null && facts.baseUrl !== PUBLIC_BASE_URL) {\n` +
      `${i2}\t// 双保险：网关/协议前缀下查不到余额时，回退平台官方根再试一次（patch-context-balance）。\n` +
      `${i2}\tvalue = await readBalance({ baseUrl: PUBLIC_BASE_URL, apiKey: facts.apiKey });\n` +
      `${i2}}\n`,
  },
];

const check = process.argv.includes('--check');

if (!fs.existsSync(TARGET)) {
  console.log('[patch-context-balance] dsh-context 未安装，跳过');
  process.exit(0);
}

let src = fs.readFileSync(TARGET, 'utf8');
let dirty = false;

for (const p of PATCHES) {
  if (p.done(src)) {
    console.log(`[patch-context-balance]   ${p.name} 已打过，跳过`);
    continue;
  }
  const isRe = p.old instanceof RegExp;
  const hit = isRe ? p.old.test(src) : src.includes(p.old);
  if (!hit) {
    console.log(`[patch-context-balance] ⚠️ 没匹配到 ${p.name} 的预期片段（上游可能改过），未做任何修改`);
    process.exit(1);
  }
  if (check) {
    console.log(`[patch-context-balance]   ${p.name} 需要打（--check，未写盘）`);
    continue;
  }
  src = isRe
    ? src.replace(p.old, (...args) => p.next(...args.slice(1, -2)))  // 函数形式:$n 不展开,捕获组按参数传入
    : src.replace(p.old, p.next(''));
  dirty = true;
  console.log(`[patch-context-balance]   ${p.name} ✅`);
}

if (check) {
  console.log('[patch-context-balance] --check 完成，未写盘');
  process.exit(0);
}
if (!dirty) {
  console.log('[patch-context-balance] 全部补丁均已存在，无需修改');
  process.exit(0);
}

/* pnpm 在 node_modules 里放的是指向 store 的硬链接：直接写会连 store 一起改。
 * 写临时文件再 rename 覆盖，得到新 inode，从而断开链接。 */
const tmp = TARGET + '.patch-tmp';
fs.writeFileSync(tmp, src);
fs.renameSync(tmp, TARGET);

console.log('[patch-context-balance] ✅ resolveFacts 已支持 describe 回退 + 平台根归一化/回退');
