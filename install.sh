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
run_pnpm() {
  if [[ "$PNPM" == *.cjs ]]; then "$NODE" "$PNPM" "$@"; else "$PNPM" "$@"; fi
}
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
