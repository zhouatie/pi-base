import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "pi-base.agent-duration";

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
	if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;

	const minutes = Math.floor(milliseconds / 60_000);
	const seconds = ((milliseconds % 60_000) / 1_000).toFixed(1);
	return `${minutes}m ${seconds}s`;
}

export default function (pi: ExtensionAPI) {
	let startedAt: number | undefined;

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		startedAt = performance.now();
	});

	pi.on("agent_end", (_event, ctx) => {
		if (ctx.mode !== "tui" || startedAt === undefined) return;

		const duration = performance.now() - startedAt;
		startedAt = undefined;
		ctx.ui.setStatus(
			STATUS_ID,
			ctx.ui.theme.fg("dim", `最近 Agent: ${formatDuration(duration)}`),
		);
	});
}
