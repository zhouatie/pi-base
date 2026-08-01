import assert from "node:assert/strict";
import test from "node:test";
import {
	automaticTranslationEnabled,
	englishReplySystemPrompt,
	parseTranslationModeCommand,
	TRANSLATION_MODE_ENTRY_TYPE,
	translationModeFromEntries,
} from "./translation-mode.ts";

test("parses translation mode commands case-insensitively", () => {
	assert.equal(parseTranslationModeCommand("on"), "on");
	assert.equal(parseTranslationModeCommand(" OFF "), "off");
	assert.equal(parseTranslationModeCommand("Status"), "status");
	assert.equal(parseTranslationModeCommand(""), undefined);
	assert.equal(parseTranslationModeCommand("toggle"), undefined);
});

test("restores the latest valid branch-local translation mode", () => {
	const entries = [
		{ type: "custom", customType: TRANSLATION_MODE_ENTRY_TYPE, data: { mode: "off" } },
		{ type: "custom", customType: "other-extension", data: { mode: "on" } },
		{ type: "custom", customType: TRANSLATION_MODE_ENTRY_TYPE, data: { mode: "invalid" } },
		{ type: "custom", customType: TRANSLATION_MODE_ENTRY_TYPE, data: { mode: "on" } },
	];
	assert.equal(translationModeFromEntries(entries), "on");
	assert.equal(translationModeFromEntries(entries.slice(0, 3)), "off");
	assert.equal(translationModeFromEntries([]), "on");
});

test("off disables both automatic input processing and English prompt injection", () => {
	assert.equal(automaticTranslationEnabled("off"), false);
	assert.equal(englishReplySystemPrompt("base", "instruction", "off"), undefined);
	assert.equal(automaticTranslationEnabled("on"), true);
	assert.equal(englishReplySystemPrompt("base", "instruction", "on"), "base\n\ninstruction");
});
