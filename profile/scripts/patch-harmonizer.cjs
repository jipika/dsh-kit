// 幂等补丁（两段），都打在 dsh-ui-harmonizer 的 lib/client.js 上。
//
// 1) 关掉「会话标签搬迁」(relocateTabs)：
//    relocateTabs 会把会话标签（对话/轨迹/上下文）从会话 header 的条件行搬进标题行
//    titleCluster（`[class$="_titleCluster"]`），与标题、以及设置弹窗顶部挤在一行 ——
//    实测 tabs 的父节点会变成 `wSkVaW_titleCluster`；关掉后回到 `wSkVaW_header` 的独立一行。
//
// 2) 给会话标签栏补下边距：
//    harmonizer 的胶囊样式把官方 `[class$=_tabs]{margin-top:10px}` 覆写成
//    `margin:0 0 0 8px`，上下边距全归零，于是那排胶囊（对话/轨迹/上下文）紧贴下方内容。
//    这里把底部补回 12px。
//
// 幂等：锚点找不到（harmonizer 升级、结构变化）时安全跳过，绝不写坏文件。
// 卸载：删掉 package.json postinstall 里的这段调用，再 `pnpm install`，
//       或从 ~/.dsh/backups/harmonizer-client.js.before-tabs-patch-* 恢复。
const fs = require("node:fs");
const path = require("node:path");

const marker = "if (true) return;"; // 段 1 的本地补丁标记
const anchor = "const relocateTabs = () => {";
const spacingFrom =
  "[class$=_tabs]{align-items:center;gap:8px;margin:0 0 0 8px;display:flex}";
const spacingTo =
  "[class$=_tabs]{align-items:center;gap:8px;margin:0 0 12px 8px;display:flex}";
const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "dsh-ui-harmonizer",
  "lib",
  "client.js",
);

try {
  if (!fs.existsSync(target)) {
    console.log("harmonizer patch: target not installed, skipped");
    process.exit(0);
  }
  let src = fs.readFileSync(target, "utf8");
  const before = src;

  // 段 1：关掉 relocateTabs
  const idx = src.indexOf(anchor);
  if (idx > 0 && src.slice(Math.max(0, idx - 120), idx).includes(marker)) {
    console.log("harmonizer patch [relocateTabs]: already applied");
  } else if (idx < 0) {
    console.log(
      "harmonizer patch [relocateTabs]: anchor not found (upstream changed?), skipped",
    );
  } else {
    src = src.slice(0, idx) + marker + "\n\t\t\t\t" + src.slice(idx);
    console.log("harmonizer patch [relocateTabs]: applied");
  }

  // 段 2：会话标签栏补下边距
  if (src.includes(spacingTo)) {
    console.log("harmonizer patch [tabs spacing]: already applied");
  } else if (src.includes(spacingFrom)) {
    src = src.replace(spacingFrom, () => spacingTo);
    console.log("harmonizer patch [tabs spacing]: applied");
  } else {
    console.log(
      "harmonizer patch [tabs spacing]: anchor not found (upstream changed?), skipped",
    );
  }

  // 段 3：CenterColCard 轮询降载。
  //   上游注释说明这个 400ms 轮询是有意的（ResizeObserver 只看得到尺寸，看不到
  //   `wrapped` 所需的 header 增删；也要兜住 transition 结束后的 settle），所以
  //   不删它，只去掉两笔纯浪费：
  //     a) 几何 + wrapped 完全没变时仍 setBox(新对象) → React 每次必重渲染；
  //     b) 窗口/标签隐藏时仍在做 getBoundingClientRect（强制同步布局）。
  const pbVarFrom = "\t\t\t\tlet timer = null;\n\t\t\t\tconst measure = () => {";
  const pbVarTo =
    "\t\t\t\tlet timer = null;\n" +
    "\t\t\t\tlet __lastBox = null; // [dsh-patch] 空转短路用\n" +
    "\t\t\t\tconst measure = () => {";
  const pbVarMarker = "let __lastBox = null;";
  const pbBoxFrom =
    "\t\t\t\t\tif (r.width > 0 && r.height > 0) setBox({\n" +
    "\t\t\t\t\t\tleft: r.left,\n" +
    "\t\t\t\t\t\ttop: r.top,\n" +
    "\t\t\t\t\t\twidth: r.width,\n" +
    "\t\t\t\t\t\theight: r.height,\n" +
    "\t\t\t\t\t\twrapped\n" +
    "\t\t\t\t\t});";
  const pbBoxTo =
    "\t\t\t\t\tif (r.width > 0 && r.height > 0) {\n" +
    "\t\t\t\t\t\tconst __next = {\n" +
    "\t\t\t\t\t\t\tleft: r.left,\n" +
    "\t\t\t\t\t\t\ttop: r.top,\n" +
    "\t\t\t\t\t\t\twidth: r.width,\n" +
    "\t\t\t\t\t\t\theight: r.height,\n" +
    "\t\t\t\t\t\t\twrapped\n" +
    "\t\t\t\t\t\t};\n" +
    "\t\t\t\t\t\tconst __prev = __lastBox; // [dsh-patch] 未变则不重渲染\n" +
    "\t\t\t\t\t\tif (\n" +
    "\t\t\t\t\t\t\t__prev !== null &&\n" +
    "\t\t\t\t\t\t\t__prev.left === __next.left &&\n" +
    "\t\t\t\t\t\t\t__prev.top === __next.top &&\n" +
    "\t\t\t\t\t\t\t__prev.width === __next.width &&\n" +
    "\t\t\t\t\t\t\t__prev.height === __next.height &&\n" +
    "\t\t\t\t\t\t\t__prev.wrapped === __next.wrapped\n" +
    "\t\t\t\t\t\t) return;\n" +
    "\t\t\t\t\t\t__lastBox = __next;\n" +
    "\t\t\t\t\t\tsetBox(__next);\n" +
    "\t\t\t\t\t}";
  const pbPollFrom = "timer = window.setInterval(measure, 400);";
  const pbPollTo =
    "timer = window.setInterval(() => {\n" +
    "\t\t\t\t\tif (document.visibilityState === \"hidden\") return; // [dsh-patch] 隐藏时跳过同步布局\n" +
    "\t\t\t\t\tmeasure();\n" +
    "\t\t\t\t}, 400);";

  if (src.includes(pbVarMarker)) {
    console.log("harmonizer patch [center-col poll]: already applied");
  } else if (
    !src.includes(pbVarFrom) ||
    !src.includes(pbBoxFrom) ||
    !src.includes(pbPollFrom)
  ) {
    console.log(
      "harmonizer patch [center-col poll]: anchor not found (upstream changed?), skipped",
    );
  } else {
    src = src.replace(pbVarFrom, () => pbVarTo);
    src = src.replace(pbBoxFrom, () => pbBoxTo);
    src = src.replace(pbPollFrom, () => pbPollTo);
    console.log("harmonizer patch [center-col poll]: applied");
  }

  if (src !== before) fs.writeFileSync(target, src, "utf8");
} catch (e) {
  console.log("harmonizer patch: skipped:", e && e.code ? e.code : e.message);
}
