import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { highlightReviewDiff } from "./review-ui.ts";

const MAX_RECOMMENDATION_LINES = 4;

export class LivePreviewComponent {
	constructor(
		private readonly original: string,
		private readonly recommended: string | undefined,
		private readonly theme: Theme,
	) {}

	render(width: number): string[] {
		if (width <= 0) return [];
		const title = this.theme.fg("muted", this.theme.bold("Recommended English"));
		if (!this.recommended) {
			return [truncateToWidth(` ${title} ${this.theme.fg("dim", "· checking…")}`, width)];
		}

		const styled = highlightReviewDiff(this.original, this.recommended, this.theme).recommended;
		const contentWidth = Math.max(1, width - 3);
		const wrapped = styled
			.split("\n")
			.flatMap((line) => wrapTextWithAnsi(line || " ", contentWidth));
		const visible = wrapped.slice(0, MAX_RECOMMENDATION_LINES);
		const lines = [truncateToWidth(` ${title}`, width)];
		for (const line of visible) lines.push(truncateToWidth(`   ${line}`, width));
		if (wrapped.length > MAX_RECOMMENDATION_LINES) {
			lines.push(truncateToWidth(`   ${this.theme.fg("dim", "…")}`, width));
		}
		lines.push(
			truncateToWidth(`   ${this.theme.fg("dim", "Ctrl+Enter send recommendation")}`, width),
		);
		return lines;
	}

	invalidate(): void {}
}
