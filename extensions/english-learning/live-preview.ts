import type { InputReviewTarget } from "./input-review.ts";

export type LivePreviewState =
	| { status: "hidden" }
	| { status: "loading"; original: string }
	| { status: "ready"; original: string; recommended: string };

export function currentLiveRecommendation(
	state: LivePreviewState,
	currentText: string,
): string | undefined {
	if (state.status !== "ready" || state.original !== currentText) return undefined;
	return state.recommended.trim() || undefined;
}

type LivePreviewControllerOptions = {
	enabled: boolean;
	debounceMs: number;
	target: (text: string) => InputReviewTarget | undefined;
	recommend: (source: string, signal: AbortSignal) => Promise<string>;
	onStateChange: (state: LivePreviewState) => void;
};

export class LivePreviewController {
	private readonly options: LivePreviewControllerOptions;
	private enabled: boolean;
	private currentText = "";
	private hasCurrentText = false;
	private generation = 0;
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private requestController: AbortController | undefined;
	private disposed = false;

	constructor(options: LivePreviewControllerOptions) {
		this.options = options;
		this.enabled = options.enabled;
	}

	update(text: string): void {
		if (this.disposed || (this.hasCurrentText && text === this.currentText)) return;
		this.currentText = text;
		this.hasCurrentText = true;
		this.restart();
	}

	setEnabled(enabled: boolean): void {
		if (this.disposed || enabled === this.enabled) return;
		this.enabled = enabled;
		this.restart();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelPendingWork();
	}

	private cancelPendingWork(): number {
		const generation = ++this.generation;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = undefined;
		}
		this.requestController?.abort();
		this.requestController = undefined;
		return generation;
	}

	private restart(): void {
		const generation = this.cancelPendingWork();
		this.options.onStateChange({ status: "hidden" });
		if (!this.enabled || !this.hasCurrentText) return;

		const target = this.options.target(this.currentText);
		if (!target) return;

		const original = this.currentText;
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = undefined;
			void this.requestRecommendation(original, target, generation);
		}, this.options.debounceMs);
	}

	private async requestRecommendation(
		original: string,
		target: InputReviewTarget,
		generation: number,
	): Promise<void> {
		if (this.disposed || generation !== this.generation || !this.enabled) return;

		const controller = new AbortController();
		this.requestController = controller;
		this.options.onStateChange({ status: "loading", original });

		try {
			const english = await this.options.recommend(target.source, controller.signal);
			if (
				this.disposed ||
				controller.signal.aborted ||
				generation !== this.generation ||
				!this.enabled
			) return;
			this.options.onStateChange({
				status: "ready",
				original,
				recommended: target.rebuild(english),
			});
		} catch {
			if (!this.disposed && !controller.signal.aborted && generation === this.generation) {
				this.options.onStateChange({ status: "hidden" });
			}
		} finally {
			if (this.requestController === controller) this.requestController = undefined;
		}
	}
}
