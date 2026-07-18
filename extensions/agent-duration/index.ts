import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "pi-base.agent-duration";

type TimingState = {
	queuedAt?: number;
	agentStartedAt?: number;
	queueDuration?: number;
	providerStartedAt?: number;
	firstResponseDuration?: number;
	modelDuration: number;
	toolStartedAt: Map<string, number>;
	toolDuration: number;
	toolCount: number;
};

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
	if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1_000)}s`;

	const minutes = Math.floor(milliseconds / 60_000);
	const seconds = Math.floor((milliseconds % 60_000) / 1_000);
	return `${minutes}m ${seconds}s`;
}

function createTimingState(): TimingState {
	return {
		modelDuration: 0,
		toolStartedAt: new Map(),
		toolDuration: 0,
		toolCount: 0,
	};
}

export default function (pi: ExtensionAPI) {
	let timing = createTimingState();
	let timer: ReturnType<typeof setInterval> | undefined;

	function stopTimer() {
		if (timer === undefined) return;
		clearInterval(timer);
		timer = undefined;
	}

	function getModelDuration(now: number): number {
		return timing.modelDuration + (timing.providerStartedAt === undefined
			? 0
			: now - timing.providerStartedAt);
	}

	function getToolDuration(now: number): number {
		let runningDuration = 0;
		for (const startedAt of timing.toolStartedAt.values()) {
			runningDuration += now - startedAt;
		}
		return timing.toolDuration + runningDuration;
	}

	function updateStatus(ctx: ExtensionContext) {
		if (timing.agentStartedAt === undefined) return;

		const now = performance.now();
		const items = [
			`Agent: ${formatDuration(now - timing.agentStartedAt)}`,
			`等待: ${formatDuration(timing.queueDuration ?? 0)}`,
			`模型: ${formatDuration(getModelDuration(now))}`,
			`工具: ${formatDuration(getToolDuration(now))}/${timing.toolCount}次`,
		];
		if (timing.firstResponseDuration !== undefined) {
			items.push(`首字: ${formatDuration(timing.firstResponseDuration)}`);
		}

		ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", items.join(" · ")));
	}

	function finishProviderRequest(now: number) {
		if (timing.providerStartedAt === undefined) return;
		timing.modelDuration += now - timing.providerStartedAt;
		timing.providerStartedAt = undefined;
	}

	function finishRunningTools(now: number) {
		for (const startedAt of timing.toolStartedAt.values()) {
			timing.toolDuration += now - startedAt;
		}
		timing.toolStartedAt.clear();
	}

	pi.on("input", () => {
		timing.queuedAt = performance.now();
	});

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		stopTimer();
		const now = performance.now();
		const queuedAt = timing.queuedAt;
		timing = createTimingState();
		timing.agentStartedAt = now;
		timing.queueDuration = queuedAt === undefined ? 0 : now - queuedAt;
		timing.queuedAt = undefined;
		updateStatus(ctx);
		timer = setInterval(() => updateStatus(ctx), 1_000);
	});

	pi.on("before_provider_request", () => {
		if (timing.agentStartedAt === undefined) return;
		const now = performance.now();
		finishProviderRequest(now);
		timing.providerStartedAt = now;
	});

	pi.on("message_update", (event) => {
		if (timing.providerStartedAt === undefined || timing.firstResponseDuration !== undefined) return;
		if (event.message.role !== "assistant") return;
		timing.firstResponseDuration = performance.now() - timing.providerStartedAt;
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		finishProviderRequest(performance.now());
	});

	pi.on("tool_execution_start", (event) => {
		if (timing.agentStartedAt === undefined) return;
		timing.toolStartedAt.set(event.toolCallId, performance.now());
		timing.toolCount += 1;
	});

	pi.on("tool_execution_end", (event) => {
		const startedAt = timing.toolStartedAt.get(event.toolCallId);
		if (startedAt === undefined) return;
		timing.toolDuration += performance.now() - startedAt;
		timing.toolStartedAt.delete(event.toolCallId);
	});

	pi.on("agent_end", (_event, ctx) => {
		if (ctx.mode !== "tui" || timing.agentStartedAt === undefined) return;

		const now = performance.now();
		finishProviderRequest(now);
		finishRunningTools(now);
		updateStatus(ctx);
		timing.agentStartedAt = undefined;
		stopTimer();
	});

	pi.on("session_shutdown", () => {
		timing = createTimingState();
		stopTimer();
	});
}
