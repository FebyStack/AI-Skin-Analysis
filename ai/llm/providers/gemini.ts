import { GoogleGenAI } from "@google/genai";
import {
  ProviderError,
  ProviderAuthError,
  ProviderRateLimitError,
  type ProviderConfig,
  type VisionRequest,
  type ProviderResult,
} from "./common";

export async function callGemini(
  req: VisionRequest,
  cfg: ProviderConfig
): Promise<ProviderResult> {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  
  try {
    const response = await ai.models.generateContent({
      model: cfg.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: req.user },
            {
              inlineData: {
                data: req.imageB64,
                mimeType: req.mime,
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction: req.system,
        maxOutputTokens: cfg.maxTokens,
      },
    });

    const text = response.text;
    if (!text) {
      throw new ProviderError("Provider response had no text content");
    }

    return {
      text,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) throw new ProviderAuthError();
    if (err.status === 429) throw new ProviderRateLimitError();
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(err.message || "Unknown provider error");
  }
}
