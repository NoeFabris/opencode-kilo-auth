import {
  KILO_API_BASE,
  KILO_OPENROUTER_BASE,
  HEADER_ORGANIZATION_ID,
  HEADER_EDITOR_NAME,
  ENV_KILOCODE_EDITOR_NAME,
  DEFAULT_EDITOR_NAME,
} from "./constants";

export type KiloModelsOptions = {
  token?: string;
  organizationId?: string;
  baseURL?: string;
  timeoutMs?: number;
};

type OpenRouterModel = {
  id: string;
  name: string;
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

type OpenRouterModelsResponse = {
  data: OpenRouterModel[];
};

function parsePrice(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
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

function getKiloUrlFromToken(defaultUrl: string, token?: string): string {
  if (!token) return defaultUrl;
  try {
    const parts = token.split(":");
    if (parts.length > 1 && parts[0]?.startsWith("http")) {
      return parts[0];
    }
  } catch {
    // ignore token parsing errors
  }
  return defaultUrl;
}

export async function fetchKiloModels(options: KiloModelsOptions = {}): Promise<Record<string, any>> {
  const baseURL = options.baseURL
    ? options.baseURL.replace(/\/+$/, "")
    : options.organizationId
      ? `${KILO_API_BASE}/api/organizations/${options.organizationId}`
      : KILO_OPENROUTER_BASE;

  const finalBaseURL = getKiloUrlFromToken(baseURL, options.token);
  const modelsURL = `${finalBaseURL.replace(/\/+$/, "")}/models`;
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
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as OpenRouterModelsResponse;
  const today = new Date().toISOString().split("T")[0] ?? "";

  const models: Record<string, any> = {};

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
    const supportsReasoning = supported.includes("reasoning");
    const supportsTemperature = supported.includes("temperature");
    const supportsImages = inputModalities.includes("image");

    const maxOutput =
      model.top_provider?.max_completion_tokens ??
      model.max_completion_tokens ??
      Math.ceil(model.context_length * 0.2);

    const transformed: Record<string, any> = {
      id: model.id,
      name: model.name,
      family: extractFamily(model.id),
      release_date: today,
      attachment: supportsImages,
      reasoning: supportsReasoning,
      temperature: supportsTemperature,
      tool_call: supportsTools,
      limit: {
        context: model.context_length,
        output: maxOutput,
      },
      options: {
        ...(model.description ? { description: model.description } : {}),
      },
      ...(inputModalities.length > 0 || outputModalities.length > 0
        ? {
            modalities: {
              input: mapModalities(inputModalities),
              output: mapModalities(outputModalities),
            },
          }
        : {}),
    };

    if (inputPrice !== undefined && outputPrice !== undefined) {
      transformed.cost = {
        input: inputPrice,
        output: outputPrice,
        ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
        ...(cacheWrite !== undefined ? { cache_write: cacheWrite } : {}),
      };
    }

    models[model.id] = transformed;
  }

  return models;
}
