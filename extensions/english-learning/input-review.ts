import { textOutsideProtectedContent } from "./protected-content.ts";

const REVIEWED_TASK_COMMANDS = new Set(["worker", "oracle", "hermes"]);
const RESOURCE_TOKEN_PATTERN = /(?:\/|\.\.?\/|~\/)[^\r\n<>]*?\.(?:png|jpe?g|gif|webp|bmp)(?=\s|$|["'”’)\]}】》」』,，。；;:：])|[A-Za-z]:\\[^\r\n<>]*?\.(?:png|jpe?g|gif|webp|bmp)(?=\s|$|["'”’)\]}】》」』,，。；;:：])|https?:\/\/[^\s<>"']+|(?:\/|\.\.?\/|~\/)\S+|[A-Za-z]:\\\S+|\s+|[\p{L}\p{N}_]+(?:['’-][\p{L}\p{N}_]+)*|[^\s]/giu;
const STANDALONE_RESOURCE_PATTERN = /^(?:["'“‘])?(?:https?:\/\/[^\s<>"'，。；：！？\p{Script=Han}]+|(?:\/|\.\.?\/|~\/)[A-Za-z0-9._@%+,\-=/]+|[A-Za-z]:\\[A-Za-z0-9._@%+,\-=\\]+|(?:\/|\.\.?\/|~\/)[^\r\n<>]*\.(?:png|jpe?g|gif|webp|bmp)|[A-Za-z]:\\[^\r\n<>]*\.(?:png|jpe?g|gif|webp|bmp))(?:["'”’])?[.!?。！？]?$/iu;

export type InputReviewTarget = {
	source: string;
	rebuild: (english: string) => string;
};

function hasReviewableContent(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	if (STANDALONE_RESOURCE_PATTERN.test(trimmed)) return false;
	if (/^(?:```[\s\S]*```|~~~[\s\S]*~~~|`[^\r\n]+`)$/.test(trimmed)) return false;
	return /[A-Za-z]|\p{Script=Han}/u.test(textOutsideProtectedContent(trimmed, true));
}

export function normalizeCosmeticEnglish(text: string): string {
	const tokens = text.match(RESOURCE_TOKEN_PATTERN) ?? [];
	let sentenceStart = true;
	let normalized = "";

	for (const token of tokens) {
		if (/^(?:https?:\/\/|\/|\.\.?\/|~\/|[A-Za-z]:\\)/i.test(token)) {
			normalized += token;
			continue;
		}
		if (/^\s+$/.test(token)) {
			normalized += token;
			if (token.includes("\n")) sentenceStart = true;
			continue;
		}
		if (/^[\p{L}\p{N}_]/u.test(token)) {
			normalized += sentenceStart && /^[A-Za-z]/.test(token) ? token.toLowerCase() : token;
			sentenceStart = false;
			continue;
		}
		normalized += token;
		if (/^[.!?。！？…]$/.test(token)) sentenceStart = true;
	}

	return normalized
		.trim()
		.replace(/[.!?。！？…]+(?=(?:["'”’)\]}】》」』]*)$)/u, "")
		.trimEnd();
}

export function inputReviewTarget(text: string): InputReviewTarget | undefined {
	const trimmed = text.trimStart();
	if (trimmed.startsWith("!")) return undefined;

	const leadingWhitespace = text.slice(0, text.length - trimmed.length);
	const command = trimmed.match(/^\/([A-Za-z0-9][A-Za-z0-9:_-]*)(?:(\s+)([\s\S]*))?$/);
	if (command) {
		const baseName = command[1].split(":", 1)[0];
		const separator = command[2];
		const args = command[3];
		if (!REVIEWED_TASK_COMMANDS.has(baseName) || !separator || !args || !hasReviewableContent(args)) {
			return undefined;
		}
		const prefix = `${leadingWhitespace}/${command[1]}${separator}`;
		return {
			source: args,
			rebuild: (english) => `${prefix}${english.trim()}`,
		};
	}

	const firstLine = trimmed.split(/\r?\n/, 1)[0];
	if (/^\/[A-Za-z0-9][A-Za-z0-9:_-]*(?:\s|$)/.test(firstLine)) return undefined;
	if (!hasReviewableContent(text)) return undefined;
	return { source: text, rebuild: (english) => english.trim() };
}
