export type InputReviewGenerationOutcome = "active" | "continue" | "handled";

export class InputReviewCancellationState {
	private currentGeneration = 0;
	private readonly activeCounts = new Map<number, number>();
	private readonly passthroughGenerations = new Set<number>();

	get generation(): number {
		return this.currentGeneration;
	}

	get hasActive(): boolean {
		return this.activeCounts.size > 0;
	}

	capture(): number {
		const generation = this.currentGeneration;
		this.activeCounts.set(generation, (this.activeCounts.get(generation) ?? 0) + 1);
		return generation;
	}

	release(generation: number): void {
		const remaining = (this.activeCounts.get(generation) ?? 0) - 1;
		if (remaining > 0) {
			this.activeCounts.set(generation, remaining);
			return;
		}
		this.activeCounts.delete(generation);
		this.passthroughGenerations.delete(generation);
	}

	cancel(action: "continue" | "handled"): void {
		const canceledGeneration = this.currentGeneration++;
		if (action === "handled") {
			this.passthroughGenerations.clear();
		} else if (this.activeCounts.has(canceledGeneration)) {
			this.passthroughGenerations.add(canceledGeneration);
		}
	}

	outcome(generation: number): InputReviewGenerationOutcome {
		if (generation === this.currentGeneration) return "active";
		return this.passthroughGenerations.has(generation) ? "continue" : "handled";
	}
}
