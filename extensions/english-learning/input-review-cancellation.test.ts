import assert from "node:assert/strict";
import test from "node:test";
import { InputReviewCancellationState } from "./input-review-cancellation.ts";

test("translation disable passes every affected review through unchanged", () => {
	const state = new InputReviewCancellationState();
	const first = state.capture();
	const second = state.capture();

	state.cancel("continue");
	assert.equal(state.outcome(first), "continue");
	assert.equal(state.outcome(second), "continue");

	state.release(first);
	assert.equal(state.outcome(second), "continue");
	state.release(second);
	assert.equal(state.outcome(first), "handled");
});

test("multiple disable generations remain passthrough while their work is active", () => {
	const state = new InputReviewCancellationState();
	const first = state.capture();
	state.cancel("continue");
	const second = state.capture();
	state.cancel("continue");

	assert.equal(state.outcome(first), "continue");
	assert.equal(state.outcome(second), "continue");
	state.release(first);
	state.release(second);
});

test("a later session cancellation overrides pending passthrough outcomes", () => {
	const state = new InputReviewCancellationState();
	const oldSession = state.capture();
	state.cancel("continue");
	const currentSession = state.capture();

	state.cancel("handled");
	assert.equal(state.outcome(oldSession), "handled");
	assert.equal(state.outcome(currentSession), "handled");

	state.release(oldSession);
	state.release(currentSession);
});

test("tracks whether input review work is active", () => {
	const state = new InputReviewCancellationState();
	assert.equal(state.hasActive, false);
	const generation = state.capture();
	assert.equal(state.hasActive, true);
	assert.equal(state.outcome(generation), "active");
	state.release(generation);
	assert.equal(state.hasActive, false);
});
