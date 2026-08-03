import {
    CustomEditor,
    getMarkdownTheme,
    type ExtensionAPI,
    type ExtensionContext,
    type InputEvent,
    type InputEventResult,
} from '@earendil-works/pi-coding-agent';
import { Container, Key, Markdown, Text } from '@earendil-works/pi-tui';
import { InputReviewCancellationState } from './input-review-cancellation.ts';
import {
    inputReviewTarget,
    normalizeCosmeticEnglish,
    type InputReviewTarget,
} from './input-review.ts';
import {
    currentLiveRecommendation,
    LivePreviewController,
    type LivePreviewState,
} from './live-preview.ts';
import { LivePreviewEditor } from './live-preview-editor.ts';
import { LivePreviewComponent } from './live-preview-ui.ts';
import { EnglishReviewComponent, type ReviewAction } from './review-ui.ts';
import {
    DEFAULT_TRANSLATION_MODE,
    englishReplySystemPrompt,
    livePreviewEnabled,
    nextTranslationMode,
    parseTranslationModeCommand,
    submitTimeReviewEnabled,
    TRANSLATION_MODE_ENTRY_TYPE,
    translationModeFromEntries,
    type TranslationMode,
} from './translation-mode.ts';
import {
    recommendEnglishWithDeepSeek,
    reviewEnglishWithDeepSeek,
    translateWithDeepSeek,
    type EnglishReview,
} from './translator.ts';

const WIDGET_ID = 'pi-base.english-learning.translation';
const LIVE_PREVIEW_WIDGET_ID = 'pi-base.english-learning.live-preview';
const STATUS_ID = 'pi-base.english-learning.status';
const MODE_STATUS_ID = 'pi-base.english-learning.mode-status';
const TRANS_COMMAND_USAGE = 'Usage: /trans off | preview | review | status';
const ENGLISH_REPLY_INSTRUCTION = [
    'English learning mode is enabled.',
    'Reply in clear, natural English by default.',
    'Keep code, commands, paths, and identifiers unchanged, and do not add a Chinese translation.',
].join(' ');

type AssistantSnapshot = {
    entryId: string;
    text: string;
};

type CachedTranslation = {
    assistantEntryId: string;
    text: string;
};

type PendingPreviewSend = {
    original: string;
    recommended: string;
    expires: ReturnType<typeof setTimeout>;
};

function assistantText(message: unknown): string | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const candidate = message as {
        role?: unknown;
        stopReason?: unknown;
        content?: unknown;
    };
    if (candidate.role !== 'assistant') return undefined;
    if (candidate.stopReason !== 'stop' && candidate.stopReason !== 'length')
        return undefined;
    if (!Array.isArray(candidate.content)) return undefined;

    const text = candidate.content
        .filter((block): block is { type: 'text'; text: string } => {
            if (!block || typeof block !== 'object') return false;
            const value = block as { type?: unknown; text?: unknown };
            return value.type === 'text' && typeof value.text === 'string';
        })
        .map((block) => block.text)
        .join('\n')
        .trim();
    return text || undefined;
}

function userText(message: unknown): string | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const candidate = message as { role?: unknown; content?: unknown };
    if (candidate.role !== 'user' || !Array.isArray(candidate.content))
        return undefined;
    const text = candidate.content
        .filter((block): block is { type: 'text'; text: string } => {
            if (!block || typeof block !== 'object') return false;
            const value = block as { type?: unknown; text?: unknown };
            return value.type === 'text' && typeof value.text === 'string';
        })
        .map((block) => block.text)
        .join('\n')
        .trim();
    return text || undefined;
}

function latestAssistant(ctx: ExtensionContext): AssistantSnapshot | undefined {
    const branch = ctx.sessionManager.getBranch();
    for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index];
        if (entry.type !== 'message') continue;
        if (
            !entry.message ||
            typeof entry.message !== 'object' ||
            entry.message.role !== 'assistant'
        )
            continue;

        const text = assistantText(entry.message);
        return text ? { entryId: entry.id, text } : undefined;
    }
    return undefined;
}

function renderTranslationWidget(ctx: ExtensionContext, translation: string) {
    ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => {
        const container = new Container();
        container.addChild(
            new Text(theme.fg('muted', theme.bold('中文翻译')), 1, 0),
        );
        container.addChild(new Markdown(translation, 1, 0, getMarkdownTheme()));
        return container;
    });
}

