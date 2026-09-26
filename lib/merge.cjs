#!/usr/bin/env node
/**
 * dsh-kit merge — 把 kit 的 profile 模板幂等地合并进目标 profile。
 * usage: node merge.mjs <template-dir> <target-profile-dir> <profile-name>
 *
 * 合并语义（全部幂等，重复执行不会产生重复条目）：
 *   package.json      dependencies 缺的补上（已有的保留你的版本）；
 *                     dsh.profile.bundles 并集；postinstall 缺的片段补上
 *   cordis.patch.yml  顶层块逐块检测（块内首个 id/name），缺失才整块追加；
 *                     config-manager 的 profile 值改写为目标 profile 名
 *   scripts/*.cjs     不覆盖拷贝
 *   pnpm-workspace.yaml 不存在则整份拷贝；存在则只补 allowBuilds 缺的键
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [tplDir, tgtDir, profileName] = process.argv.slice(2);
if (!tplDir || !tgtDir || !profileName) {
  console.error("usage: node merge.mjs <template-dir> <target-profile-dir> <profile-name>");
  process.exit(2);
}
fs.mkdirSync(tgtDir, { recursive: true });

const readText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const report = [];

/* ---------- package.json ---------- */
const tplPkg = JSON.parse(readText(path.join(tplDir, "package.json")));
const tgtPkgPath = path.join(tgtDir, "package.json");
const tgtPkgRaw = readText(tgtPkgPath);

if (tgtPkgRaw === null) {
  const fresh = { ...tplPkg, name: `dsh-profile-${profileName}` };
  fs.writeFileSync(tgtPkgPath, JSON.stringify(fresh, null, 2) + "\n");
  report.push(`package.json: 新建（${Object.keys(tplPkg.dependencies).length} 依赖 / ${tplPkg.dsh.profile.bundles.length} bundles）`);
} else {
  const tgt = JSON.parse(tgtPkgRaw);
  tgt.dependencies = tgt.dependencies || {};
  let added = 0;
  for (const [k, v] of Object.entries(tplPkg.dependencies)) {
    if (!(k in tgt.dependencies)) { tgt.dependencies[k] = v; added++; }
  }
  tgt.dsh = tgt.dsh || {};
  tgt.dsh.profile = tgt.dsh.profile || {};
  const tb = tplPkg.dsh?.profile?.bundles || [];
  const cur = new Set(tgt.dsh.profile.bundles || []);
  let bundlesAdded = 0;
  tgt.dsh.profile.bundles = tgt.dsh.profile.bundles || [];
  for (const b of tb) if (!cur.has(b)) { tgt.dsh.profile.bundles.push(b); bundlesAdded++; }
  // postinstall：按 " && " 片段补缺
  const tplPi = String(tplPkg.scripts?.postinstall || "");
  tgt.scripts = tgt.scripts || {};
  const curPi = String(tgt.scripts.postinstall || "");
  if (tplPi) {
    if (!curPi) tgt.scripts.postinstall = tplPi;
    else {
      const have = new Set(curPi.split(" && ").map((s) => s.trim()));
      const missing = tplPi.split(" && ").map((s) => s.trim()).filter((s) => !have.has(s));
      if (missing.length) tgt.scripts.postinstall = curPi + " && " + missing.join(" && ");
    }
  }
  fs.writeFileSync(tgtPkgPath, JSON.stringify(tgt, null, 2) + "\n");
  report.push(`package.json: +${added} 依赖, +${bundlesAdded} bundles, postinstall 片段已补齐`);
}

/* ---------- cordis.patch.yml ---------- */
const tplPatch = readText(path.join(tplDir, "cordis.patch.yml")) ?? "";
const tgtPatchPath = path.join(tgtDir, "cordis.patch.yml");
const tgtPatch = readText(tgtPatchPath);

function splitBlocks(text) {
  // 返回 [{head, body}]：head = 顶格注释/空行缓冲，body = 顶层条目及其缩进行
  const blocks = [];
  let pending = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (/^- /.test(line)) {
      current = { head: pending, body: [line] };
      blocks.push(current);
      pending = [];
    } else if (/^\s/.test(line)) {
      if (current) current.body.push(line);
      else pending.push(line);
    } else {
      // 顶格注释 / 空行
      pending.push(line);
    }
  }
  return { blocks, tail: pending };
}

