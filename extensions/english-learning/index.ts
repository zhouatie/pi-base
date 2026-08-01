import {
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionContext,
	type InputEvent,
	type InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { Container, Key, Markdown, Text } from "@earendil-works/pi-tui";
import { InputReviewCancellationState } from "./input-review-cancellation.ts";
import { inputReviewTarget, normalizeCosmeticEnglish, type InputReviewTarget } from "./input-review.ts";
import { EnglishReviewComponent, type ReviewAction } from "./review-ui.ts";
import {
	automaticTranslationEnabled,
	englishReplySystemPrompt,
	parseTranslationModeCommand,
	TRANSLATION_MODE_ENTRY_TYPE,
	translationModeFromEntries,
	type TranslationMode,
} from "./translation-mode.ts";
import { reviewEnglishWithDeepSeek, translateWithDeepSeek, type EnglishReview } from "./translator.ts";

const WIDGET_ID = "pi-base.english-learning.translation";
const STATUS_ID = "pi-base.english-learning.status";
const MODE_STATUS_ID = "pi-base.english-learning.mode-status";
const TRANS_COMMAND_USAGE = "Usage: /trans on | off | status";
const ENGLISH_REPLY_INSTRUCTION = [
	"English learning mode is enabled.",
	"Reply in clear, natural English by default.",
	"Keep code, commands, paths, and identifiers unchanged, and do not add a Chinese translation.",
].join(" ");

type AssistantSnapshot = {
	entryId: string;
	text: string;
};

type CachedTranslation = {
	assistantEntryId: string;
	text: string;
};

function assistantText(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const candidate = message as { role?: unknown; stopReason?: unknown; content?: unknown };
	if (candidate.role !== "assistant") return undefined;
	if (candidate.stopReason !== "stop" && candidate.stopReason !== "length") return undefined;
	if (!Array.isArray(candidate.content)) return undefined;

	const text = candidate.content
		.filter((block): block is { type: "text"; text: string } => {
			if (!block || typeof block !== "object") return false;
			const value = block as { type?: unknown; text?: unknown };
			return value.type === "text" && typeof value.text === "string";
		})
		.map((block) => block.text)
		.join("\n")
		.trim();
	return text || undefined;
}

function latestAssistant(ctx: ExtensionContext): AssistantSnapshot | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "message") continue;
		if (!entry.message || typeof entry.message !== "object" || entry.message.role !== "assistant") continue;

		const text = assistantText(entry.message);
		return text ? { entryId: entry.id, text } : undefined;
	}
	return undefined;
}

function renderTranslationWidget(ctx: ExtensionContext, translation: string) {
	ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => {
		const container = new Container();
		container.addChild(new Text(theme.fg("muted", theme.bold("中文翻译")), 1, 0));
		container.addChild(new Markdown(translation, 1, 0, getMarkdownTheme()));
		return container;
	});
}

function restoreUnsubmittedInput(ctx: ExtensionContext, original: string, message: string, level: "info" | "error") {
	try {
		ctx.ui.setEditorText(original);
	} catch {}
	try {
		ctx.ui.notify(message, level);
	} catch {}
}

