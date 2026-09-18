# dsh-token-widget

DeepSeek Harness（DSH）Web UI 插件：在页面右下角显示一个可折叠的悬浮窗，汇总所有会话的 Token 用量。

## 功能

- **全局合计**：所有聊天窗口累计的输入 / 输出 Token 总量
- **按来源分组**：按 `provider/model` 分别累计用量，一眼看出是哪个模型在烧 Token
- **逐窗口明细**：
  - 标题、运行中 / 空闲状态
  - 轮数与步数（来自 `sessionStats` 投影）
  - Token 用量（来自 `tokenUsage` 投影）
  - 上下文占用百分比（来自 `contextPressure` 投影，有数据时才显示）
- **点击某一行**直接切换到对应聊天窗口
- 点右上角 `–` 收成一个小胶囊，只显示总量

## 环境要求

- 已安装 DSH，且使用带 Web GUI 的 profile（默认为 `web`）
- DSH 版本需包含客户端模块系统（`dsh.client`）与 `shell.overlay` 槽位

## 安装

```sh
dsh plugin --profile web add github:cxc4002-stack/dsh-token-widget
```

`dsh plugin` 会把包链接进 profile 并自动登记 `dsh.bundle` 层，然后**重启 `dsh web`** 生效：

```sh
dsh web
```

> 客户端插件集合的增删需要重启服务，只刷新浏览器页面不够。

### 关于安装权限

本仓库已把构建产物 `client.js` 与 `lib/index.js` 直接提交进版本库，**没有 `prepare` 构建脚本**，所以 pnpm 不会要求你授权执行构建脚本，安装即可用。

### 手动安装（不使用 `dsh plugin`）

1. 把本目录复制到 profile 的依赖目录，例如
   `$DSH_HOME/profiles/web/node_modules/dsh-token-widget/`
2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 末尾追加：

   ```yaml
   - insert:
       - id: token-widget
         name: dsh-token-widget
   ```

3. 重启 `dsh web`。

## 卸载

```sh
dsh plugin --profile web remove dsh-token-widget
```

手动安装的则从 `cordis.patch.yml` 删掉 `token-widget` 那一块、删除复制的目录，再重启 `dsh web`。

## 工作原理

插件由两部分组成，写在同一个包里：

| 文件 | 运行位置 | 作用 |
| --- | --- | --- |
| `lib/index.js` | Host（Node） | 注册 `tokenUsageBySource` 会话投影，按 `provider/model` 累计用量 |
| `client.js` | Browser | 悬浮窗组件，读投影数据并渲染，注册到 `shell.overlay` 槽位 |
| `cordis.patch.yml` | — | bundle 层，插入 `token-widget` 这一行 |

数据全部来自 DSH 已有的 `tokenUsage` / `sessionStats` / `contextPressure` 会话投影，**不额外起后端服务，也不上报任何数据**。

悬浮窗注册在 `shell.overlay` 槽位，是一个「加性」浮层，不会替换任何自带 UI。

## 已知限制

- DSH 的插件 API 处于 pre-stable 阶段，投影字段可能随版本变化；如遇悬浮窗空白，先确认 DSH 版本。
- 同一轮 / 同一步的 usage 采样与最终结算会互相替换而非累加，这是有意为之（避免重复计数），因此数值与账单可能存在正常误差。

## 许可

MIT，见 [LICENSE](LICENSE)。

本项目的按来源累计逻辑派生自 DeepSeek Harness 的 `tokenUsage` 投影（`packages/llm/token-meter`，MIT，Copyright (c) 2026 DeepSeek），详见 [NOTICE](NOTICE)。

---

## English

A floating widget for the DeepSeek Harness Web UI showing total token usage across all sessions, grouped by `provider/model`, with per-session status. Click a row to switch to that session.

Install (no build script, so no pnpm build permission prompt):

```sh
dsh plugin --profile web add github:cxc4002-stack/dsh-token-widget
dsh web   # restart to pick up the new client plugin
```

Remove with `dsh plugin --profile web remove dsh-token-widget`.

Licensed MIT. The per-source usage fold derives from DeepSeek Harness `packages/llm/token-meter` (MIT, Copyright (c) 2026 DeepSeek) — see [NOTICE](NOTICE).
