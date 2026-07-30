import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { EnglishReview } from "./translator.ts";

export type ReviewAction = "send" | "edit" | "cancel";

type HighlightedReviewDiff = {
	original: string;
	recommended: string;
	hasChanges: boolean;
	highlighted: boolean;
};

const MAX_DIFF_TOKENS = 240;
const MAX_REVIEW_TEXT_LINES = 6;
const MAX_REVIEW_ROWS = 22;

function tokenizeReviewText(text: string): string[] {
	return text.match(/\s+|[\p{L}\p{N}_]+(?:['’-][\p{L}\p{N}_]+)*|[^\s]/gu) ?? [];
}

function highlightReviewDiff(original: string, recommended: string, theme: Theme): HighlightedReviewDiff {
	if (original === recommended) {
		return {
			original: theme.fg("text", original),
			recommended: theme.fg("text", recommended),
			hasChanges: false,
			highlighted: false,
		};
	}

	const originalTokens = tokenizeReviewText(original);
	const recommendedTokens = tokenizeReviewText(recommended);
	if (
		originalTokens.length === 0 ||
		recommendedTokens.length === 0 ||
		originalTokens.length > MAX_DIFF_TOKENS ||
		recommendedTokens.length > MAX_DIFF_TOKENS
	) {
		return {
			original: theme.fg("muted", original),
			recommended: theme.fg("text", recommended),
			hasChanges: true,
			highlighted: false,
		};
	}

	const tokensEqual = (originalIndex: number, recommendedIndex: number) => {
		const originalToken = originalTokens[originalIndex];
		const recommendedToken = recommendedTokens[recommendedIndex];
		return originalToken === recommendedToken || originalToken.toLowerCase() === recommendedToken.toLowerCase();
	};
	const rows = Array.from(
		{ length: originalTokens.length + 1 },
		() => new Uint16Array(recommendedTokens.length + 1),
	);
	for (let left = originalTokens.length - 1; left >= 0; left--) {
		for (let right = recommendedTokens.length - 1; right >= 0; right--) {
			rows[left][right] = tokensEqual(left, right)
				? rows[left + 1][right + 1] + 1
				: Math.max(rows[left + 1][right], rows[left][right + 1]);
		}
	}

	const changedOriginal = new Set<number>();
	const changedRecommended = new Set<number>();
	let commonWords = 0;
	let left = 0;
	let right = 0;
	while (left < originalTokens.length && right < recommendedTokens.length) {
		if (tokensEqual(left, right)) {
			if (!/^\s+$/.test(originalTokens[left])) commonWords++;
			left++;
			right++;
		} else if (rows[left + 1][right] >= rows[left][right + 1]) {
			changedOriginal.add(left++);
		} else {
			changedRecommended.add(right++);
		}
	}
	while (left < originalTokens.length) changedOriginal.add(left++);
	while (right < recommendedTokens.length) changedRecommended.add(right++);

	const ignoreTrailingPunctuation = (tokens: string[], changed: Set<number>) => {
		let index = tokens.length - 1;
		while (index >= 0 && /^\s+$/.test(tokens[index])) index--;
		while (index >= 0 && /^[.!?。！？…]$/.test(tokens[index])) {
			changed.delete(index);
			index--;
		}
	};
	ignoreTrailingPunctuation(originalTokens, changedOriginal);
	ignoreTrailingPunctuation(recommendedTokens, changedRecommended);

	const originalWords = originalTokens.filter((token) => !/^\s+$/.test(token)).length;
	const recommendedWords = recommendedTokens.filter((token) => !/^\s+$/.test(token)).length;
	const similarity = commonWords / Math.max(1, originalWords, recommendedWords);
	if (similarity < 0.35) {
		return {
			original: theme.fg("muted", original),
			recommended: theme.fg("text", recommended),
			hasChanges: true,
			highlighted: false,
		};
	}

	const styleTokens = (tokens: string[], changed: Set<number>, color: "error" | "success") =>
		tokens
			.map((token, index) => {
				if (!changed.has(index) || /^\s+$/.test(token)) return theme.fg("text", token);
				return theme.fg(color, theme.bold(token));
			})
			.join("");

	const hasChanges = changedOriginal.size > 0 || changedRecommended.size > 0;
	return {
		original: styleTokens(originalTokens, changedOriginal, "error"),
		recommended: styleTokens(recommendedTokens, changedRecommended, "success"),
		hasChanges,
		highlighted: hasChanges,
	};
}

export class EnglishReviewComponent {
	private completed = false;

	constructor(
		private readonly original: string,
		private readonly review: EnglishReview,
		private readonly theme: Theme,
		private readonly done: (action: ReviewAction) => void,
	) {}

	private finish(action: ReviewAction): void {
		if (this.completed) return;
		this.completed = true;
		this.done(action);
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.enter)) {
			this.finish("send");
		} else if (matchesKey(data, "e")) {
			this.finish("edit");
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.finish("cancel");
		}
	}

	cancel(): void {
		this.finish("cancel");
	}

	dispose(): void {
		this.cancel();
	}

	render(width: number): string[] {
		if (width < 3) return [truncateToWidth(this.theme.fg("accent", "…"), Math.max(0, width))];
		const innerWidth = width - 2;
		const diff = highlightReviewDiff(this.original, this.review.english, this.theme);
		const border = (text: string) => this.theme.fg("borderMuted", text);
		const row = (content = "") => {
			const clipped = truncateToWidth(content, innerWidth);
			return `${border("│")}${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))}${border("│")}`;
		};
		const lines = [border(`╭${"─".repeat(innerWidth)}╮`)];
		const addWrapped = (text: string, color?: "text" | "muted", maxLines = MAX_REVIEW_TEXT_LINES) => {
			const rendered: string[] = [];
			for (const logicalLine of text.split("\n")) {
				const content = color ? this.theme.fg(color, logicalLine || " ") : logicalLine || " ";
				rendered.push(...wrapTextWithAnsi(content, Math.max(1, innerWidth - 4)));
			}
			for (const line of rendered.slice(0, maxLines)) lines.push(row(`  ${line}`));
			if (rendered.length > maxLines) lines.push(row(`  ${this.theme.fg("dim", "…")}`));
		};
		const addNote = (note: string, bulletColor: "warning" | "accent") => {
			const bullet = this.theme.fg(bulletColor, "•");
			const wrapped = wrapTextWithAnsi(note, Math.max(1, innerWidth - 6));
			for (const [index, line] of wrapped.slice(0, 3).entries()) {
				lines.push(row(`  ${index === 0 ? bullet : " "} ${this.theme.fg("muted", line)}`));
			}
			if (wrapped.length > 3) lines.push(row(`    ${this.theme.fg("dim", "…")}`));
		};
		const addCorrection = (note: string) => {
			const match = note.match(/^(.*?)\s*→\s*(.*?)(?:：\s*(.*))?$/);
			if (!match) {
				addNote(note, "warning");
				return;
			}
			const change = `${this.theme.fg("error", this.theme.bold(match[1]))} ${this.theme.fg("warning", "→")} ${this.theme.fg("success", this.theme.bold(match[2]))}`;
			addWrapped(change);
			if (match[3]) addWrapped(match[3], "muted");
		};
		const addVocabulary = (note: string) => {
			const match = note.match(/^(.+?)[：:]\s*(.+)$/);
			if (!match) {
				addNote(note, "accent");
				return;
			}
			const content = `${this.theme.fg("accent", this.theme.bold(match[1]))} ${this.theme.fg("dim", "—")} ${this.theme.fg("muted", match[2])}`;
			addWrapped(content);
		};

		lines.push(row(` ${this.theme.fg("accent", this.theme.bold("English Review"))}`));
		lines.push(row());
		lines.push(row(` ${this.theme.fg("muted", this.theme.bold("Your Input"))}`));
		addWrapped(diff.original);
		lines.push(row());
		lines.push(row(` ${this.theme.fg("success", this.theme.bold("Recommended English"))}`));
		addWrapped(diff.recommended);
		lines.push(row());
		lines.push(row(` ${this.theme.fg("warning", this.theme.bold("Corrections"))}`));
		if (this.review.corrections.length === 0) {
			const message = !diff.hasChanges
				? this.theme.fg("success", "✓ Looks natural")
				: diff.highlighted
					? this.theme.fg("warning", "已用颜色标出修改位置")
					: this.theme.fg("muted", "已转换为自然英文");
			lines.push(row(`  ${message}`));
		} else {
			for (const note of this.review.corrections) addCorrection(note);
		}
		if (this.review.vocabulary.length > 0) {
			lines.push(row());
			lines.push(row(` ${this.theme.fg("accent", this.theme.bold("Vocabulary"))}`));
			for (const note of this.review.vocabulary) addVocabulary(note);
		}
		lines.push(row());
		const footer = row(` ${this.theme.fg("dim", "Enter send  ·  E edit  ·  Esc cancel")}`);
		const bottomBorder = border(`╰${"─".repeat(innerWidth)}╯`);
		if (lines.length > MAX_REVIEW_ROWS - 2) {
			lines.length = MAX_REVIEW_ROWS - 3;
			lines.push(row(`  ${this.theme.fg("dim", "…")}`));
		}
		lines.push(footer, bottomBorder);
		return lines;
	}

	invalidate(): void {}
}
