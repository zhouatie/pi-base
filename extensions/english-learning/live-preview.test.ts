import assert from "node:assert/strict";
import test from "node:test";
import {
	currentLiveRecommendation,
	LivePreviewController,
	type LivePreviewState,
} from "./live-preview.ts";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function target(text: string) {
	return text.trim()
		? {
				source: text,
				rebuild: (english: string) => english,
			}
		: undefined;
}

test("returns only a ready recommendation for the current draft", () => {
	assert.equal(currentLiveRecommendation({ status: "hidden" }, "draft"), undefined);
	assert.equal(
		currentLiveRecommendation({ status: "loading", original: "draft" }, "draft"),
		undefined,
	);
	assert.equal(
		currentLiveRecommendation(
			{ status: "ready", original: "old", recommended: "Old recommendation" },
			"new",
		),
		undefined,
	);
	assert.equal(
		currentLiveRecommendation(
			{ status: "ready", original: "draft", recommended: "  Recommended draft  " },
			"draft",
		),
		"Recommended draft",
	);
});

test("does not auto-translate on text updates", async () => {
	const calls: string[] = [];
	const states: LivePreviewState[] = [];
	const preview = new LivePreviewController({
		enabled: true,
		target,
		recommend: async (source) => {
			calls.push(source);
			return `Recommended ${source}`;
		},
		onStateChange: (state) => states.push(state),
	});

	preview.update("first");
	preview.update("second");
	await delay(20);

	assert.deepEqual(calls, []);
	assert.deepEqual(states, []);
	preview.dispose();
});

test("manual request translates only the requested draft", async () => {
	const calls: string[] = [];
	const states: LivePreviewState[] = [];
	const preview = new LivePreviewController({
		enabled: true,
		target,
		recommend: async (source) => {
			calls.push(source);
			return `Recommended ${source}`;
		},
		onStateChange: (state) => states.push(state),
	});

	preview.update("first");
	assert.equal(preview.request("second"), true);
	await delay(20);

	assert.deepEqual(calls, ["second"]);
	assert.deepEqual(states.at(-1), {
		status: "ready",
		original: "second",
		recommended: "Recommended second",
	});
	preview.dispose();
});

test("editing after a recommendation hides the stale preview", async () => {
	const states: LivePreviewState[] = [];
	const preview = new LivePreviewController({
		enabled: true,
		target,
		recommend: async (source) => `Recommended ${source}`,
		onStateChange: (state) => states.push(state),
	});

	assert.equal(preview.request("draft"), true);
	await delay(20);
	preview.update("draft changed");

	assert.deepEqual(states.at(-1), { status: "hidden" });
	preview.dispose();
});

test("disabling preview aborts active work", async () => {
	let aborted = false;
	let calls = 0;
	const states: LivePreviewState[] = [];
	const errors: string[] = [];
	const preview = new LivePreviewController({
		enabled: true,
		target,
		recommend: (_source, signal) => {
			calls++;
			return new Promise((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() => {
						aborted = true;
						reject(new Error("aborted"));
					},
					{ once: true },
				);
			});
		},
		onStateChange: (state) => states.push(state),
		onError: (message) => errors.push(message),
	});

	assert.equal(preview.request("active"), true);
	await delay(5);
	preview.setEnabled(false);
	await delay(10);

	assert.equal(calls, 1);
	assert.equal(aborted, true);
	assert.deepEqual(states.at(-1), { status: "hidden" });
	assert.deepEqual(errors, []);
	preview.dispose();
});

test("reports request failures through onError", async () => {
	const errors: string[] = [];
	const preview = new LivePreviewController({
		enabled: true,
		target,
		recommend: async () => {
			throw new Error("DeepSeek unavailable");
		},
		onStateChange: () => {},
		onError: (message) => errors.push(message),
	});

	assert.equal(preview.request("draft"), true);
	await delay(20);

	assert.deepEqual(errors, ["DeepSeek unavailable"]);
	preview.dispose();
});
