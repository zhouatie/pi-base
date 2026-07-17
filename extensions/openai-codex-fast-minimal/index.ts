import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createOpenAICodexAuthResolver } from "./auth.ts";
import { OPENAI_CODEX_FAST_PROVIDER } from "./constants.ts";
import { getFastModels } from "./models.ts";
import { streamFastOpenAICodex } from "./stream.ts";

const AUTH_MARKER = "__reuse_openai_codex_auth__";

export default function (pi: ExtensionAPI) {
	const auth = createOpenAICodexAuthResolver();
	const models = getFastModels();
	const baseUrl = models[0]?.baseUrl;
	if (!baseUrl) throw new Error("No OpenAI Codex fast models found.");

	pi.registerProvider(OPENAI_CODEX_FAST_PROVIDER, {
		name: "OpenAI Codex Fast",
		baseUrl,
		apiKey: AUTH_MARKER,
		api: "openai-codex-responses",
		models,
		streamSimple: (model, context, options) =>
			streamFastOpenAICodex((modelId) => auth.getApiKey(modelId), model, context, options),
	});

	pi.on("session_start", (_event, context) => {
		auth.bind(context);
	});
}
