export interface AsuAimlProviderConfig {
  apiKey: string;
  baseUrl: string;
  modelProvider?: string;
  model: string;
  temperature: number;
  timeoutMs: number;
}

export interface AsuAimlProviderInput {
  apiKey: string;
  model: string;
  baseUrl?: string;
  modelProvider?: string;
  temperature?: number;
  timeoutMs?: number;
}

export const DEFAULT_ASU_BASE_URL = "https://api-main.aiml.asu.edu/queryV2";
export const DEFAULT_ASU_TEMPERATURE = 0.2;
export const DEFAULT_ASU_TIMEOUT_MS = 120000;

function readNumberEnv(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected a numeric value, received ${value}.`);
  }

  return parsed;
}

function readIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }

  return parsed;
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function createAsuAimlProviderConfig(
  input: AsuAimlProviderInput,
): AsuAimlProviderConfig {
  return {
    apiKey: input.apiKey.trim(),
    baseUrl: input.baseUrl?.trim() || DEFAULT_ASU_BASE_URL,
    modelProvider: normalizeOptionalString(input.modelProvider),
    model: input.model.trim(),
    temperature: input.temperature ?? DEFAULT_ASU_TEMPERATURE,
    timeoutMs: input.timeoutMs ?? DEFAULT_ASU_TIMEOUT_MS,
  };
}

export function readAsuAimlProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): AsuAimlProviderConfig {
  const apiKey = env.ASU_API_KEY?.trim();
  const model = env.ASU_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error(
      "ASU_API_KEY and ASU_MODEL are required when using the ASU provider.",
    );
  }

  return createAsuAimlProviderConfig({
    apiKey,
    baseUrl: env.ASU_BASE_URL,
    modelProvider: env.ASU_MODEL_PROVIDER,
    model,
    temperature: readNumberEnv(env.ASU_TEMPERATURE, DEFAULT_ASU_TEMPERATURE),
    timeoutMs: readIntegerEnv(env.ASU_TIMEOUT_MS, DEFAULT_ASU_TIMEOUT_MS),
  });
}
