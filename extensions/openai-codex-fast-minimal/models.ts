import type { ProviderConfigInput } from "@earendil-works/pi-coding-agent";
import { getModels, type Model } from "@earendil-works/pi-ai/compat";
import { OPENAI_CODEX_FAST_MODELS } from "./constants.ts";

export function getFastModels(): NonNullable<ProviderConfigInput["models"]> {
	const models = new Map(
		getModels("openai-codex").map((model: Model<any>) => [model.id, model]),
	);

	return OPENAI_CODEX_FAST_MODELS.flatMap((id) => {
		const model = models.get(id);
		if (!model) return [];

		return [{
			id: model.id,
			name: model.name,
			api: model.api,
			baseUrl: model.baseUrl,
			reasoning: model.reasoning,
			thinkingLevelMap: model.thinkingLevelMap,
			input: [...model.input],
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			...(model.headers !== undefined ? { headers: model.headers } : {}),
			compat: model.compat,
		}];
	});
}
