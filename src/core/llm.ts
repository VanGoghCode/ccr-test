import type {
  AsuAimlProviderConfig,
  OpenAiCompatibleProviderConfig,
} from "./api";
import type {
  ReviewProvider,
  ReviewProviderMessage,
  ReviewProviderRequest,
} from "./types";

function toCompletionUrl(baseUrl: string): string {
  return new URL(
    "chat/completions",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}

function buildRequestBody(
  config: OpenAiCompatibleProviderConfig,
  messages: ReviewProviderMessage[],
): Record<string, unknown> {
  return {
    model: config.model,
    temperature: config.temperature,
    messages,
  };
}

function parseChatCompletionContent(rawBody: string): string {
  const parsed = JSON.parse(rawBody) as {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  };

  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(
      "Model response did not include a chat completion payload.",
    );
  }

  return content;
}

export async function fetchWithAbort(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

export async function requestOpenAiCompatibleChatCompletion(
  config: OpenAiCompatibleProviderConfig,
  messages: ReviewProviderMessage[],
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(toCompletionUrl(config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRequestBody(config, messages)),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `Model request failed with status ${response.status}: ${rawBody}`,
      );
    }

    return parseChatCompletionContent(rawBody);
  } finally {
    clearTimeout(timeout);
  }
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

function parseAsuAimlResponse(rawBody: string): string {
  const parsed = JSON.parse(rawBody) as Record<string, unknown>;

  if (typeof parsed.response === "string") return parsed.response;
  if (typeof parsed.output === "string") return parsed.output;
  if (typeof parsed.result === "string") return parsed.result;
  if (typeof parsed.content === "string") return parsed.content;

  const choices = parsed.choices as
    | Array<{ message?: { content?: string } }>
    | undefined;
  if (choices?.[0]?.message?.content) return choices[0].message.content;

  const resp = parsed.response as Record<string, unknown> | undefined;
  if (resp && typeof resp === "object") {
    if (typeof resp.content === "string") return resp.content;
    if (typeof resp.text === "string") return resp.text;
    if (typeof resp.message === "string") return resp.message;
  }

  throw new Error(
    `Unexpected ASU AIML response format: ${rawBody.slice(0, 500)}`,
  );
}

export async function requestAsuAimlChatCompletion(
  config: AsuAimlProviderConfig,
  messages: ReviewProviderMessage[],
): Promise<string> {
  const { systemPrompt, query } = convertMessagesToAsuFormat(messages);

  const body: Record<string, unknown> = {
    action: "query",
    request_source: "override_params",
    query,
    model_provider: config.modelProvider,
    model_name: config.model,
    model_params: {
      temperature: config.temperature,
      ...(systemPrompt.length > 0 ? { system_prompt: systemPrompt } : {}),
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  // DEBUG: log what's being sent
  console.log("[ASU DEBUG] URL:", config.baseUrl);
  console.log(
    "[ASU DEBUG] Auth header value:",
    `Bearer ${config.apiKey.slice(0, 20)}...`,
  );
  console.log("[ASU DEBUG] Key length:", config.apiKey.length);
  console.log("[ASU DEBUG] model_provider:", config.modelProvider);
  console.log("[ASU DEBUG] model_name:", config.model);

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
    async review(input: ReviewProviderRequest): Promise<string> {
      try {
        return await requestAsuAimlChatCompletion(config, input.messages);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to complete the review request: ${message}`);
      }
    },
  };
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleProviderConfig,
): ReviewProvider {
  return {
    async review(input: ReviewProviderRequest): Promise<string> {
      try {
        return await requestOpenAiCompatibleChatCompletion(
          config,
          input.messages,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to complete the review request: ${message}`);
      }
    },
  };
}
