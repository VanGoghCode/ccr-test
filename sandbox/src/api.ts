import type {
  LoadedPromptArchitecture,
  LogEntry,
  ReviewFileInput,
  ReviewReport,
  ReviewRequest,
} from "../../src/core/types";

export interface FetchArchitecturesResponse {
  architectures: LoadedPromptArchitecture[];
}

export interface StartRunResponse {
  runId: string;
  status: string;
}

export interface SandboxChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SandboxChatResponse {
  mode: string;
  model?: string;
  reply: string;
}

export interface SandboxRunHandlers {
  onLog?: (entry: LogEntry) => void;
  onResult?: (report: ReviewReport) => void;
  onError?: (error: string) => void;
  onStatus?: (status: string) => void;
}

export async function fetchArchitectures(): Promise<
  LoadedPromptArchitecture[]
> {
  const response = await fetch("/api/architectures");
  if (!response.ok) {
    throw new Error(`Unable to load architectures: ${response.status}`);
  }

  const payload = (await response.json()) as FetchArchitecturesResponse;
  return payload.architectures;
}

export async function startSandboxRun(
  request: ReviewRequest,
): Promise<StartRunResponse> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Unable to start sandbox run: ${response.status}`);
  }

  return (await response.json()) as StartRunResponse;
}

export async function sendSandboxChatMessage(params: {
  message: string;
  history?: SandboxChatMessage[];
}): Promise<SandboxChatResponse> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `Unable to send chat test message (${response.status}): ${rawBody}`,
    );
  }

  return JSON.parse(rawBody) as SandboxChatResponse;
}

export function subscribeToSandboxRun(
  runId: string,
  handlers: SandboxRunHandlers,
): EventSource {
  const source = new EventSource(`/api/runs/${runId}/events`);

  source.addEventListener("log", (event) => {
    const messageEvent = event as MessageEvent<string>;
    if (!messageEvent.data) {
      return;
    }

    handlers.onLog?.(JSON.parse(messageEvent.data) as LogEntry);
  });
  source.addEventListener("result", (event) => {
    const messageEvent = event as MessageEvent<string>;
    if (!messageEvent.data) {
      return;
    }

    const payload = JSON.parse(messageEvent.data) as { report?: ReviewReport };
    if (payload.report) {
      handlers.onResult?.(payload.report);
    }
  });

  source.addEventListener("error", (event) => {
    const messageEvent = event as MessageEvent<string>;
    if (!messageEvent.data) {
      handlers.onError?.("The sandbox stream disconnected.");
      return;
    }

    const payload = JSON.parse(messageEvent.data) as { error?: string };
    handlers.onError?.(payload.error ?? "The sandbox stream failed.");
  });

  source.addEventListener("status", (event) => {
    const messageEvent = event as MessageEvent<string>;
    if (!messageEvent.data) {
      return;
    }

    const payload = JSON.parse(messageEvent.data) as { status?: string };
    if (payload.status) {
      handlers.onStatus?.(payload.status);
    }
  });

  return source;
}

export function toReviewRequestPayload(
  files: ReviewFileInput[],
  metadata: string,
  architectureId: string,
  promptOverrides?: Record<string, string>,
): ReviewRequest {
  return {
    architectureId,
    files,
    context: {
      metadata: metadata.trim().length > 0 ? metadata : undefined,
    },
    promptOverrides,
  };
}
