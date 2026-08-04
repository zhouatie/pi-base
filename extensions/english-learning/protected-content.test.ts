import assert from "node:assert/strict";
import test from "node:test";
import { inputReviewTarget, isSlashCommandInput } from "./input-review.ts";
import { collectProtectedContentRanges, textOutsideProtectedContent } from "./protected-content.ts";
import { recommendEnglishWithDeepSeek, reviewEnglishWithDeepSeek, translateWithDeepSeek } from "./translator.ts";

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

test("treats Pi slash-commands specially but allows absolute image paths", () => {
	const draft =
		"/var/folders/jv/x/T/pi-clipboard-8f8d.png\n帮我解决这个 lint问题";
	assert.equal(isSlashCommandInput(draft), false);
	assert.ok(inputReviewTarget(draft));

	assert.equal(isSlashCommandInput("/trans preview"), true);
	assert.equal(inputReviewTarget("/trans preview"), undefined);

	assert.equal(isSlashCommandInput("/oracle 修复报错"), true);
	assert.ok(inputReviewTarget("/oracle 修复报错"));
});

test("does not treat ALL-CAPS acronyms as camelCase identifiers", () => {
	const source = "视觉UI优化，隐藏款解锁弹窗下面的额外奖励相当当前位置往下移动10pt";
	assert.deepEqual(collectProtectedContentRanges(source, true), []);
	assert.ok(inputReviewTarget(source));

	const mixed = "用 UIKit 和 getUserName 处理 API 请求";
	assert.deepEqual(
		collectProtectedContentRanges(mixed, false)
			.filter((range) => range.kind === "hard")
			.map((range) => range.value),
		["UIKit", "getUserName"],
	);
});

test("protects whole project-relative paths and leaves trailing Chinese free", () => {
	const source = "src/components/squareBrowseTaskTimer/index.jsx\n我是";
	const hardValues = collectProtectedContentRanges(source, true)
		.filter((range) => range.kind === "hard")
		.map((range) => range.value);

	assert.deepEqual(hardValues, ["src/components/squareBrowseTaskTimer/index.jsx"]);
	assert.equal(
		textOutsideProtectedContent(source, true).includes("我是"),
		true,
	);
	assert.ok(inputReviewTarget(source));
});

test("does not treat English slash pairs as paths", () => {
	const source = "use and/or carefully with I/O";
	const hardValues = collectProtectedContentRanges(source, false)
		.filter((range) => range.kind === "hard")
		.map((range) => range.value);

	assert.deepEqual(hardValues, []);
});

test("still protects absolute and explicit relative paths as whole tokens", () => {
	const source = "fix /tmp/file.ts and ./src/main.ts plus ~/project/app.tsx";
	const hardValues = collectProtectedContentRanges(source, false)
		.filter((range) => range.kind === "hard")
		.map((range) => range.value);

	assert.deepEqual(hardValues, ["/tmp/file.ts", "./src/main.ts", "~/project/app.tsx"]);
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

test("live recommendations keep mixed Chinese with ALL-CAPS acronyms fully translatable", async () => {
	const originalFetch = globalThis.fetch;
	const originalApiKey = process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
	process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = "test-key";
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string };
		assert.equal(body.input.includes("视觉UI优化"), true);
		assert.equal((body.input.match(/⟪PI_TRANSLATION_KEEP_\d+⟫/g) ?? []).length, 0);
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								text: "Visual UI polish: move the extra rewards under the hidden-style unlock popup down by 10pt from the current position",
							},
						],
					},
				],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		const source = "视觉UI优化，隐藏款解锁弹窗下面的额外奖励相当当前位置往下移动10pt";
		assert.equal(
			await recommendEnglishWithDeepSeek(source),
			"Visual UI polish: move the extra rewards under the hidden-style unlock popup down by 10pt from the current position",
		);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalApiKey === undefined) delete process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
		else process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = originalApiKey;
	}
});

