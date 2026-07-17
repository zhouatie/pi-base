/**
 * Adapts Pi runtime state to the title markers recognized by this machine's
 * Kitty tab-bar title-marker protocol.
 *
 * Title protocol:
 * - Thinking        -> purple tab
 * - Working         -> yellow tab
 * - Action required -> red tab
 * - Ready           -> green tab until the tab is acknowledged
 * - no marker       -> normal idle tab
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ANIMATION_INTERVAL_MS = 80;

type TitleState = "idle" | "thinking" | "working" | "action-required" | "ready";
type RestingState = Extract<TitleState, "idle" | "ready">;

type PermissionUiPrompt = {
	value?: unknown;
	message?: unknown;
};

type PermissionDecision = {
	resolution?: unknown;
};

function isPermissionUiPrompt(raw: unknown): raw is PermissionUiPrompt {
	if (!raw || typeof raw !== "object") return false;
	const event = raw as PermissionUiPrompt;
	return typeof event.value === "string" || typeof event.message === "string";
}

function isUserPermissionDecision(raw: unknown): raw is PermissionDecision {
	if (!raw || typeof raw !== "object") return false;
	const { resolution } = raw as PermissionDecision;
	return (
		typeof resolution === "string" &&
		(resolution.startsWith("user_") || resolution === "confirmation_unavailable")
	);
}

function getBaseTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
	const cwd = path.basename(ctx.cwd) || ctx.cwd;
	const session = pi.getSessionName();
	return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
}

function isAnimatedState(state: TitleState): state is "thinking" | "working" {
	return state === "thinking" || state === "working";
}

function statusLabel(state: "thinking" | "working"): "Thinking" | "Working" {
	return state === "thinking" ? "Thinking" : "Working";
}

export default function kittyTabStatus(pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let frameIndex = 0;
	let titleState: TitleState = "idle";
	let restingState: RestingState = "idle";
	let agentRunning = false;
	let permissionPending = false;
	let currentCtx: ExtensionContext | undefined;
	const activeToolCallIds = new Set<string>();

	function stopAnimation() {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
		frameIndex = 0;
	}

	function renderTitle(ctx: ExtensionContext) {
		const baseTitle = getBaseTitle(pi, ctx);
		switch (titleState) {
			case "thinking":
			case "working": {
				const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
				frameIndex++;
				ctx.ui.setTitle(`${frame} ${statusLabel(titleState)} | ${baseTitle}`);
				break;
			}
			case "action-required":
				ctx.ui.setTitle(`Action required | ${baseTitle}`);
				break;
			case "ready":
				ctx.ui.setTitle(`Ready | ${baseTitle}`);
				break;
			case "idle":
				ctx.ui.setTitle(baseTitle);
				break;
		}
	}

	function startAnimation() {
		if (timer) return;
		timer = setInterval(() => {
			if (currentCtx) renderTitle(currentCtx);
		}, ANIMATION_INTERVAL_MS);
	}

	function setTitleState(state: TitleState, ctx: ExtensionContext) {
		currentCtx = ctx;
		if (titleState === state) {
			renderTitle(ctx);
			if (isAnimatedState(state)) startAnimation();
			return;
		}

		stopAnimation();
		titleState = state;
		renderTitle(ctx);
		if (isAnimatedState(state)) startAnimation();
	}

	function activeState(): TitleState {
		if (permissionPending) return "action-required";
		if (activeToolCallIds.size > 0) return "working";
		if (agentRunning) return "thinking";
		return restingState;
	}

	function refreshActiveState(ctx: ExtensionContext) {
		setTitleState(activeState(), ctx);
	}

	const unsubscribePermissionPrompt = pi.events.on("permissions:ui_prompt", (raw) => {
		if (!currentCtx || !isPermissionUiPrompt(raw)) return;
		permissionPending = true;
		refreshActiveState(currentCtx);
	});

	const unsubscribePermissionDecision = pi.events.on("permissions:decision", (raw) => {
		if (!currentCtx || !permissionPending || !isUserPermissionDecision(raw)) return;
		permissionPending = false;
		refreshActiveState(currentCtx);
	});

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		restingState = "idle";
		agentRunning = false;
		permissionPending = false;
		activeToolCallIds.clear();
		setTitleState("idle", ctx);
	});

	pi.on("session_info_changed", async (_event, ctx) => {
		currentCtx = ctx;
		renderTitle(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		currentCtx = ctx;
		restingState = "idle";
		agentRunning = true;
		permissionPending = false;
		activeToolCallIds.clear();
		refreshActiveState(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		currentCtx = ctx;
		if (!permissionPending && activeToolCallIds.size === 0) {
			setTitleState("thinking", ctx);
		}
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		currentCtx = ctx;
		activeToolCallIds.add(event.toolCallId);
		refreshActiveState(ctx);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		currentCtx = ctx;
		activeToolCallIds.delete(event.toolCallId);
		refreshActiveState(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		currentCtx = ctx;
		restingState = "ready";
		agentRunning = false;
		permissionPending = false;
		activeToolCallIds.clear();
		setTitleState("ready", ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		restingState = "idle";
		agentRunning = false;
		permissionPending = false;
		activeToolCallIds.clear();
		setTitleState("idle", ctx);
		currentCtx = undefined;
		unsubscribePermissionPrompt();
		unsubscribePermissionDecision();
	});
}
