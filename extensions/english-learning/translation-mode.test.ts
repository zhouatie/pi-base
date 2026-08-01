import assert from "node:assert/strict";
import test from "node:test";
import {
	automaticTranslationEnabled,
	DEFAULT_TRANSLATION_MODE,
	englishReplySystemPrompt,
	livePreviewEnabled,
	nextTranslationMode,
	parseTranslationModeCommand,
	submitTimeReviewEnabled,
	TRANSLATION_MODE_ENTRY_TYPE,
	translationModeFromEntries,
} from "./translation-mode.ts";

test("parses translation mode commands case-insensitively", () => {
	assert.equal(parseTranslationModeCommand("off"), "off");
	assert.equal(parseTranslationModeCommand(" PREVIEW "), "preview");
	assert.equal(parseTranslationModeCommand("Review"), "review");
	assert.equal(parseTranslationModeCommand("Status"), "status");
	assert.equal(parseTranslationModeCommand(""), undefined);
	assert.equal(parseTranslationModeCommand("on"), undefined);
});

test("restores the latest valid branch-local translation mode", () => {
	const entries = [
		{ type: "custom", customType: TRANSLATION_MODE_ENTRY_TYPE, data: { mode: "off" } },
		{ type: "custom", customType: "other-extension", data: { mode: "preview" } },
		{ type: "custom", customType: TRANSLATION_MODE_ENTRY_TYPE, data: { mode: "invalid" } },
		{ type: "custom", customType: TRANSLATION_MODE_ENTRY_TYPE, data: { mode: "preview" } },
	];
	assert.equal(translationModeFromEntries(entries), "preview");
	assert.equal(translationModeFromEntries(entries.slice(0, 3)), "off");
	assert.equal(DEFAULT_TRANSLATION_MODE, "preview");
	assert.equal(translationModeFromEntries([]), "preview");
});

test("cycles through off, preview, and review modes", () => {
	assert.equal(nextTranslationMode("off"), "preview");
	assert.equal(nextTranslationMode("preview"), "review");
	assert.equal(nextTranslationMode("review"), "off");
});

test("each mode enables only its intended automatic behavior", () => {
	assert.equal(automaticTranslationEnabled("off"), false);
	assert.equal(livePreviewEnabled("off"), false);
	assert.equal(submitTimeReviewEnabled("off"), false);

	assert.equal(automaticTranslationEnabled("preview"), true);
	assert.equal(livePreviewEnabled("preview"), true);
	assert.equal(submitTimeReviewEnabled("preview"), false);

	assert.equal(automaticTranslationEnabled("review"), true);
	assert.equal(livePreviewEnabled("review"), false);
	assert.equal(submitTimeReviewEnabled("review"), true);
});

test("off disables English prompt injection", () => {
	assert.equal(englishReplySystemPrompt("base", "instruction", "off"), undefined);
	assert.equal(englishReplySystemPrompt("base", "instruction", "preview"), "base\n\ninstruction");
	assert.equal(englishReplySystemPrompt("base", "instruction", "review"), "base\n\ninstruction");
});