test("live recommendations keep relative paths whole and still translate Chinese", async () => {
	const originalFetch = globalThis.fetch;
	const originalApiKey = process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
	process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = "test-key";
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string };
		const placeholders = body.input.match(/⟪PI_TRANSLATION_KEEP_\d+⟫/g) ?? [];
		assert.equal(body.input.includes("src/components"), false);
		assert.equal(body.input.includes("我是"), true);
		assert.equal(placeholders.length, 1);
		assert.match(body.input, new RegExp(`${placeholders[0]}\\n我是`));
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: `${placeholders[0]}\nI am` }],
					},
				],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		const source = "src/components/squareBrowseTaskTimer/index.jsx\n我是";
		assert.equal(
			await recommendEnglishWithDeepSeek(source),
			"src/components/squareBrowseTaskTimer/index.jsx\nI am",
		);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalApiKey === undefined) delete process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
		else process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = originalApiKey;
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

test("retries once and succeeds when the first attempt drops a protected placeholder", async () => {
	const originalFetch = globalThis.fetch;
	const originalApiKey = process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
	process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = "test-key";
	let requestIndex = 0;
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string };
		const placeholders = body.input.match(/⟪PI_TRANSLATION_KEEP_\d+⟫/g) ?? [];
		const text =
			requestIndex++ === 0
				? "I am" // first attempt drops the placeholder
				: `${placeholders[0]}\nI am`; // retry keeps it
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [{ type: "message", content: [{ type: "output_text", text }] }],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		const source = "src/components/squareBrowseTaskTimer/index.jsx\n我是";
		assert.equal(
			await recommendEnglishWithDeepSeek(source),
			"src/components/squareBrowseTaskTimer/index.jsx\nI am",
		);
		assert.equal(requestIndex, 2);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalApiKey === undefined) delete process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
		else process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = originalApiKey;
	}
});

test("falls back leniently when the retry also drops a placeholder", async () => {
	const originalFetch = globalThis.fetch;
	const originalApiKey = process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
	process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = "test-key";
	let requestIndex = 0;
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string };
		assert.equal((body.input.match(/⟪PI_TRANSLATION_KEEP_\d+⟫/g) ?? []).length, 1);
		requestIndex++;
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: "I am" }],
					},
				],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		const source = "src/components/squareBrowseTaskTimer/index.jsx\n我是";
		const english = await recommendEnglishWithDeepSeek(source);
		assert.equal(english, "I am");
		assert.equal(english.includes("⟪PI_TRANSLATION_KEEP_"), false);
		assert.equal(requestIndex, 2);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalApiKey === undefined) delete process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
		else process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = originalApiKey;
	}
});

test("collapses a duplicated placeholder leniently without leaking tokens", async () => {
	const originalFetch = globalThis.fetch;
	const originalApiKey = process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
	process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = "test-key";
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string };
		const placeholders = body.input.match(/⟪PI_TRANSLATION_KEEP_\d+⟫/g) ?? [];
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [
					{
						type: "message",
						content: [
							{ type: "output_text", text: `${placeholders[0]} ${placeholders[0]} more` },
						],
					},
				],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		const source = "src/components/squareBrowseTaskTimer/index.jsx\n我是";
		const english = await recommendEnglishWithDeepSeek(source);
		assert.equal(
			english,
			"src/components/squareBrowseTaskTimer/index.jsx src/components/squareBrowseTaskTimer/index.jsx more",
		);
		assert.equal(english.includes("⟪PI_TRANSLATION_KEEP_"), false);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalApiKey === undefined) delete process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
		else process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = originalApiKey;
	}
});

test("reply translation falls back leniently instead of failing on dropped placeholders", async () => {
	const originalFetch = globalThis.fetch;
	const originalApiKey = process.env.DEEPSEEK_PI_TRANSLATE_API_KEY;
	process.env.DEEPSEEK_PI_TRANSLATE_API_KEY = "test-key";
	let requestIndex = 0;
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string };
		assert.equal((body.input.match(/⟪PI_TRANSLATION_KEEP_\d+⟫/g) ?? []).length, 1);
		requestIndex++;
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: "修复了崩溃" }],
					},
				],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		const source = "Fixed the crash in src/components/squareBrowseTaskTimer/index.jsx";
		const translated = await translateWithDeepSeek(source, "en-zh");
		assert.equal(translated, "修复了崩溃");
		assert.equal(translated.includes("⟪PI_TRANSLATION_KEEP_"), false);
		assert.equal(requestIndex, 2);
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
