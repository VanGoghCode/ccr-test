import type { AsuAimlProviderConfig } from "./api.js";
import type {
  ReviewProvider,
  ReviewProviderMessage,
  ReviewProviderRequest,
  ReviewProviderResult,
} from "./types.js";

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function convertMessagesToAsuFormat(messages: ReviewProviderMessage[]): {
  systemPrompt: string;
  query: string;
} {
  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content);

  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserMessage = userMessages[userMessages.length - 1];

  if (!lastUserMessage) {
    throw new Error("No user message found in provider input.");
  }

  return {
    systemPrompt: systemParts.join("\n\n"),
    query: lastUserMessage.content,
  };
}

function parseAsuAimlResponse(rawBody: string): ReviewProviderResult {
  const parsed = JSON.parse(rawBody) as Record<string, unknown>;

  const usageCandidate =
    (parsed.usage as Record<string, unknown> | undefined) ??
    (parsed.metrics as Record<string, unknown> | undefined);
  const usage = usageCandidate
    ? {
        promptTokens: toFiniteNumber(
          usageCandidate.prompt_tokens ?? usageCandidate.input_tokens,
        ),
        completionTokens: toFiniteNumber(
          usageCandidate.completion_tokens ?? usageCandidate.output_tokens,
        ),
        totalTokens: toFiniteNumber(usageCandidate.total_tokens),
      }
    : undefined;

  const withResult = (output: string): ReviewProviderResult => ({
    output,
    usage,
  });

  if (typeof parsed.response === "string") return withResult(parsed.response);
  if (typeof parsed.output === "string") return withResult(parsed.output);
  if (typeof parsed.result === "string") return withResult(parsed.result);
  if (typeof parsed.content === "string") return withResult(parsed.content);

  const choices = parsed.choices as
    | Array<{ message?: { content?: string } }>
    | undefined;
  if (choices?.[0]?.message?.content) {
    return withResult(choices[0].message.content);
  }

  const resp = parsed.response as Record<string, unknown> | undefined;
  if (resp && typeof resp === "object") {
    if (typeof resp.content === "string") return withResult(resp.content);
    if (typeof resp.text === "string") return withResult(resp.text);
    if (typeof resp.message === "string") return withResult(resp.message);
  }

  throw new Error(
    `Unexpected ASU AIML response format: ${rawBody.slice(0, 500)}`,
  );
}

export async function requestAsuAimlChatCompletion(
  config: AsuAimlProviderConfig,
  messages: ReviewProviderMessage[],
): Promise<ReviewProviderResult> {
  const { systemPrompt, query } = convertMessagesToAsuFormat(messages);

  const body: Record<string, unknown> = {
    action: "query",
    request_source: "override_params",
    query,
    model_name: config.model,
    model_params: {
      temperature: config.temperature,
      ...(systemPrompt.length > 0 ? { system_prompt: systemPrompt } : {}),
    },
  };

  if (config.modelProvider && config.modelProvider.trim().length > 0) {
    body.model_provider = config.modelProvider;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `ASU AIML request failed with status ${response.status}: ${rawBody}`,
      );
    }

    return parseAsuAimlResponse(rawBody);
  } finally {
    clearTimeout(timeout);
  }
}

export function createAsuAimlProvider(
  config: AsuAimlProviderConfig,
): ReviewProvider {
  return {
    async review(input: ReviewProviderRequest): Promise<ReviewProviderResult> {
      try {
        return await requestAsuAimlChatCompletion(config, input.messages);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to complete the review request: ${message}`);
      }
    },
  };
}
