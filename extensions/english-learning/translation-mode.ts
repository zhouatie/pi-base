export const TRANSLATION_MODE_ENTRY_TYPE = "pi-base.english-learning.translation-mode";

export type TranslationMode = "off" | "preview" | "review";
export type TranslationModeCommand = TranslationMode | "status";

const TRANSLATION_MODES: readonly TranslationMode[] = ["off", "preview", "review"];

export function parseTranslationModeCommand(args: string): TranslationModeCommand | undefined {
	const command = args.trim().toLowerCase();
	if (command === "status") return command;
	return TRANSLATION_MODES.includes(command as TranslationMode)
		? (command as TranslationMode)
		: undefined;
}

export function translationModeFromEntries(entries: readonly unknown[]): TranslationMode {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== TRANSLATION_MODE_ENTRY_TYPE) continue;
		if (!candidate.data || typeof candidate.data !== "object") continue;
		const mode = (candidate.data as { mode?: unknown }).mode;
		if (mode === "off" || mode === "preview" || mode === "review") return mode;
	}
	return "review";
}

export function nextTranslationMode(mode: TranslationMode): TranslationMode {
	const index = TRANSLATION_MODES.indexOf(mode);
	return TRANSLATION_MODES[(index + 1) % TRANSLATION_MODES.length];
}

export function automaticTranslationEnabled(mode: TranslationMode): boolean {
	return mode !== "off";
}

export function livePreviewEnabled(mode: TranslationMode): boolean {
	return mode === "preview";
}

export function submitTimeReviewEnabled(mode: TranslationMode): boolean {
	return mode === "review";
}

export function englishReplySystemPrompt(
	systemPrompt: string,
	instruction: string,
	mode: TranslationMode,
): string | undefined {
	return automaticTranslationEnabled(mode) ? `${systemPrompt}\n\n${instruction}` : undefined;
}
