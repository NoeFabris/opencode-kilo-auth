import {
  KILO_OPENROUTER_BASE,
  HEADER_ORGANIZATION_ID,
  HEADER_EDITOR_NAME,
  ENV_KILOCODE_EDITOR_NAME,
  DEFAULT_EDITOR_NAME,
} from "./constants.js";

export type KiloModelsOptions = {
  token?: string;
  organizationId?: string;
  baseURL?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type OpenRouterModel = {
  id: string;
  name: string;
  created?: number;
  description?: string;
  context_length: number;
  max_completion_tokens?: number | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
    input_cache_write?: string | null;
    input_cache_read?: string | null;
  };
  architecture?: {
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
  };
  top_provider?: {
    max_completion_tokens?: number | null;
  };
  supported_parameters?: string[];
};

export type KiloModelConfig = {
  modelID: string;
  name: string;
  family?: string;
  releaseDate?: string;
  capabilities: {
    tools: boolean;
    input: string[];
    output: string[];
    temperature: boolean;
    reasoning: { supported: boolean };
  };
  limit: { context: number; output: number };
  cost?: { input: number; output: number; cache?: { read?: number; write?: number } };
  variants?: Array<{ id: string; body: Record<string, unknown> }>;
};

type OpenRouterModelsResponse = {
  data: OpenRouterModel[];
};

function parsePrice(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  // OpenRouter quotes per token; OpenCode uses USD per million tokens.
  return parsed * 1_000_000;
}

function mapModalities(values: string[] | null | undefined): Array<"text" | "audio" | "image" | "video" | "pdf"> {
  const result: Array<"text" | "audio" | "image" | "video" | "pdf"> = [];

  for (const item of values ?? []) {
    if (item === "text") result.push("text");
    if (item === "image") result.push("image");
    if (item === "audio") result.push("audio");
    if (item === "video") result.push("video");
    if (item === "pdf") result.push("pdf");
  }

  if (!result.includes("text")) result.unshift("text");
  return result;
}

function extractFamily(modelId: string): string | undefined {
  const parts = modelId.split("/");
  if (parts.length < 2) return undefined;
  const name = parts[1] ?? "";
  if (name.includes("claude")) return "claude";
  if (name.includes("gpt")) return "gpt";
  if (name.includes("gemini")) return "gemini";
  if (name.includes("llama")) return "llama";
  if (name.includes("mistral")) return "mistral";
  return undefined;
}

export async function fetchKiloModels(options: KiloModelsOptions = {}): Promise<Record<string, KiloModelConfig>> {
  const modelsURL = `${(options.baseURL ?? KILO_OPENROUTER_BASE).replace(/\/+$/, "")}/models`;
  const editorName = process.env[ENV_KILOCODE_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "opencode-kilo-auth",
    [HEADER_EDITOR_NAME]: editorName,
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.organizationId) {
    headers[HEADER_ORGANIZATION_ID] = options.organizationId;
  }

  const response = await fetch(modelsURL, {
    headers,
    signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10_000), ...(options.signal ? [options.signal] : [])]),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as OpenRouterModelsResponse;
  const models: Record<string, KiloModelConfig> = {};

  for (const model of json.data ?? []) {
    if (model.architecture?.output_modalities?.includes("image")) continue;

    const inputPrice = parsePrice(model.pricing?.prompt);
    const outputPrice = parsePrice(model.pricing?.completion);
    const cacheWrite = parsePrice(model.pricing?.input_cache_write);
    const cacheRead = parsePrice(model.pricing?.input_cache_read);

    const inputModalities = model.architecture?.input_modalities ?? [];
    const outputModalities = model.architecture?.output_modalities ?? [];
    const supported = model.supported_parameters ?? [];

    const supportsTools = supported.includes("tools");
    const supportsReasoning = supported.includes("reasoning") || supported.includes("include_reasoning");
    const supportsTemperature = supported.includes("temperature");

    const maxOutput =
      model.top_provider?.max_completion_tokens ??
      model.max_completion_tokens ??
      Math.ceil(model.context_length * 0.2);

    const transformed: KiloModelConfig = {
      modelID: model.id,
      name: model.name,
      family: extractFamily(model.id),
      ...(model.created ? { releaseDate: new Date(model.created * 1000).toISOString().slice(0, 10) } : {}),
      capabilities: {
        tools: supportsTools,
        input: mapModalities(inputModalities),
        output: mapModalities(outputModalities),
        temperature: supportsTemperature,
        reasoning: { supported: supportsReasoning },
      },
      limit: {
        context: model.context_length,
        output: maxOutput,
      },
      ...(supportsReasoning && model.id.toLowerCase().startsWith("anthropic/") ? {
        variants: [
          { id: "high", body: { reasoning: { effort: "high" } } },
          { id: "max", body: { reasoning: { effort: "xhigh" } } },
        ],
      } : {}),
    };

    if (inputPrice !== undefined && outputPrice !== undefined) {
      transformed.cost = {
        input: inputPrice,
        output: outputPrice,
        ...(cacheRead !== undefined || cacheWrite !== undefined ? {
          cache: {
            ...(cacheRead !== undefined ? { read: cacheRead } : {}),
            ...(cacheWrite !== undefined ? { write: cacheWrite } : {}),
          },
        } : {}),
      };
    }

    models[model.id] = transformed;
  }

  return models;
}
