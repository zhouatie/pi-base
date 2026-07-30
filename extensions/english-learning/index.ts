import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, Markdown, Text } from "@earendil-works/pi-tui";
import { translateWithDeepSeek } from "./translator.ts";

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

function containsChinese(text: string): boolean {
	return /\p{Script=Han}/u.test(text);
}

function isCommand(text: string): boolean {
	const trimmed = text.trimStart();
	if (trimmed.startsWith("!")) return true;

	const firstLine = trimmed.split(/\r?\n/, 1)[0];
	return /^\/[A-Za-z0-9][A-Za-z0-9:_-]*(?:\s|$)/.test(firstLine);
}

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
	let inputTranslationController: AbortController | undefined;
	let sessionGeneration = 0;

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
		sessionGeneration++;
		inputTranslationController?.abort();
		inputTranslationController = undefined;
		clearReplyTranslation(ctx, true);
	}

	pi.on("session_start", (_event, ctx) => {
		resetSessionState(ctx);
	});

	pi.on("input", async (event, ctx) => {
		clearReplyTranslation(ctx, true);
		if (event.source !== "interactive" || isCommand(event.text) || !containsChinese(event.text)) {
			return { action: "continue" };
		}

		const original = event.text;
		const generation = sessionGeneration;
		const controller = new AbortController();
		inputTranslationController?.abort();
		inputTranslationController = controller;
		try {
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", "正在将输入翻译为英文…"));
		} catch {}

		let translated: string;
		try {
			translated = await translateWithDeepSeek(original, "zh-en", controller.signal);
		} catch {
			if (generation === sessionGeneration) {
				restoreUnsubmittedInput(
					ctx,
					original,
					"输入翻译失败，原文未提交。请检查 DEEPSEEK_API_KEY 或稍后重试。",
					"error",
				);
			}
			return { action: "handled" };
		} finally {
			if (inputTranslationController === controller) {
				inputTranslationController = undefined;
				if (generation === sessionGeneration) {
					try {
						ctx.ui.setStatus(STATUS_ID, undefined);
					} catch {}
				}
			}
		}

		if (generation !== sessionGeneration) return { action: "handled" };
		let confirmed: string | undefined;
		try {
			confirmed = await ctx.ui.editor("确认发送的英文（可编辑，Esc 取消）", translated);
		} catch {
			if (generation === sessionGeneration) {
				restoreUnsubmittedInput(ctx, original, "无法打开英文确认界面，原文未提交。", "error");
			}
			return { action: "handled" };
		}
		if (generation !== sessionGeneration) return { action: "handled" };
		if (!confirmed?.trim()) {
			restoreUnsubmittedInput(ctx, original, "已取消，原文未提交。", "info");
			return { action: "handled" };
		}

		return {
			action: "transform",
			text: confirmed,
			images: event.images,
		};
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
