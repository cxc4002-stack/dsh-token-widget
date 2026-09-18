window.__ModuleLoader__.load({
	id: "dsh-token-widget",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		// ── display helpers ────────────────────────────────────────────────
		function formatNumber(n) {
			const value = n || 0;
			if (value < 1000) return String(value);
			if (value < 1000000) {
				const scaled = value / 1000;
				return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}K`;
			}
			const scaled = value / 1000000;
			return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}M`;
		}

		function billedInputTokens(usage) {
			if (!usage) return 0;
			return (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
		}

		function totalTokens(usage) {
			if (!usage) return 0;
			return billedInputTokens(usage) + (usage.outputTokens || 0);
		}

		function zeroUsage() {
			return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
		}

		function addUsage(left, right) {
			return {
				uncachedInputTokens: left.uncachedInputTokens + (right.uncachedInputTokens || 0),
				outputTokens: left.outputTokens + (right.outputTokens || 0),
				cacheReadTokens: left.cacheReadTokens + (right.cacheReadTokens || 0),
				cacheWriteTokens: left.cacheWriteTokens + (right.cacheWriteTokens || 0)
			};
		}

		function contextPercent(pressure) {
			if (!pressure) return null;
			const used = pressure.projectedTokens ?? pressure.pressureTokens;
			if (used === undefined || pressure.contextWindow === undefined) return null;
			return Math.min(100, Math.round(used / pressure.contextWindow * 100));
		}

		function shortSourceLabel(key) {
			// "provider/model" is already compact enough for the floating widget.
			return key;
		}

		function sourceListOf(sources) {
			if (!sources) return [];
			return Object.entries(sources)
				.map(([key, value]) => ({ key, value, total: totalTokens(value) }))
				.sort((a, b) => b.total - a.total);
		}

		// ── component ──────────────────────────────────────────────────────
		function TokenWidget({ useSessions, openSession }) {
			const [expanded, setExpanded] = React.useState(true);
			const sessions = useSessions((s) => s);

			const rows = React.useMemo(() => {
				const byId = sessions.byId || {};
				return (sessions.ids || [])
					.map((id) => byId[id])
					.filter((s) => s && !s.blank)
					.map((s) => {
						const bySource = s.projectionValues && s.projectionValues.tokenUsageBySource
							? s.projectionValues.tokenUsageBySource.sources || {}
							: {};
						return {
							id: s.id,
							title: s.displayTitle || s.id,
							running: !!s.running,
							current: s.id === sessions.current,
							parentId: s.parentId,
							origin: s.origin,
							usage: s.projectionValues && s.projectionValues.tokenUsage,
							stats: s.projectionValues && s.projectionValues.sessionStats,
							pressure: s.projectionValues && s.projectionValues.contextPressure,
							sources: bySource,
							sourceList: sourceListOf(bySource),
							updatedAt: s.updatedAt || 0
						};
					});
			}, [sessions]);

			const totals = React.useMemo(() => {
				let input = 0;
				let output = 0;
				const sourceTotals = {};
				for (const row of rows) {
					input += billedInputTokens(row.usage);
					output += (row.usage && row.usage.outputTokens) || 0;
					for (const [key, value] of Object.entries(row.sources || {})) {
						sourceTotals[key] = addUsage(sourceTotals[key] || zeroUsage(), value);
					}
				}
				return { input, output, total: input + output, sourceTotals };
			}, [rows]);

			if (!expanded) {
				return React.createElement("div", {
					style: styles.collapsed,
					onClick: () => setExpanded(true),
					title: "展开 Token 悬浮窗"
				},
					React.createElement("span", null, "⛽ " + formatNumber(totals.total))
				);
			}

			const sourceSummary = sourceListOf(totals.sourceTotals);

			return React.createElement("div", {
				style: styles.root,
				"data-token-widget": true
			},
				React.createElement("div", { style: styles.header },
					React.createElement("span", { style: styles.title }, "Token 用量"),
					React.createElement("span", { style: styles.total }, formatNumber(totals.total)),
					React.createElement("button", {
						type: "button",
						style: styles.closeBtn,
						onClick: () => setExpanded(false),
						"aria-label": "收起悬浮窗"
					}, "–")
				),
				React.createElement("div", { style: styles.summary },
					React.createElement("span", null, `输入 ${formatNumber(totals.input)}`),
					React.createElement("span", null, `输出 ${formatNumber(totals.output)}`),
					React.createElement("span", null, `窗口 ${rows.length}`)
				),
				React.createElement("div", { style: styles.sources },
					sourceSummary.length === 0
						? React.createElement("span", { style: styles.sourceEmpty }, "暂无来源用量")
						: sourceSummary.map((item) => React.createElement("span", {
							key: item.key,
							style: styles.sourceChip,
							title: `${item.key}：输入 ${formatNumber(billedInputTokens(item.value))} / 输出 ${formatNumber(item.value.outputTokens || 0)}`
						}, `${shortSourceLabel(item.key)} ${formatNumber(item.total)}`))
				),
				React.createElement("div", { style: styles.list },
					rows.length === 0
						? React.createElement("div", { style: styles.empty }, "暂无会话")
						: rows.map((row) => React.createElement("button", {
							key: row.id,
							type: "button",
							style: rowStyle(row),
							onClick: () => {
								if (openSession) openSession(row.id);
							},
							title: `${row.title}\n${row.id}`
						},
							React.createElement("span", { style: styles.rowTitle },
								row.origin === "subagent" ? "↳ " : "",
								row.title
							),
							React.createElement("span", { style: styles.rowMeta },
								row.running
									? React.createElement("span", { style: styles.runningDot }, "● 运行中")
									: React.createElement("span", null, "空闲"),
								row.stats && row.stats.steps > 0 ? ` · ${row.stats.steps} 步 / ${row.stats.turns} 轮` : "",
								row.usage ? ` · ${formatNumber(totalTokens(row.usage))} tok` : "",
								contextPercent(row.pressure) !== null ? ` · ${contextPercent(row.pressure)}% 上下文` : ""
							),
							row.sourceList.length > 0
								? React.createElement("span", { style: styles.rowSources },
									row.sourceList.map((item) => `${shortSourceLabel(item.key)} ${formatNumber(item.total)}`).join(" · ")
								)
								: null
						))
				)
			);
		}

		// ── styles ─────────────────────────────────────────────────────────
		const styles = {
			collapsed: {
				position: "fixed",
				right: "16px",
				bottom: "16px",
				zIndex: 2147483000,
				boxSizing: "border-box",
				background: "var(--dsw-specific-menu, #1e1e1e)",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
				borderRadius: "999px",
				boxShadow: "var(--dsw-shadow-lv3, 0 8px 30px rgba(0,0,0,.35))",
				color: "var(--dsw-alias-label-primary, #eee)",
				cursor: "pointer",
				fontSize: "12px",
				fontWeight: "600",
				lineHeight: "20px",
				padding: "8px 14px",
				pointerEvents: "auto",
				userSelect: "none"
			},
			root: {
				position: "fixed",
				right: "16px",
				bottom: "16px",
				zIndex: 2147483000,
				boxSizing: "border-box",
				width: "360px",
				maxHeight: "70vh",
				display: "flex",
				flexDirection: "column",
				background: "var(--dsw-specific-menu, #1e1e1e)",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
				borderRadius: "14px",
				boxShadow: "var(--dsw-shadow-lv3, 0 8px 30px rgba(0,0,0,.35))",
				color: "var(--dsw-alias-label-primary, #eee)",
				fontSize: "12px",
				lineHeight: "20px",
				overflow: "hidden",
				pointerEvents: "auto"
			},
			header: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				padding: "10px 12px",
				borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))",
				background: "var(--dsw-specific-tip, transparent)"
			},
			title: {
				flex: "1",
				fontWeight: "600"
			},
			total: {
				fontVariantNumeric: "tabular-nums",
				fontWeight: "700"
			},
			closeBtn: {
				background: "transparent",
				border: "none",
				color: "var(--dsw-alias-label-tertiary, #999)",
				cursor: "pointer",
				fontSize: "16px",
				lineHeight: "1",
				padding: "2px 6px",
				borderRadius: "6px"
			},
			summary: {
				display: "flex",
				gap: "12px",
				padding: "8px 12px 4px",
				color: "var(--dsw-alias-label-secondary, #bbb)",
				borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))",
				fontVariantNumeric: "tabular-nums"
			},
			sources: {
				display: "flex",
				flexWrap: "wrap",
				gap: "4px 6px",
				padding: "6px 12px",
				borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))"
			},
			sourceChip: {
				boxSizing: "border-box",
				background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.15))",
				borderRadius: "999px",
				color: "var(--dsw-alias-label-secondary, #bbb)",
				fontSize: "11px",
				lineHeight: "18px",
				padding: "0 8px",
				whiteSpace: "nowrap",
				fontVariantNumeric: "tabular-nums"
			},
			sourceEmpty: {
				color: "var(--dsw-alias-label-tertiary, #999)",
				fontSize: "11px"
			},
			list: {
				overflowY: "auto",
				padding: "6px",
				maxHeight: "calc(70vh - 130px)"
			},
			rowTitle: {
				display: "block",
				fontWeight: "500",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis"
			},
			rowMeta: {
				display: "block",
				marginTop: "2px",
				fontSize: "11px",
				color: "var(--dsw-alias-label-tertiary, #999)",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
				fontVariantNumeric: "tabular-nums"
			},
			rowSources: {
				display: "block",
				marginTop: "2px",
				fontSize: "10px",
				lineHeight: "16px",
				color: "var(--dsw-alias-label-caption, #777)",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
				fontVariantNumeric: "tabular-nums"
			},
			runningDot: {
				color: "#4ade80"
			},
			empty: {
				padding: "16px",
				textAlign: "center",
				color: "var(--dsw-alias-label-tertiary, #999)"
			}
		};

		function rowStyle(row) {
			return {
				display: "block",
				width: "100%",
				boxSizing: "border-box",
				textAlign: "left",
				background: "transparent",
				border: "none",
				borderRadius: "8px",
				padding: "8px 10px",
				marginBottom: "2px",
				cursor: "pointer",
				color: "var(--dsw-alias-label-primary, #eee)",
				boxShadow: row.current ? "inset 2px 0 0 var(--dsw-alias-state-business-primary, #4f8cff)" : undefined
			};
		}

		// ── plugin body ────────────────────────────────────────────────────
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "token-widget",
				order: 100,
				label: "Token 用量悬浮窗",
				inject: () => ({
					openSession: (id) => ctx.sessions.open(id)
				})
			}, TokenWidget));
		}

		const inject = ["slots", "sessions"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