export default function englishLearning(pi: ExtensionAPI) {
	let cachedTranslation: CachedTranslation | undefined;
	let translationVisible = false;
	let replyTranslationController: AbortController | undefined;
	const inputReviewControllers = new Set<AbortController>();
	let inputReviewTail: Promise<void> = Promise.resolve();
	let cancelActiveInputDialog: (() => void) | undefined;
	let inputEditorActive = false;
	const inputReviewCancellation = new InputReviewCancellationState();
	let translationMode: TranslationMode = "on";

	function enqueueInputReview<T>(work: () => Promise<T>): Promise<T> {
		const previous = inputReviewTail;
		let release!: () => void;
		inputReviewTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		return previous.then(work).finally(release);
	}

	function cancelInputReviews(action: "continue" | "handled") {
		inputReviewCancellation.cancel(action);
		for (const controller of inputReviewControllers) controller.abort();
		inputReviewControllers.clear();
		cancelActiveInputDialog?.();
		cancelActiveInputDialog = undefined;
	}

	function canceledInputReviewResult(generation: number): InputEventResult | undefined {
		const outcome = inputReviewCancellation.outcome(generation);
		return outcome === "active" ? undefined : { action: outcome };
	}

	function abortedInputReviewResult(generation: number): InputEventResult {
		return canceledInputReviewResult(generation) ?? { action: "handled" };
	}

	function clearReplyTranslation(ctx: ExtensionContext, clearCache: boolean) {
		replyTranslationController?.abort();
		replyTranslationController = undefined;
		translationVisible = false;
		if (clearCache) cachedTranslation = undefined;
		try {
			ctx.ui.setWidget(WIDGET_ID, undefined);
		} catch {}
		try {
			ctx.ui.setStatus(STATUS_ID, undefined);
		} catch {}
	}

	function resetSessionState(ctx: ExtensionContext) {
		cancelInputReviews("handled");
		clearReplyTranslation(ctx, true);
	}

	function renderTranslationModeStatus(ctx: ExtensionContext) {
		try {
			ctx.ui.setStatus(
				MODE_STATUS_ID,
				translationMode === "off" ? ctx.ui.theme.fg("muted", "Translation: off") : undefined,
			);
		} catch {}
	}

	function restoreTranslationMode(ctx: ExtensionContext) {
		translationMode = translationModeFromEntries(ctx.sessionManager.getBranch());
		renderTranslationModeStatus(ctx);
	}

	function prepareForSessionTransition(ctx: ExtensionContext): { cancel: true } | undefined {
		if (inputEditorActive) {
			ctx.ui.notify("请先关闭英语编辑界面，再切换会话。", "warning");
			return { cancel: true };
		}
		cancelInputReviews("handled");
		return undefined;
	}

	pi.on("session_before_switch", (_event, ctx) => prepareForSessionTransition(ctx));
	pi.on("session_before_fork", (_event, ctx) => prepareForSessionTransition(ctx));
	pi.on("session_before_tree", (_event, ctx) => prepareForSessionTransition(ctx));

	pi.on("session_start", (_event, ctx) => {
		resetSessionState(ctx);
		restoreTranslationMode(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		restoreTranslationMode(ctx);
	});

	pi.registerCommand("trans", {
		description: "Enable, disable, or show automatic English translation",
		handler: async (args, ctx) => {
			const command = parseTranslationModeCommand(args);
			if (command === "status") {
				ctx.ui.notify(`Translation: ${translationMode}`, "info");
				return;
			}
			if (!command) {
				const prefix = args.trim() ? "" : `Translation: ${translationMode}\n`;
				ctx.ui.notify(`${prefix}${TRANS_COMMAND_USAGE}`, args.trim() ? "warning" : "info");
				return;
			}

			const modeChanged = command !== translationMode;
			if (modeChanged) {
				translationMode = command;
				pi.appendEntry(TRANSLATION_MODE_ENTRY_TYPE, { mode: translationMode });
			}
			if (modeChanged && translationMode === "off") {
				cancelInputReviews("continue");
				try {
					ctx.ui.setStatus(STATUS_ID, undefined);
				} catch {}
			}
			renderTranslationModeStatus(ctx);
			ctx.ui.notify(`Translation: ${translationMode}`, "info");
		},
	});

	async function processInputReview(
		event: InputEvent,
		ctx: ExtensionContext,
		target: InputReviewTarget,
		generation: number,
	): Promise<InputEventResult> {
		const canceledBeforeStart = canceledInputReviewResult(generation);
		if (canceledBeforeStart) return canceledBeforeStart;

		const original = event.text;
		const requestReview = async (
			preserveQuotedContent: boolean,
			statusMessage: string,
		): Promise<EnglishReview | "aborted" | "failed"> => {
			const controller = new AbortController();
			inputReviewControllers.add(controller);
			try {
				ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", statusMessage));
			} catch {}

			try {
				const review = await reviewEnglishWithDeepSeek(target.source, controller.signal, preserveQuotedContent);
				if (canceledInputReviewResult(generation) || controller.signal.aborted) return "aborted";
				return review;
			} catch (error) {
				if (canceledInputReviewResult(generation) || controller.signal.aborted) return "aborted";
				const reason = error instanceof Error ? error.message : "Unknown DeepSeek error.";
				ctx.ui.notify(`英语检查失败，将直接发送原文。${reason}`, "warning");
				return "failed";
			} finally {
				inputReviewControllers.delete(controller);
				if (inputReviewControllers.size === 0 && !canceledInputReviewResult(generation)) {
					try {
						ctx.ui.setStatus(STATUS_ID, undefined);
					} catch {}
				}
			}
		};

		const initialReview = await requestReview(true, "正在检查并优化英文…");
		if (initialReview === "aborted") return abortedInputReviewResult(generation);
		if (initialReview === "failed") return { action: "continue" };
		let review = initialReview;

		if (
			!review.preservedQuotedContent &&
			normalizeCosmeticEnglish(target.source) === normalizeCosmeticEnglish(review.english)
		) {
			return {
				action: "transform",
				text: target.rebuild(review.english),
				images: event.images,
			};
		}

		while (true) {
			let action: ReviewAction;
			let closeDialog: (() => void) | undefined;
			try {
				action = await ctx.ui.custom<ReviewAction>((_tui, theme, _keybindings, done) => {
					const component = new EnglishReviewComponent(target.source, review, theme, done);
					closeDialog = () => component.cancel();
					cancelActiveInputDialog = closeDialog;
					return component;
				});
			} catch {
				const canceled = canceledInputReviewResult(generation);
				if (canceled) return canceled;
				restoreUnsubmittedInput(ctx, original, "无法打开英语学习界面，原文未提交。", "error");
				return { action: "handled" };
			} finally {
				if (cancelActiveInputDialog === closeDialog) cancelActiveInputDialog = undefined;
			}
			const canceledAfterDialog = canceledInputReviewResult(generation);
			if (canceledAfterDialog) return canceledAfterDialog;
			if (action === "cancel") {
				restoreUnsubmittedInput(ctx, original, "已取消，原文未提交。", "info");
				return { action: "handled" };
			}
			if (action === "send-original") return { action: "continue" };
			if (action === "review-all") {
				const fullReview = await requestReview(false, "正在检查全部内容…");
				if (fullReview === "aborted") return abortedInputReviewResult(generation);
				if (fullReview === "failed") return { action: "continue" };
				review = fullReview;
				continue;
			}

			let confirmed = review.english;
			if (action === "edit") {
				let edited: string | undefined;
				inputEditorActive = true;
				try {
					edited = await ctx.ui.editor("编辑发送给 Agent 的英文（Esc 取消）", review.english);
				} catch {
					const canceled = canceledInputReviewResult(generation);
					if (canceled) return canceled;
					restoreUnsubmittedInput(ctx, original, "无法打开英文编辑界面，原文未提交。", "error");
					return { action: "handled" };
				} finally {
					inputEditorActive = false;
				}
				const canceledAfterEditor = canceledInputReviewResult(generation);
				if (canceledAfterEditor) return canceledAfterEditor;
				if (!edited?.trim()) {
					restoreUnsubmittedInput(ctx, original, "已取消，原文未提交。", "info");
					return { action: "handled" };
				}
				confirmed = edited;
			}
			const canceledBeforeSubmit = canceledInputReviewResult(generation);
			if (canceledBeforeSubmit) return canceledBeforeSubmit;

			return {
				action: "transform",
				text: target.rebuild(confirmed),
				images: event.images,
			};
		}
	}

	pi.on("input", (event, ctx) => {
		clearReplyTranslation(ctx, true);
		if (event.source !== "interactive" || !automaticTranslationEnabled(translationMode)) {
			return { action: "continue" };
		}

		const target = inputReviewTarget(event.text);
		if (!target) return { action: "continue" };

		const generation = inputReviewCancellation.capture();
		return enqueueInputReview(() => processInputReview(event, ctx, target, generation)).finally(() => {
			inputReviewCancellation.release(generation);
		});
	});

	pi.on("before_agent_start", (event) => {
		const systemPrompt = englishReplySystemPrompt(
			event.systemPrompt,
			ENGLISH_REPLY_INSTRUCTION,
			translationMode,
		);
		return systemPrompt === undefined ? undefined : { systemPrompt };
	});

	pi.on("agent_start", (_event, ctx) => {
		clearReplyTranslation(ctx, true);
	});

	pi.registerShortcut(Key.ctrlShift("y"), {
		description: "翻译或隐藏最新一条 Agent 英文回复",
		handler: async (ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("请等待 Agent 完成后再翻译。", "warning");
				return;
			}

			const assistant = latestAssistant(ctx);
			if (!assistant) {
				ctx.ui.notify("没有可翻译的最新英文回复。", "warning");
				return;
			}

			if (cachedTranslation?.assistantEntryId === assistant.entryId) {
				if (translationVisible) {
					ctx.ui.setWidget(WIDGET_ID, undefined);
					translationVisible = false;
				} else {
					renderTranslationWidget(ctx, cachedTranslation.text);
					translationVisible = true;
				}
				return;
			}

			replyTranslationController?.abort();
			const controller = new AbortController();
			replyTranslationController = controller;
			const generation = inputReviewCancellation.generation;
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", "正在翻译最新回复…"));

			try {
				const translated = await translateWithDeepSeek(assistant.text, "en-zh", controller.signal);
				if (
					generation !== inputReviewCancellation.generation ||
					controller.signal.aborted ||
					!ctx.isIdle()
				) return;

				const current = latestAssistant(ctx);
				if (!current || current.entryId !== assistant.entryId) return;

				cachedTranslation = {
					assistantEntryId: assistant.entryId,
					text: translated,
				};
				renderTranslationWidget(ctx, translated);
				translationVisible = true;
			} catch {
				if (generation === inputReviewCancellation.generation && !controller.signal.aborted) {
					ctx.ui.notify("回复翻译失败。请检查 DEEPSEEK_PI_TRANSLATE_API_KEY 或稍后重试。", "error");
				}
			} finally {
				if (replyTranslationController === controller) {
					replyTranslationController = undefined;
					if (generation === inputReviewCancellation.generation) ctx.ui.setStatus(STATUS_ID, undefined);
				}
			}
		},
	});

	pi.on("session_shutdown", (_event, ctx) => {
		resetSessionState(ctx);
		try {
			ctx.ui.setStatus(MODE_STATUS_ID, undefined);
		} catch {}
	});
}
