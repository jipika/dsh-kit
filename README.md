# dsh-kit

一套经过日常高强度使用打磨的 **DeepSeek Harness（DSH）插件配置套件**：39 个依赖
（官方 Computer/Browser Use、精选第三方插件、15 个自研/改版插件）、全部挂载与
补丁脚本，一条命令装进任何 profile。

全部插件源码公开，装的就是 GitHub 上的最新版：

| 类别 | 插件 |
|---|---|
| 自研 · UI/动效 | `dsh-plugin-polish`（动效统一 + `:has()` 替换引擎）、`dsh-claude-theme`、`dsh-plugin-github-code-theme`、`dsh-smooth-cursor/stream`（第三方） |
| 自研 · 功能 | `dsh-todo-float`、`@jipika/dsh-workspace-files`、`dsh-memguard`（内存守卫）、`dsh-proxy-autoswitch`、`dsh-infinite-gen-4`、`dsh-lan-loopback-compat`、`dsh-computer-use-compat`、`dsh-preset-hotswap`（会话头热切模式） |
| 自研 · 工具 | `@jipika/dsh-memory`（长期记忆注入）、`@jipika/dsh-think-ux`、`dsh-ui-fixes`、`dsh-skill-mcp-panel`（改版）、`@noob-stupid/dsh-plugin-console`（改版：插件中心独立分栏） |
| 官方 | Computer Use 全家桶、Browser Use（Electron 下默认禁用）、Schedule/time-context |
| 第三方 | `dsh-better-sidebar`、`dsh-context`、`dsh-config-manager`、`dsh-rewind-plugin`、`dsh-plugin-save-token`、`dshmarket`、`@liustack/modsearch` 等 |

## 安装

**方式一：从 GitHub 装（推荐 —— 之后能 `git pull` 拿更新）**

```bash
git clone https://github.com/jipika/dsh-kit.git
cd dsh-kit
./install.sh            # 装进 desktop profile（默认）
./install.sh web        # 或装进任意 profile
```

**方式二：手上是 zip 包**

```bash
unzip dsh-kit-*.zip && cd dsh-kit
bash install.sh         # 解压后执行位可能丢失，用 bash 跑最稳
```

前提相同：**本机已装 DeepSeek Harness Desktop**（脚本直接用它的 node/pnpm 运行时）。
zip 包里不含 `.git`，因此之后收不到 `git pull` 更新——想要更新就改用方式一。

脚本会自动探测 DSH 自带的 node/pnpm（没有则要求系统装 Node 20+），然后：

1. **幂等合并** `package.json`（依赖 + bundles + postinstall）、`cordis.patch.yml`
   （逐块检测，缺哪块补哪块）、`scripts/` 补丁脚本、`pnpm-workspace.yaml`
   （allowBuilds 白名单）——不覆盖你已有的版本与配置；
2. `pnpm install` 安装全部依赖（首次需联网，`github:` 依赖会现场 clone）；
3. **重启 DeepSeek Harness** 生效。

## 不包含什么（有意为之）

- **模型 providers / 默认模型 / API 配置**——请在你自己的设置里配置；
- **权限预设**——`defaultPreset` 等安全策略请自行决定，不替你选；
- **ego-browser 的 `chromePath`**——按本机浏览器在 `cordis.patch.yml` 追加：
  ```yaml
  - id: ego-browser
    config:
      chromePath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  ```

## 可选：配置包

如果你还拿到了作者私发的 `dsh-config-*.zip`（设置/提示词等脱敏配置）：
设置 → 备份与迁移 → 导入，选择该 ZIP 即可（导入前会自动快照，可回滚）。

## 常见问题

- **`duplicate loader entry id`**：`dsh-infinite-gen-4` 与 `@jipika/dsh-memory`
  走 bundles 通道，**不要**再在 patch 里手动 insert 它们（模板注释里有标）。
- **pnpm 报构建脚本被忽略**：把报错打印的那一行逐字加进 profile 的
  `pnpm-workspace.yaml` 的 `allowBuilds:` 下（安装脚本已自动补 kit 已知的键）。
- **改了 patch 不生效**：hot-reload 只覆盖部分场景，重启 DSH 最稳。
- **插件升级**：在 profile 目录 `pnpm update <pkg>`；git 依赖升级重跑
  `pnpm install` 即可。

## 插件源码

全部在 [github.com/jipika](https://github.com/jipika)（`dsh-*` 仓库）；
第三方插件见各自 `package.json` 的 `repository` 字段。上游版权归原作者，
MIT 许可处已随各自仓库声明。

## 已知事项

- 宿主 `0.1.7-rc.2` 下 `dsh-github@0.1.0` 与 `@dhicoc/dsh-reverse-skill@1.0.5`
  会因 peerDependencies 未适配被宿主跳过（不影响其它插件；等上游更新，或
  `dsh plugin allow-version` 显式豁免）。
- `@michengai/dsh-archive-manager` 每次启动告警
  `patch: entry "ui-settings-unarchive-sessions" not found`，上游已知问题，无害。
