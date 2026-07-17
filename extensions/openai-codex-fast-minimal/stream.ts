import {
	clampThinkingLevel,
	createAssistantMessageEventStream,
	streamOpenAICodexResponses,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { ApiKeyResolver } from "./auth.ts";

function errorMessage(
	model: Model<any>,
	error: unknown,
	options?: SimpleStreamOptions,
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: options?.signal?.aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

export function streamFastOpenAICodex(
	getApiKey: ApiKeyResolver,
	model: Model<any>,
	context: Context,
	options?: SimpleStreamOptions,
) {
	const outer = createAssistantMessageEventStream();

	void (async () => {
		try {
			const reasoning = options?.reasoning
				? clampThinkingLevel(model, options.reasoning)
				: undefined;
			const reasoningEffort = reasoning === "off" ? undefined : reasoning;
			const inner = streamOpenAICodexResponses(model, context, {
				...options,
				apiKey: await getApiKey(model.id),
				serviceTier: "priority",
				...(reasoningEffort ? { reasoningEffort } : {}),
			});
			for await (const event of inner) outer.push(event);
			outer.end();
		} catch (error) {
			const message = errorMessage(model, error, options);
			outer.push({
				type: "error",
				reason: message.stopReason === "aborted" ? "aborted" : "error",
				error: message,
			});
			outer.end(message);
		}
	})();

	return outer;
}
