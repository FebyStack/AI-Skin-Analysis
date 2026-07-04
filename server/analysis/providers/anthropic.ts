export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}
export class ProviderAuthError extends ProviderError {
  constructor() {
    super("Provider rejected the API key");
    this.name = "ProviderAuthError";
  }
}
export class ProviderRateLimitError extends ProviderError {
  constructor() {
    super("Provider rate limit hit");
    this.name = "ProviderRateLimitError";
  }
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface VisionRequest {
  imageB64: string;
  mime: string;
  system: string;
  user: string;
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export async function callClaude(
  req: VisionRequest,
  cfg: ProviderConfig,
  fetchFn: FetchFn = fetch,
): Promise<ProviderResult> {
  const res = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: req.system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: req.mime, data: req.imageB64 },
            },
            { type: "text", text: req.user },
          ],
        },
      ],
    }),
  });

  if (res.status === 401 || res.status === 403) throw new ProviderAuthError();
  if (res.status === 429) throw new ProviderRateLimitError();
  if (!res.ok) throw new ProviderError(`Provider returned ${res.status}`);

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new ProviderError("Provider response had no text content");
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
