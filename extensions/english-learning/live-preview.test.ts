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

test("debounces input and recommends only the latest draft", async () => {
	const calls: string[] = [];
	const states: LivePreviewState[] = [];
	const preview = new LivePreviewController({
		enabled: true,
		debounceMs: 10,
		target,
		recommend: async (source) => {
			calls.push(source);
			return `Recommended ${source}`;
		},
		onStateChange: (state) => states.push(state),
	});

	preview.update("first");
	preview.update("second");
	await delay(40);

	assert.deepEqual(calls, ["second"]);
	assert.deepEqual(states.at(-1), {
		status: "ready",
		original: "second",
		recommended: "Recommended second",
	});
	preview.dispose();
});

test("disabling live preview aborts active work without affecting later drafts", async () => {
	let aborted = false;
	let calls = 0;
	const states: LivePreviewState[] = [];
	const preview = new LivePreviewController({
		enabled: true,
		debounceMs: 5,
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
	});

	preview.update("active");
	await delay(20);
	preview.setEnabled(false);
	preview.update("disabled draft");
	await delay(20);

	assert.equal(calls, 1);
	assert.equal(aborted, true);
	assert.deepEqual(states.at(-1), { status: "hidden" });
	preview.dispose();
});
