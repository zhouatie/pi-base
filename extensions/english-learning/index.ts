import {
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionContext,
	type InputEvent,
	type InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { Container, Key, Markdown, Text } from "@earendil-works/pi-tui";
import { inputReviewTarget, normalizeCosmeticEnglish, type InputReviewTarget } from "./input-review.ts";
import { EnglishReviewComponent, type ReviewAction } from "./review-ui.ts";
import { reviewEnglishWithDeepSeek, translateWithDeepSeek, type EnglishReview } from "./translator.ts";

const WIDGET_ID = "pi-base.english-learning.translation";
const STATUS_ID = "pi-base.english-learning.status";
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
	let sessionGeneration = 0;

	function enqueueInputReview<T>(work: () => Promise<T>): Promise<T> {
		const previous = inputReviewTail;
		let release!: () => void;
		inputReviewTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		return previous.then(work).finally(release);
	}

	function cancelInputReviews() {
		sessionGeneration++;
		for (const controller of inputReviewControllers) controller.abort();
		inputReviewControllers.clear();
		cancelActiveInputDialog?.();
		cancelActiveInputDialog = undefined;
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
		cancelInputReviews();
		clearReplyTranslation(ctx, true);
	}

	function prepareForSessionTransition(ctx: ExtensionContext): { cancel: true } | undefined {
		if (inputEditorActive) {
			ctx.ui.notify("请先关闭英语编辑界面，再切换会话。", "warning");
			return { cancel: true };
		}
		cancelInputReviews();
		return undefined;
	}

	pi.on("session_before_switch", (_event, ctx) => prepareForSessionTransition(ctx));
	pi.on("session_before_fork", (_event, ctx) => prepareForSessionTransition(ctx));
	pi.on("session_before_tree", (_event, ctx) => prepareForSessionTransition(ctx));

	pi.on("session_start", (_event, ctx) => {
		resetSessionState(ctx);
	});

	async function processInputReview(
		event: InputEvent,
		ctx: ExtensionContext,
		target: InputReviewTarget,
		generation: number,
	): Promise<InputEventResult> {
		if (generation !== sessionGeneration) return { action: "handled" };

		const original = event.text;
		const controller = new AbortController();
		inputReviewControllers.add(controller);
		try {
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", "正在检查并优化英文…"));
		} catch {}

		let review: EnglishReview;
		try {
			review = await reviewEnglishWithDeepSeek(target.source, controller.signal);
		} catch (error) {
			if (generation !== sessionGeneration || controller.signal.aborted) return { action: "handled" };
			const reason = error instanceof Error ? error.message : "Unknown DeepSeek error.";
			ctx.ui.notify(`英语检查失败，将直接发送原文。${reason}`, "warning");
			return { action: "continue" };
		} finally {
			inputReviewControllers.delete(controller);
			if (inputReviewControllers.size === 0 && generation === sessionGeneration) {
				try {
					ctx.ui.setStatus(STATUS_ID, undefined);
				} catch {}
			}
		}

		if (generation !== sessionGeneration) return { action: "handled" };
		if (normalizeCosmeticEnglish(target.source) === normalizeCosmeticEnglish(review.english)) {
			return {
				action: "transform",
				text: target.rebuild(review.english),
				images: event.images,
			};
		}

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
			if (generation === sessionGeneration) {
				restoreUnsubmittedInput(ctx, original, "无法打开英语学习界面，原文未提交。", "error");
			}
			return { action: "handled" };
		} finally {
			if (cancelActiveInputDialog === closeDialog) cancelActiveInputDialog = undefined;
		}
		if (generation !== sessionGeneration) return { action: "handled" };
		if (action === "cancel") {
			restoreUnsubmittedInput(ctx, original, "已取消，原文未提交。", "info");
			return { action: "handled" };
		}

		let confirmed = review.english;
		if (action === "edit") {
			let edited: string | undefined;
			inputEditorActive = true;
			try {
				edited = await ctx.ui.editor("编辑发送给 Agent 的英文（Esc 取消）", review.english);
			} catch {
				if (generation === sessionGeneration) {
					restoreUnsubmittedInput(ctx, original, "无法打开英文编辑界面，原文未提交。", "error");
				}
				return { action: "handled" };
			} finally {
				inputEditorActive = false;
			}
			if (generation !== sessionGeneration) return { action: "handled" };
			if (!edited?.trim()) {
				restoreUnsubmittedInput(ctx, original, "已取消，原文未提交。", "info");
				return { action: "handled" };
			}
			confirmed = edited;
		}
		if (generation !== sessionGeneration) return { action: "handled" };

		return {
			action: "transform",
			text: target.rebuild(confirmed),
			images: event.images,
		};
	}

	pi.on("input", (event, ctx) => {
		clearReplyTranslation(ctx, true);
		if (event.source !== "interactive") return { action: "continue" };

		const target = inputReviewTarget(event.text);
		if (!target) return { action: "continue" };

		const generation = sessionGeneration;
		return enqueueInputReview(() => processInputReview(event, ctx, target, generation));
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${ENGLISH_REPLY_INSTRUCTION}`,
	}));

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
			const generation = sessionGeneration;
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", "正在翻译最新回复…"));

			try {
				const translated = await translateWithDeepSeek(assistant.text, "en-zh", controller.signal);
				if (generation !== sessionGeneration || controller.signal.aborted || !ctx.isIdle()) return;

				const current = latestAssistant(ctx);
				if (!current || current.entryId !== assistant.entryId) return;

				cachedTranslation = {
					assistantEntryId: assistant.entryId,
					text: translated,
				};
				renderTranslationWidget(ctx, translated);
				translationVisible = true;
			} catch {
				if (generation === sessionGeneration && !controller.signal.aborted) {
					ctx.ui.notify("回复翻译失败。请检查 DEEPSEEK_API_KEY 或稍后重试。", "error");
				}
			} finally {
				if (replyTranslationController === controller) {
					replyTranslationController = undefined;
					if (generation === sessionGeneration) ctx.ui.setStatus(STATUS_ID, undefined);
				}
			}
		},
	});

	pi.on("session_shutdown", (_event, ctx) => {
		resetSessionState(ctx);
	});
}
