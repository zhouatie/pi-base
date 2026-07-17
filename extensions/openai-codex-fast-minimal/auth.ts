import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OPENAI_CODEX_PROVIDER } from "./constants.ts";

export type ApiKeyResolver = (modelId: string) => Promise<string>;

export function createOpenAICodexAuthResolver() {
	let context: ExtensionContext | undefined;

	return {
		bind(nextContext: ExtensionContext) {
			context = nextContext;
		},
		async getApiKey(modelId: string): Promise<string> {
			if (!context) {
				throw new Error("OpenAI Codex auth is not initialized.");
			}

			const model = context.modelRegistry.find(OPENAI_CODEX_PROVIDER, modelId);
			if (!model) {
				throw new Error(`OpenAI Codex model not found: ${modelId}`);
			}

			const auth = await context.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				throw new Error(auth.error);
			}
			if (!auth.apiKey) {
				throw new Error(`No ${OPENAI_CODEX_PROVIDER} auth found. Use /login first.`);
			}
			return auth.apiKey;
		},
	};
}
