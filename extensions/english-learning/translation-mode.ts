export const TRANSLATION_MODE_ENTRY_TYPE = "pi-base.english-learning.translation-mode";

export type TranslationMode = "on" | "off";
export type TranslationModeCommand = TranslationMode | "status";

export function parseTranslationModeCommand(args: string): TranslationModeCommand | undefined {
	const command = args.trim().toLowerCase();
	return command === "on" || command === "off" || command === "status" ? command : undefined;
}

export function translationModeFromEntries(entries: readonly unknown[]): TranslationMode {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== TRANSLATION_MODE_ENTRY_TYPE) continue;
		if (!candidate.data || typeof candidate.data !== "object") continue;
		const mode = (candidate.data as { mode?: unknown }).mode;
		if (mode === "on" || mode === "off") return mode;
	}
	return "on";
}

export function automaticTranslationEnabled(mode: TranslationMode): boolean {
	return mode === "on";
}

export function englishReplySystemPrompt(
	systemPrompt: string,
	instruction: string,
	mode: TranslationMode,
): string | undefined {
	return automaticTranslationEnabled(mode) ? `${systemPrompt}\n\n${instruction}` : undefined;
}
