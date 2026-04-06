export interface OpenAiCompatibleProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  timeoutMs: number;
}

export interface OpenAiCompatibleProviderInput {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  timeoutMs?: number;
}

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_CREATEAI_BASE_URL = "https://platform.aiml.asu.edu/api";
export const DEFAULT_OPENAI_TEMPERATURE = 0.2;
export const DEFAULT_OPENAI_TIMEOUT_MS = 120000;

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

export function createOpenAiCompatibleProviderConfig(
  input: OpenAiCompatibleProviderInput,
): OpenAiCompatibleProviderConfig {
  return {
    apiKey: input.apiKey.trim(),
    baseUrl: input.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL,
    model: input.model.trim(),
    temperature: input.temperature ?? DEFAULT_OPENAI_TEMPERATURE,
    timeoutMs: input.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS,
  };
}

export interface AsuAimlProviderConfig {
  apiKey: string;
  baseUrl: string;
  modelProvider: string;
  model: string;
  temperature: number;
  timeoutMs: number;
}

export const DEFAULT_ASU_BASE_URL = "https://api-main.aiml.asu.edu/queryV2";
export const DEFAULT_ASU_MODEL_PROVIDER = "openai";

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

  return {
    apiKey,
    baseUrl: env.ASU_BASE_URL?.trim() || DEFAULT_ASU_BASE_URL,
    modelProvider:
      env.ASU_MODEL_PROVIDER?.trim() || DEFAULT_ASU_MODEL_PROVIDER,
    model,
    temperature: readNumberEnv(
      env.ASU_TEMPERATURE,
      DEFAULT_OPENAI_TEMPERATURE,
    ),
    timeoutMs: readIntegerEnv(
      env.ASU_TIMEOUT_MS,
      DEFAULT_OPENAI_TIMEOUT_MS,
    ),
  };
}

export function readOpenAiCompatibleProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenAiCompatibleProviderConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error(
      "OPENAI_API_KEY and OPENAI_MODEL are required when using the OpenAI-compatible provider.",
    );
  }

  return createOpenAiCompatibleProviderConfig({
    apiKey,
    model,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_CREATEAI_BASE_URL,
    temperature: readNumberEnv(
      env.OPENAI_TEMPERATURE,
      DEFAULT_OPENAI_TEMPERATURE,
    ),
    timeoutMs: readIntegerEnv(
      env.OPENAI_TIMEOUT_MS,
      DEFAULT_OPENAI_TIMEOUT_MS,
    ),
  });
}
