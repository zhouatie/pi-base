import assert from "node:assert/strict";
import test from "node:test";
import { visibleRecommendationLines } from "./live-preview-layout.ts";

test("shows short recommendations in full", () => {
	const lines = ["path", "english", "figma", "note"];
	assert.deepEqual(visibleRecommendationLines(lines, "…"), lines);
});

test("keeps head and tail when the recommendation is long", () => {
	const lines = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`);
	const visible = visibleRecommendationLines(lines, "…");

	assert.equal(visible[0], "line-1");
	assert.equal(visible.includes("…"), true);
	assert.equal(visible.at(-1), "line-20");
	assert.equal(visible.at(-2), "line-19");
	assert.ok(!visible.includes("line-10"));
	assert.ok(visible.length <= 14);
});
