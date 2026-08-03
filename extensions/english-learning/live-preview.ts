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
	target: (text: string) => InputReviewTarget | undefined;
	recommend: (source: string, signal: AbortSignal) => Promise<string>;
	onStateChange: (state: LivePreviewState) => void;
	onError?: (message: string) => void;
};

export class LivePreviewController {
	private readonly options: LivePreviewControllerOptions;
	private enabled: boolean;
	private currentText = "";
	private hasCurrentText = false;
	private generation = 0;
	private requestController: AbortController | undefined;
	private disposed = false;
	private state: LivePreviewState = { status: "hidden" };

	constructor(options: LivePreviewControllerOptions) {
		this.options = options;
		this.enabled = options.enabled;
	}

	/** Track editor text. Never auto-translates; only invalidates a stale preview. */
	update(text: string): void {
		if (this.disposed) return;
		if (this.hasCurrentText && text === this.currentText) return;
		this.currentText = text;
		this.hasCurrentText = true;
		this.invalidateIfStale();
	}

	/**
	 * Manually request an English recommendation for the given text.
	 * Returns false when preview is unavailable or the draft has nothing to translate.
	 */
	request(text: string): boolean {
		if (this.disposed || !this.enabled) return false;

		this.currentText = text;
		this.hasCurrentText = true;

		const target = this.options.target(text);
		if (!target) {
			this.cancelPendingWork();
			this.setState({ status: "hidden" });
			return false;
		}

		if (this.state.status === "ready" && this.state.original === text) return true;
		if (this.state.status === "loading" && this.state.original === text) return true;

		const generation = this.cancelPendingWork();
		void this.requestRecommendation(text, target, generation);
		return true;
	}

	setEnabled(enabled: boolean): void {
		if (this.disposed || enabled === this.enabled) return;
		this.enabled = enabled;
		if (!enabled) {
			this.cancelPendingWork();
			this.setState({ status: "hidden" });
			return;
		}
		this.invalidateIfStale();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelPendingWork();
	}

	private setState(state: LivePreviewState): void {
		this.state = state;
		this.options.onStateChange(state);
	}

	private invalidateIfStale(): void {
		if (this.state.status === "hidden") return;
		if (this.state.original === this.currentText && this.enabled) return;
		this.cancelPendingWork();
		this.setState({ status: "hidden" });
	}

	private cancelPendingWork(): number {
		const generation = ++this.generation;
		this.requestController?.abort();
		this.requestController = undefined;
		return generation;
	}

	private async requestRecommendation(
		original: string,
		target: InputReviewTarget,
		generation: number,
	): Promise<void> {
		if (this.disposed || generation !== this.generation || !this.enabled) return;

		const controller = new AbortController();
		this.requestController = controller;
		this.setState({ status: "loading", original });

		try {
			const english = await this.options.recommend(target.source, controller.signal);
			if (
				this.disposed ||
				controller.signal.aborted ||
				generation !== this.generation ||
				!this.enabled
			) {
				return;
			}
			this.setState({
				status: "ready",
				original,
				recommended: target.rebuild(english),
			});
		} catch (error) {
			if (this.disposed || controller.signal.aborted || generation !== this.generation) return;
			this.setState({ status: "hidden" });
			const reason = error instanceof Error ? error.message : "Unknown DeepSeek error.";
			this.options.onError?.(reason);
		} finally {
			if (this.requestController === controller) this.requestController = undefined;
		}
	}
}