function restoreUnsubmittedInput(
    ctx: ExtensionContext,
    original: string,
    message: string,
    level: 'info' | 'error',
) {
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
    let translationMode: TranslationMode = DEFAULT_TRANSLATION_MODE;
    let livePreview: LivePreviewController | undefined;
    let livePreviewState: LivePreviewState = { status: 'hidden' };
    let pendingPreviewSend: PendingPreviewSend | undefined;

    function enqueueInputReview<T>(work: () => Promise<T>): Promise<T> {
        const previous = inputReviewTail;
        let release!: () => void;
        inputReviewTail = new Promise<void>((resolve) => {
            release = resolve;
        });
        return previous.then(work).finally(release);
    }

    function cancelInputReviews(action: 'continue' | 'handled') {
        inputReviewCancellation.cancel(action);
        for (const controller of inputReviewControllers) controller.abort();
        inputReviewControllers.clear();
        cancelActiveInputDialog?.();
        cancelActiveInputDialog = undefined;
    }

    function canceledInputReviewResult(
        generation: number,
    ): InputEventResult | undefined {
        const outcome = inputReviewCancellation.outcome(generation);
        return outcome === 'active' ? undefined : { action: outcome };
    }

    function abortedInputReviewResult(generation: number): InputEventResult {
        return canceledInputReviewResult(generation) ?? { action: 'handled' };
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

    function clearLivePreviewUi(ctx: ExtensionContext) {
        try {
            ctx.ui.setWidget(LIVE_PREVIEW_WIDGET_ID, undefined);
        } catch {}
    }

    function renderLivePreview(ctx: ExtensionContext, state: LivePreviewState) {
        livePreviewState = state;
        if (state.status === 'hidden') {
            clearLivePreviewUi(ctx);
            return;
        }
        try {
            ctx.ui.setWidget(
                LIVE_PREVIEW_WIDGET_ID,
                (_tui, theme) =>
                    new LivePreviewComponent(
                        state.original,
                        state.status === 'ready'
                            ? state.recommended
                            : undefined,
                        theme,
                    ),
                { placement: 'aboveEditor' },
            );
        } catch {}
    }

    function syncLivePreviewAvailability() {
        livePreview?.setEnabled(livePreviewEnabled(translationMode));
    }

    function clearPendingPreviewSend() {
        if (pendingPreviewSend) clearTimeout(pendingPreviewSend.expires);
        pendingPreviewSend = undefined;
    }

    function disposeLivePreview(ctx: ExtensionContext) {
        livePreview?.dispose();
        livePreview = undefined;
        livePreviewState = { status: 'hidden' };
        clearLivePreviewUi(ctx);
    }

    function setupLivePreview(ctx: ExtensionContext) {
        if (ctx.mode !== 'tui') return;

        const controller = new LivePreviewController({
            enabled: livePreviewEnabled(translationMode),
            target: inputReviewTarget,
            recommend: (source, signal) =>
                recommendEnglishWithDeepSeek(source, signal),
            onStateChange: (state) => {
                if (livePreview === controller) renderLivePreview(ctx, state);
            },
            onError: (message) => {
                try {
                    ctx.ui.notify(`English recommendation failed. ${message}`, 'error');
                } catch {}
            },
        });
        livePreview = controller;

        const previousEditorFactory = ctx.ui.getEditorComponent();
        ctx.ui.setEditorComponent((tui, theme, keybindings) => {
            const editor = previousEditorFactory
                ? previousEditorFactory(tui, theme, keybindings)
                : new CustomEditor(tui, theme, keybindings);
            return new LivePreviewEditor(editor, (text) =>
                controller.update(text),
            );
        });

        try {
            controller.update(ctx.ui.getEditorText());
        } catch {}
    }

    function restoreInput(
        ctx: ExtensionContext,
        original: string,
        message: string,
        level: 'info' | 'error',
    ) {
        restoreUnsubmittedInput(ctx, original, message, level);
        livePreview?.update(original);
    }

    function resetSessionState(ctx: ExtensionContext) {
        cancelInputReviews('handled');
        clearPendingPreviewSend();
        clearReplyTranslation(ctx, true);
        disposeLivePreview(ctx);
    }

    function renderTranslationModeStatus(ctx: ExtensionContext) {
        try {
            const color = translationMode === 'off' ? 'muted' : 'accent';
            ctx.ui.setStatus(
                MODE_STATUS_ID,
                ctx.ui.theme.fg(color, `English: ${translationMode}`),
            );
        } catch {}
    }

    function restoreMode(ctx: ExtensionContext) {
        translationMode = translationModeFromEntries(
            ctx.sessionManager.getBranch(),
        );
        syncLivePreviewAvailability();
        renderTranslationModeStatus(ctx);
    }

    function prepareForSessionTransition(
        ctx: ExtensionContext,
    ): { cancel: true } | undefined {
        if (inputEditorActive) {
            ctx.ui.notify('请先关闭英语编辑界面，再切换会话。', 'warning');
            return { cancel: true };
        }
        cancelInputReviews('handled');
        return undefined;
    }

    pi.on('session_before_switch', (_event, ctx) =>
        prepareForSessionTransition(ctx),
    );
    pi.on('session_before_fork', (_event, ctx) =>
        prepareForSessionTransition(ctx),
    );
    pi.on('session_before_tree', (_event, ctx) =>
        prepareForSessionTransition(ctx),
    );

    pi.on('session_start', (_event, ctx) => {
        resetSessionState(ctx);
        restoreMode(ctx);
        setupLivePreview(ctx);
    });

    pi.on('session_tree', (_event, ctx) => {
        restoreMode(ctx);
        livePreview?.update(ctx.ui.getEditorText());
    });

    function setTranslationMode(mode: TranslationMode, ctx: ExtensionContext) {
        if (mode === translationMode) return;
        const previousMode = translationMode;
        translationMode = mode;
        pi.appendEntry(TRANSLATION_MODE_ENTRY_TYPE, { mode });

        if (
            previousMode === 'review' &&
            mode !== 'review' &&
            inputReviewCancellation.hasActive
        ) {
            cancelInputReviews('continue');
            try {
                ctx.ui.setStatus(STATUS_ID, undefined);
            } catch {}
        }
        syncLivePreviewAvailability();
        renderTranslationModeStatus(ctx);
    }

    pi.registerCommand('trans', {
        description: 'Switch or show the English translation mode',
        handler: async (args, ctx) => {
            const command = parseTranslationModeCommand(args);
            if (command === 'status') {
                ctx.ui.notify(`English mode: ${translationMode}`, 'info');
                return;
            }
            if (!command) {
                const prefix = args.trim()
                    ? ''
                    : `English mode: ${translationMode}\n`;
                ctx.ui.notify(
                    `${prefix}${TRANS_COMMAND_USAGE}`,
                    args.trim() ? 'warning' : 'info',
                );
                return;
            }

            setTranslationMode(command, ctx);
            ctx.ui.notify(`English mode: ${translationMode}`, 'info');
        },
    });

    pi.registerShortcut(Key.ctrlShift('e'), {
        description: 'Cycle the English translation mode',
        handler: async (ctx) => {
            setTranslationMode(nextTranslationMode(translationMode), ctx);
            ctx.ui.notify(`English mode: ${translationMode}`, 'info');
        },
    });

    pi.registerShortcut('ctrl+enter', {
        description:
            'Request or send the on-demand English recommendation (preview mode)',
        handler: async (ctx) => {
            if (translationMode !== 'preview') {
                ctx.ui.notify(
                    'On-demand English recommendations are available only in preview mode.',
                    'warning',
                );
                return;
            }

            if (!ctx.isIdle()) {
                ctx.ui.notify(
                    'Wait for the Agent to finish before using English recommendations.',
                    'warning',
                );
                return;
            }

            const original = ctx.ui.getEditorText();
            if (original.trimStart().startsWith('/')) {
                ctx.ui.notify(
                    'Use Enter to submit commands; English recommendations support text prompts only.',
                    'warning',
                );
                return;
            }

            const recommended = currentLiveRecommendation(
                livePreviewState,
                original,
            );
            if (!recommended) {
                if (
                    livePreviewState.status === 'loading' &&
                    livePreviewState.original === original
                ) {
                    ctx.ui.notify(
                        'English recommendation is still running…',
                        'info',
                    );
                    return;
                }

                const started = livePreview?.request(original) ?? false;
                if (!started) {
                    ctx.ui.notify(
                        'Nothing to translate in the current draft.',
                        'warning',
                    );
                }
                return;
            }

            clearPendingPreviewSend();
            const pending: PendingPreviewSend = {
                original,
                recommended,
                expires: setTimeout(() => {
                    if (pendingPreviewSend === pending)
                        pendingPreviewSend = undefined;
                }, 10_000),
            };
            pendingPreviewSend = pending;
            try {
                pi.sendUserMessage(recommended);
            } catch (error) {
                clearPendingPreviewSend();
                const reason =
                    error instanceof Error ? ` ${error.message}` : '';
                ctx.ui.notify(
                    `Unable to send the English recommendation.${reason}`,
                    'error',
                );
            }
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
        ): Promise<EnglishReview | 'aborted' | 'failed'> => {
            const controller = new AbortController();
            inputReviewControllers.add(controller);
            try {
                ctx.ui.setStatus(
                    STATUS_ID,
                    ctx.ui.theme.fg('accent', statusMessage),
                );
            } catch {}

            try {
                const review = await reviewEnglishWithDeepSeek(
                    target.source,
                    controller.signal,
                    preserveQuotedContent,
                );
                if (
                    canceledInputReviewResult(generation) ||
                    controller.signal.aborted
                )
                    return 'aborted';
                return review;
            } catch (error) {
                if (
                    canceledInputReviewResult(generation) ||
                    controller.signal.aborted
                )
                    return 'aborted';
                const reason =
                    error instanceof Error
                        ? error.message
                        : 'Unknown DeepSeek error.';
                ctx.ui.notify(
                    `英语检查失败，将直接发送原文。${reason}`,
                    'warning',
                );
                return 'failed';
            } finally {
                inputReviewControllers.delete(controller);
                if (
                    inputReviewControllers.size === 0 &&
                    !canceledInputReviewResult(generation)
                ) {
                    try {
                        ctx.ui.setStatus(STATUS_ID, undefined);
                    } catch {}
                }
            }
        };

        const initialReview = await requestReview(true, '正在检查并优化英文…');
        if (initialReview === 'aborted')
            return abortedInputReviewResult(generation);
        if (initialReview === 'failed') return { action: 'continue' };
        let review = initialReview;

        if (
            !review.preservedQuotedContent &&
            normalizeCosmeticEnglish(target.source) ===
                normalizeCosmeticEnglish(review.english)
        ) {
            return {
                action: 'transform',
                text: target.rebuild(review.english),
                images: event.images,
            };
        }

        while (true) {
            let action: ReviewAction;
            let closeDialog: (() => void) | undefined;
            try {
                action = await ctx.ui.custom<ReviewAction>(
                    (_tui, theme, _keybindings, done) => {
                        const component = new EnglishReviewComponent(
                            target.source,
                            review,
                            theme,
                            done,
                        );
                        closeDialog = () => component.cancel();
                        cancelActiveInputDialog = closeDialog;
                        return component;
                    },
                );
            } catch {
                const canceled = canceledInputReviewResult(generation);
                if (canceled) return canceled;
                restoreInput(
                    ctx,
                    original,
                    '无法打开英语学习界面，原文未提交。',
                    'error',
                );
                return { action: 'handled' };
            } finally {
                if (cancelActiveInputDialog === closeDialog)
                    cancelActiveInputDialog = undefined;
            }
            const canceledAfterDialog = canceledInputReviewResult(generation);
            if (canceledAfterDialog) return canceledAfterDialog;
            if (action === 'cancel') {
                restoreInput(ctx, original, '已取消，原文未提交。', 'info');
                return { action: 'handled' };
            }
            if (action === 'send-original') return { action: 'continue' };
            if (action === 'review-all') {
                const fullReview = await requestReview(
                    false,
                    '正在检查全部内容…',
                );
                if (fullReview === 'aborted')
                    return abortedInputReviewResult(generation);
                if (fullReview === 'failed') return { action: 'continue' };
                review = fullReview;
                continue;
            }

            let confirmed = review.english;
            if (action === 'edit') {
                let edited: string | undefined;
                inputEditorActive = true;
                try {
                    edited = await ctx.ui.editor(
                        '编辑发送给 Agent 的英文（Esc 取消）',
                        review.english,
                    );
                } catch {
                    const canceled = canceledInputReviewResult(generation);
                    if (canceled) return canceled;
                    restoreInput(
                        ctx,
                        original,
                        '无法打开英文编辑界面，原文未提交。',
                        'error',
                    );
                    return { action: 'handled' };
                } finally {
                    inputEditorActive = false;
                }
                const canceledAfterEditor =
                    canceledInputReviewResult(generation);
                if (canceledAfterEditor) return canceledAfterEditor;
                if (!edited?.trim()) {
                    restoreInput(ctx, original, '已取消，原文未提交。', 'info');
                    return { action: 'handled' };
                }
                confirmed = edited;
            }
            const canceledBeforeSubmit = canceledInputReviewResult(generation);
            if (canceledBeforeSubmit) return canceledBeforeSubmit;

            return {
                action: 'transform',
                text: target.rebuild(confirmed),
                images: event.images,
            };
        }
    }

    pi.on('message_start', (event, ctx) => {
        const pending = pendingPreviewSend;
        if (!pending || userText(event.message) !== pending.recommended) return;
        clearPendingPreviewSend();
        if (ctx.ui.getEditorText() === pending.original)
            ctx.ui.setEditorText('');
    });

    pi.on('input', (event, ctx) => {
        clearReplyTranslation(ctx, true);
        if (
            event.source !== 'interactive' ||
            !submitTimeReviewEnabled(translationMode)
        ) {
            return { action: 'continue' };
        }

        const target = inputReviewTarget(event.text);
        if (!target) return { action: 'continue' };

        const generation = inputReviewCancellation.capture();
        return enqueueInputReview(() =>
            processInputReview(event, ctx, target, generation),
        ).finally(() => {
            inputReviewCancellation.release(generation);
        });
    });

    pi.on('before_agent_start', (event) => {
        const systemPrompt = englishReplySystemPrompt(
            event.systemPrompt,
            ENGLISH_REPLY_INSTRUCTION,
            translationMode,
        );
        return systemPrompt === undefined ? undefined : { systemPrompt };
    });

    pi.on('agent_start', (_event, ctx) => {
        clearReplyTranslation(ctx, true);
    });

    pi.registerShortcut(Key.ctrlShift('y'), {
        description: '翻译或隐藏最新一条 Agent 英文回复',
        handler: async (ctx) => {
            if (!ctx.isIdle()) {
                ctx.ui.notify('请等待 Agent 完成后再翻译。', 'warning');
                return;
            }

            const assistant = latestAssistant(ctx);
            if (!assistant) {
                ctx.ui.notify('没有可翻译的最新英文回复。', 'warning');
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
            ctx.ui.setStatus(
                STATUS_ID,
                ctx.ui.theme.fg('accent', '正在翻译最新回复…'),
            );

            try {
                const translated = await translateWithDeepSeek(
                    assistant.text,
                    'en-zh',
                    controller.signal,
                );
                if (
                    generation !== inputReviewCancellation.generation ||
                    controller.signal.aborted ||
                    !ctx.isIdle()
                )
                    return;

                const current = latestAssistant(ctx);
                if (!current || current.entryId !== assistant.entryId) return;

                cachedTranslation = {
                    assistantEntryId: assistant.entryId,
                    text: translated,
                };
                renderTranslationWidget(ctx, translated);
                translationVisible = true;
            } catch {
                if (
                    generation === inputReviewCancellation.generation &&
                    !controller.signal.aborted
                ) {
                    ctx.ui.notify(
                        '回复翻译失败。请检查 DEEPSEEK_PI_TRANSLATE_API_KEY 或稍后重试。',
                        'error',
                    );
                }
            } finally {
                if (replyTranslationController === controller) {
                    replyTranslationController = undefined;
                    if (generation === inputReviewCancellation.generation)
                        ctx.ui.setStatus(STATUS_ID, undefined);
                }
            }
        },
    });

    pi.on('session_shutdown', (_event, ctx) => {
        resetSessionState(ctx);
        try {
            ctx.ui.setStatus(MODE_STATUS_ID, undefined);
        } catch {}
    });
}
