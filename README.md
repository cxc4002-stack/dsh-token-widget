# dsh-token-widget

English | [中文](README.zh.md)

A floating widget for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI: a collapsible overlay in the page's bottom-right corner summarizing token usage across all sessions.

![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Global totals** — cumulative input / output tokens across every chat session
- **Per-source breakdown** — usage grouped by `provider/model`, so you can see which model is burning tokens
- **Per-session detail**:
  - Title, running / idle state
  - Turns and steps (from the `sessionStats` projection)
  - Token usage (from the `tokenUsage` projection)
  - Context occupancy percentage (from the `contextPressure` projection, shown when data exists)
- **Click a row** to switch to that session
- Collapse to a small pill showing just the grand total

## Requirements

- DSH installed, booted with a Web GUI profile (the default is `web`)
- A DSH version that includes the client module system (`dsh.client`) and the `shell.overlay` slot

## Install

```sh
dsh plugin --profile web add github:cxc4002-stack/dsh-token-widget
```

`dsh plugin` links the package into the profile and registers its `dsh.bundle` layer. Then **restart `dsh web`**:

```sh
dsh web
```

> Adding or removing client plugins requires a server restart — refreshing the browser page is not enough.

### About build permissions

This repo commits the built artifacts (`client.js`, `lib/index.js`) directly and ships **no `prepare` script**, so pnpm never asks you to approve running a build script at install time. Install and go.

### Manual install (without `dsh plugin`)

1. Copy this directory into the profile's dependency directory, e.g.
   `$DSH_HOME/profiles/web/node_modules/dsh-token-widget/`
2. Append to `$DSH_HOME/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: token-widget
         name: dsh-token-widget
   ```

3. Restart `dsh web`.

## Uninstall

```sh
dsh plugin --profile web remove dsh-token-widget
```

For a manual install, delete the `token-widget` insert block from `cordis.patch.yml`, remove the copied directory, and restart `dsh web`.

## How it works

The plugin has two halves in one package:

| File | Runs on | Role |
| --- | --- | --- |
| `lib/index.js` | Host (Node) | Registers the `tokenUsageBySource` session projection, accumulating usage per `provider/model` |
| `client.js` | Browser | The widget component; reads projection data and renders into the `shell.overlay` slot |
| `cordis.patch.yml` | — | The bundle layer, inserting the `token-widget` row |

All data comes from DSH's existing `tokenUsage` / `sessionStats` / `contextPressure` session projections — **no extra backend service, no data leaves your machine**.

The widget registers into the `shell.overlay` slot, an additive floating layer that replaces none of the built-in UI.

## Known limitations

- DSH's plugin APIs are pre-stable; projection fields may change between versions. If the widget renders blank, check your DSH version first.
- A usage sample and the final settlement for the same turn/step replace each other rather than add (intentional, to avoid double counting), so figures may differ slightly from your provider's bill.

## License

MIT — see [LICENSE](LICENSE).

The per-source usage fold derives from DeepSeek Harness's `tokenUsage` projection (`packages/llm/token-meter`, MIT, Copyright (c) 2026 DeepSeek) — see [NOTICE](NOTICE).
