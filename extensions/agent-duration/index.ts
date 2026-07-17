import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "pi-base.agent-duration";

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
	if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1_000)}s`;

	const minutes = Math.floor(milliseconds / 60_000);
	const seconds = Math.floor((milliseconds % 60_000) / 1_000);
	return `${minutes}m ${seconds}s`;
}

export default function (pi: ExtensionAPI) {
	let startedAt: number | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;

	function stopTimer() {
		if (timer === undefined) return;
		clearInterval(timer);
		timer = undefined;
	}

	function updateStatus(ctx: ExtensionContext) {
		if (startedAt === undefined) return;
		const duration = performance.now() - startedAt;
		ctx.ui.setStatus(
			STATUS_ID,
			ctx.ui.theme.fg("dim", `最近 Agent: ${formatDuration(duration)}`),
		);
	}

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		stopTimer();
		startedAt = performance.now();
		updateStatus(ctx);
		timer = setInterval(() => updateStatus(ctx), 1_000);
	});

	pi.on("agent_end", (_event, ctx) => {
		if (ctx.mode !== "tui" || startedAt === undefined) return;

		updateStatus(ctx);
		startedAt = undefined;
		stopTimer();
	});

	pi.on("session_shutdown", () => {
		startedAt = undefined;
		stopTimer();
	});
}
