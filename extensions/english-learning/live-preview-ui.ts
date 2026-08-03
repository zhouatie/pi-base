import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { visibleRecommendationLines } from "./live-preview-layout.ts";
import { highlightReviewDiff } from "./review-ui.ts";

export class LivePreviewComponent {
	private readonly original: string;
	private readonly recommended: string | undefined;
	private readonly theme: Theme;

	constructor(original: string, recommended: string | undefined, theme: Theme) {
		this.original = original;
		this.recommended = recommended;
		this.theme = theme;
	}

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

		const lines = [truncateToWidth(` ${title}`, width)];
		for (const line of visibleRecommendationLines(wrapped, this.theme.fg("dim", "…"))) {
			lines.push(truncateToWidth(`   ${line}`, width));
		}
		lines.push(
			truncateToWidth(
				`   ${this.theme.fg("dim", "Ctrl+Enter send full text  ·  edit text to clear")}`,
				width,
			),
		);
		return lines;
	}

	invalidate(): void {}
}
