export type ProtectedContentRange = {
	start: number;
	end: number;
	value: string;
	kind: "hard" | "quote";
};

type QuotedRange = {
	start: number;
	end: number;
};

type OpenQuote = {
	start: number;
	opener: string;
	closer: string;
};

const PAIRED_QUOTES = new Map([
	["“", "”"],
	["‘", "’"],
	["「", "」"],
	["『", "』"],
]);
const SYMMETRIC_QUOTES = new Set(["\"", "'"]);
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

const HARD_PROTECTED_PATTERNS = [
	/```[\s\S]*?(?:```|$)/g,
	/~~~[\s\S]*?(?:~~~|$)/g,
	/(`+)[^\r\n]*?\1/g,
	/https?:\/\/[^\s<>"']+/g,
	/(?:\/|\.\.?\/|~\/)[^\r\n<>]*?\.(?:png|jpe?g|gif|webp|bmp)(?=\s|$|["'”’)\]}】》」』,，。；;:：])/gi,
	/[A-Za-z]:\\[^\r\n<>]*?\.(?:png|jpe?g|gif|webp|bmp)(?=\s|$|["'”’)\]}】》」』,，。；;:：])/gi,
	/(?:\/|\.\.?\/|~\/)[A-Za-z0-9._@%+,\-=/]+/g,
	/[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/g,
	/^[ \t]*\$[ \t]+[^\r\n]+/gm,
	/(?<![\p{L}\p{N}_-])--?[A-Za-z0-9][A-Za-z0-9-]*/gu,
	/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g,
	/\b[A-Za-z]+(?:[A-Z][A-Za-z0-9]*)+\b/g,
];

function isEscaped(source: string, index: number): boolean {
	let backslashes = 0;
	for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor--) backslashes++;
	return backslashes % 2 === 1;
}

function isWordCharacter(character: string | undefined): boolean {
	return character !== undefined && WORD_CHARACTER.test(character);
}

function collectNaturalLanguageQuoteRanges(source: string): QuotedRange[] {
	const stack: OpenQuote[] = [];
	const completed: QuotedRange[] = [];

	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (SYMMETRIC_QUOTES.has(character)) {
			if (isEscaped(source, index)) continue;

			const current = stack[stack.length - 1];
			if (current?.opener === character) {
				if (
					character === "'" &&
					isWordCharacter(source[index - 1]) &&
					isWordCharacter(source[index + 1])
				) {
					continue;
				}
				stack.pop();
				completed.push({ start: current.start, end: index + 1 });
				continue;
			}

			if (character === "'" && isWordCharacter(source[index - 1])) continue;
			stack.push({ start: index, opener: character, closer: character });
			continue;
		}

		const closer = PAIRED_QUOTES.get(character);
		if (closer) {
			stack.push({ start: index, opener: character, closer });
			continue;
		}

		const current = stack[stack.length - 1];
		if (current?.closer === character) {
			stack.pop();
			completed.push({ start: current.start, end: index + 1 });
		}
	}

	completed.sort((left, right) => left.start - right.start || right.end - left.end);
	const outermost: QuotedRange[] = [];
	for (const range of completed) {
		const previous = outermost[outermost.length - 1];
		if (previous && range.end <= previous.end) continue;
		outermost.push(range);
	}
	return outermost;
}

export function collectProtectedContentRanges(
	source: string,
	preserveQuotedContent: boolean,
): ProtectedContentRange[] {
	const ranges: ProtectedContentRange[] = [];

	for (const pattern of HARD_PROTECTED_PATTERNS) {
		pattern.lastIndex = 0;
		for (const match of source.matchAll(pattern)) {
			if (match.index === undefined || match[0].length === 0) continue;
			ranges.push({
				start: match.index,
				end: match.index + match[0].length,
				value: match[0],
				kind: "hard",
			});
		}
	}

	if (preserveQuotedContent) {
		for (const range of collectNaturalLanguageQuoteRanges(source)) {
			ranges.push({
				...range,
				value: source.slice(range.start, range.end),
				kind: "quote",
			});
		}
	}

	ranges.sort((left, right) => left.start - right.start || right.end - left.end);
	const nonOverlapping: ProtectedContentRange[] = [];
	for (const range of ranges) {
		const previous = nonOverlapping[nonOverlapping.length - 1];
		if (previous && range.start < previous.end) continue;
		nonOverlapping.push(range);
	}
	return nonOverlapping;
}

export function textOutsideProtectedContent(source: string, preserveQuotedContent: boolean): string {
	const ranges = collectProtectedContentRanges(source, preserveQuotedContent);
	if (ranges.length === 0) return source;

	let cursor = 0;
	let outside = "";
	for (const range of ranges) {
		outside += source.slice(cursor, range.start);
		cursor = range.end;
	}
	return outside + source.slice(cursor);
}