function keys(block) {
  const text = block.head.join("\n") + "\n" + block.body.join("\n");
  const ids = [...text.matchAll(/^\s*-?\s*id:\s*(.+?)\s*$/gm)].map((m) => m[1].replace(/^['"]|['"]$/g, ""));
  const names = [...text.matchAll(/^\s*name:\s*(.+?)\s*$/gm)].map((m) => m[1].replace(/^['"]|['"]$/g, ""));
  return { ids, names };
}

if (tgtPatch === null) {
  let out = tplPatch;
  if (profileName !== "desktop") {
    out = out.replace(/^(\s*profile:\s*)desktop\s*$/m, `$1${profileName}`);
  }
  fs.writeFileSync(tgtPatchPath, out);
  report.push("cordis.patch.yml: 新建（config-manager 已指向 " + profileName + "）");
} else {
  const { blocks } = splitBlocks(tplPatch);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exists = (t, v) => new RegExp(`^\\s*(?:-\\s*)?(?:id|name):\\s*['"]?${esc(v)}['"]?\\s*$`, "m").test(t);
  const missing = [];
  for (const b of blocks) {
    const { ids, names } = keys(b);
    const hit = [...ids, ...names].some((v) => exists(tgtPatch, v));
    if (!hit) missing.push(b);
  }
  if (missing.length) {
    let out = tgtPatch.replace(/\n*$/, "\n");
    for (const b of missing) {
      let chunk = [...b.head, ...b.body].join("\n");
      if (profileName !== "desktop") {
        chunk = chunk.replace(/^(\s*profile:\s*)desktop\s*$/m, `$1${profileName}`);
      }
      out += "\n" + chunk.replace(/\n*$/, "\n");
    }
    fs.writeFileSync(tgtPatchPath, out);
    report.push(`cordis.patch.yml: 追加 ${missing.length} 块（${missing.map((b) => keys(b).ids[0] || keys(b).names[0] || "?").join(", ")}）`);
  } else {
    report.push("cordis.patch.yml: 已全部就绪，无需改动");
  }
}

/* ---------- scripts/ ---------- */
const tplScripts = path.join(tplDir, "scripts");
if (fs.existsSync(tplScripts)) {
  fs.cpSync(tplScripts, path.join(tgtDir, "scripts"), { recursive: true, force: false, errorOnExist: false });
  report.push("scripts/: 补丁脚本已就位（不覆盖你已有的同名文件）");
}

/* ---------- pnpm-workspace.yaml ---------- */
const tplWs = readText(path.join(tplDir, "pnpm-workspace.yaml"));
const tgtWsPath = path.join(tgtDir, "pnpm-workspace.yaml");
let tgtWs = readText(tgtWsPath);
if (tplWs !== null && tgtWs === null) {
  fs.writeFileSync(tgtWsPath, tplWs);
  report.push("pnpm-workspace.yaml: 新建（含 allowBuilds 与 minimumReleaseAge 策略）");
} else if (tplWs !== null && tgtWs !== null) {
  // 提取模板 allowBuilds 块的键，目标缺的补上
  const grab = (text) => {
    const m = text.match(/^allowBuilds:\s*$/m);
    if (!m) return [];
    const start = text.indexOf(m[0]) + m[0].length;
    const rest = text.slice(start);
    const lines = rest.split("\n");
    const out = [];
    for (const l of lines) {
      if (/^\S/.test(l)) break;
      const km = l.match(/^\s{2}(.+?):\s*(.*)$/);
      if (km) out.push({ line: l, key: km[1].replace(/^['"]|['"]$/g, "") });
    }
    return out;
  };
  const tplKeys = grab(tplWs);
  const haveKeys = new Set(grab(tgtWs).map((k) => k.key));
  const need = tplKeys.filter((k) => !haveKeys.has(k.key));
  if (need.length) {
    if (/^allowBuilds:\s*$/m.test(tgtWs)) {
      const lines = tgtWs.split("\n");
      let insertAt = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^allowBuilds:\s*$/.test(lines[i])) {
          insertAt = i + 1;
          while (insertAt < lines.length && /^\s/.test(lines[insertAt])) insertAt++;
          break;
        }
      }
      lines.splice(insertAt, 0, ...need.map((k) => k.line));
      tgtWs = lines.join("\n");
    } else {
      tgtWs = tgtWs.replace(/\n*$/, "\n") + "\nallowBuilds:\n" + need.map((k) => k.line).join("\n") + "\n";
    }
    fs.writeFileSync(tgtWsPath, tgtWs);
    report.push(`pnpm-workspace.yaml: allowBuilds 补 ${need.length} 键`);
  } else {
    report.push("pnpm-workspace.yaml: allowBuilds 已就绪");
  }
}

console.log(report.map((r) => "  · " + r).join("\n"));
