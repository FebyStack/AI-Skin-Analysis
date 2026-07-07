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

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
