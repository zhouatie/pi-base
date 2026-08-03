/** Max wrapped content lines shown above the editor for a recommendation. */
const MAX_RECOMMENDATION_LINES = 14;
/** When truncating, keep this many leading lines (paths / opening context). */
const HEAD_LINES = 8;
/** When truncating, keep this many trailing lines (often the newly translated Chinese). */
const TAIL_LINES = 4;

/**
 * Choose which wrapped recommendation lines to show.
 * Long drafts keep both the head (paths/context) and tail (often new English from Chinese).
 */
export function visibleRecommendationLines(wrapped: string[], ellipsis: string): string[] {
	if (wrapped.length <= MAX_RECOMMENDATION_LINES) return wrapped;

	const headCount = Math.min(HEAD_LINES, MAX_RECOMMENDATION_LINES - TAIL_LINES - 1);
	const tailCount = Math.min(TAIL_LINES, MAX_RECOMMENDATION_LINES - headCount - 1);
	if (headCount + tailCount >= wrapped.length) return wrapped;

	return [...wrapped.slice(0, headCount), ellipsis, ...wrapped.slice(-tailCount)];
}
