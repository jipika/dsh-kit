#!/usr/bin/env bash
# dsh-kit 一键安装：把插件集 + 挂载配置装进指定的 DSH profile。
# 用法：./install.sh [profile]     （默认 desktop）
# 幂等：重复执行只补缺失项，不覆盖你已有的版本与配置。
set -euo pipefail

# ── 参数 ─────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '2,5p' "${BASH_SOURCE[0]}"
  exit 0
fi
PROFILE="${1:-desktop}"
if ! printf '%s' "$PROFILE" | grep -qE '^[A-Za-z0-9][A-Za-z0-9_-]*$'; then
  echo "✗ 非法 profile 名：$PROFILE（只允许字母/数字/下划线/连字符）" >&2
  echo "  用法：./install.sh [profile]（默认 desktop）" >&2
  exit 1
fi
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
TGT="$DSH_HOME/profiles/$PROFILE"

echo "==> dsh-kit → profile: $PROFILE ($TGT)"

# ── 探测 node ────────────────────────────────────────────────────────────────
NODE=""
for c in "$(command -v node 2>/dev/null || true)" \
         "$DSH_HOME/bin/node" \
         "$DSH_HOME"/dsh-runtimes/*/dependencies/node/bin/node; do
  [ -n "$c" ] && [ -x "$c" ] && NODE="$c" && break
done
if [ -z "$NODE" ]; then
  echo "✗ 找不到 node。请安装 Node.js 20+（或先跑过一次 DeepSeek Harness Desktop）。" >&2
  exit 1
fi

# ── 探测 pnpm ────────────────────────────────────────────────────────────────
PNPM=""
for c in "$(command -v pnpm 2>/dev/null || true)" \
         "$DSH_HOME/bin/pnpm" \
         /Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.cjs \
         "$DSH_HOME"/dsh-runtimes/*/pnpm/bin/pnpm.cjs; do
  [ -n "$c" ] && [ -e "$c" ] && PNPM="$c" && break
done
if [ -z "$PNPM" ]; then
  echo "✗ 找不到 pnpm。请 npm i -g pnpm，或确认 DeepSeek Harness Desktop 已安装。" >&2
  exit 1
fi
# pnpm 的入口有两种形态：系统装的（带 node shebang 的 JS）与 `$DSH_HOME/bin/pnpm`
# 这类**软链** —— 软链自身名字不带 `.cjs`，但目标仍是 JS 文件。
# 只看扩展名会漏判软链：实测直接执行软链会以 "Permission denied" 收场（目标
# `pnpm.cjs` 是 0644，没有执行位）。改成读 shebang：含 node 就用探测到的 node 跑。
run_pnpm() {
  if head -1 "$PNPM" 2>/dev/null | grep -q node; then
    "$NODE" "$PNPM" "$@"
  else
    "$PNPM" "$@"
  fi
}
# postinstall 链是 `node scripts/patch-*.cjs` —— pnpm 起子进程时靠 **PATH** 找 node。
# 而探测到的 node 往往在 PATH 之外（典型的 `$DSH_HOME/bin/node`，Desktop 自带运行时），
# 不补 PATH 的话 postinstall 会以 `sh: node: command not found` → `[ELIFECYCLE] Command
# failed` 收场，**所有补丁静默不生效**（实测踩到）。这里把它的目录前置进 PATH。
export PATH="$(dirname "$NODE"):$PATH"

echo "    node = $NODE"
echo "    pnpm = $PNPM"

# ── 合并配置（幂等）─────────────────────────────────────────────────────────
echo "==> 合并 profile 配置…"
"$NODE" "$KIT_DIR/lib/merge.cjs" "$KIT_DIR/profile" "$TGT" "$PROFILE"

# ── 安装依赖 ────────────────────────────────────────────────────────────────
echo "==> 安装依赖（首次需要联网，github: 依赖会现场 clone）…"
(cd "$TGT" && run_pnpm install)

echo ""
echo "==> 完成！重启 DeepSeek Harness（Desktop 直接重启；CLI 用 dsh --profile $PROFILE）即可生效。"
echo "    提示：ego-browser 需要按本机浏览器在 cordis.patch.yml 里配置 chromePath，见 README。"
