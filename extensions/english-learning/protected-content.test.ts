import assert from "node:assert/strict";
import test from "node:test";
import { inputReviewTarget } from "./input-review.ts";
import { collectProtectedContentRanges } from "./protected-content.ts";
import { recommendEnglishWithDeepSeek, reviewEnglishWithDeepSeek } from "./translator.ts";

function quotedValues(source: string): string[] {
	return collectProtectedContentRanges(source, true)
		.filter((range) => range.kind === "quote")
		.map((range) => range.value);
}

test("preserves nested and escaped natural-language quotes as one outer span", () => {
	const source = String.raw`修复 "outer \"inner\" and ‘嵌套’" now`;
	assert.deepEqual(quotedValues(source), [String.raw`"outer \"inner\" and ‘嵌套’"`]);
});

test("does not treat contractions or possessive apostrophes as quotes", () => {
	assert.deepEqual(quotedValues("don't change users' settings"), []);
});

test("does not treat hyphenated words as command-line flags", () => {
	const source = "how does my english-learning extension use deepseek api? --verbose -p";
	const hardValues = collectProtectedContentRanges(source, false)
		.filter((range) => range.kind === "hard")
		.map((range) => range.value);

	assert.deepEqual(hardValues, ["--verbose", "-p"]);
});

test("does not hide trailing prose after an unmatched quote opener", () => {
	const source = "修复 “未闭合 trailing 中文";
	assert.deepEqual(quotedValues(source), []);
	assert.ok(inputReviewTarget(source));
});

test("bypasses review when all natural language is quoted", () => {
	assert.equal(inputReviewTarget("“用户不存在”"), undefined);
	assert.equal(inputReviewTarget('/oracle "用户不存在"'), undefined);
	assert.equal(inputReviewTarget('~/project/file.ts “用户不存在”'), undefined);
});

test("keeps reviewed task command rebuilding for mixed quoted input", () => {
	for (const command of ["worker", "oracle", "hermes"]) {
		const target = inputReviewTarget(`/${command} 修复报错：“用户不存在”`);
		assert.ok(target);
		assert.equal(target.source, "修复报错：“用户不存在”");
		assert.equal(
			target.rebuild('Fix the error: “用户不存在”'),
			`/${command} Fix the error: “用户不存在”`,
		);
	}
});

test("live recommendations preserve quotes and technical content", async () => {
	const originalFetch = globalThis.fetch;
	const originalApiKey = process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
	process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = "test-key";
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string };
		const placeholders = body.input.match(/⟪PI_TRANSLATION_KEEP_\d+⟫/g) ?? [];
		assert.equal(body.input.includes("用户不存在"), false);
		assert.equal(placeholders.length, 2);
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: `Fix ${placeholders[0]} in ${placeholders[1]}` }],
					},
				],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		const source = '修复 “用户不存在” in /tmp/file.ts';
		assert.equal(
			await recommendEnglishWithDeepSeek(source),
			'Fix “用户不存在” in /tmp/file.ts',
		);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalApiKey === undefined) delete process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
		else process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = originalApiKey;
	}
});

test("default review protects quotes while review-all protects only hard technical content", async () => {
	const originalFetch = globalThis.fetch;
	const originalApiKey = process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
	process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = "test-key";
	let requestIndex = 0;
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string };
		const placeholders = body.input.match(/⟪PI_TRANSLATION_KEEP_\d+⟫/g) ?? [];
		let english: string;
		if (requestIndex++ === 0) {
			assert.equal(body.input.includes("用户不存在"), false);
			assert.equal(placeholders.length, 2);
			english = `Fix the error: ${placeholders[0]} ${placeholders[1]}`;
		} else {
			assert.equal(body.input.includes('“用户不存在”'), true);
			assert.equal(placeholders.length, 1);
			english = `Fix the error: “User does not exist” ${placeholders[0]}`;
		}
		const content = JSON.stringify({ english, corrections: [], vocabulary: [] });
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [{ type: "message", content: [{ type: "output_text", text: content }] }],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		const source = '修复报错：“用户不存在” /tmp/file.ts';
		const preserved = await reviewEnglishWithDeepSeek(source);
		assert.equal(preserved.english, 'Fix the error: “用户不存在” /tmp/file.ts');
		assert.equal(preserved.preservedQuotedContent, true);

		const reviewedAll = await reviewEnglishWithDeepSeek(source, undefined, false);
		assert.equal(reviewedAll.english, 'Fix the error: “User does not exist” /tmp/file.ts');
		assert.equal(reviewedAll.preservedQuotedContent, false);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalApiKey === undefined) delete process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
		else process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = originalApiKey;
	}
});
