import { describe, it, expect, vi, beforeEach } from "vitest";
import { callGemini } from "./gemini";
import { ProviderAuthError, ProviderRateLimitError, ProviderError } from "./common";
import { GoogleGenAI } from "@google/genai";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: generateContentMock,
        },
      };
    }),
  };
});

const cfg = { apiKey: "gemini-test-key", model: "gemini-2.5-flash", maxTokens: 2048 };

describe("callGemini", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends prompt, system instruction, and image correctly, and returns response text and tokens", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: "test response text",
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
      },
    });

    const out = await callGemini(
      { imageB64: "b64img", mime: "image/jpeg", system: "SYSTEM_INST", user: "USER_PROMPT" },
      cfg
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: "gemini-test-key" });
    expect(generateContentMock).toHaveBeenCalledWith({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: "USER_PROMPT" },
            {
              inlineData: {
                data: "b64img",
                mimeType: "image/jpeg",
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction: "SYSTEM_INST",
        maxOutputTokens: 2048,
      },
    });

    expect(out.text).toBe("test response text");
    expect(out.inputTokens).toBe(10);
    expect(out.outputTokens).toBe(20);
  });

  it("throws ProviderError if text content is missing", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: "",
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 0,
      },
    });

    await expect(
      callGemini(
        { imageB64: "b64img", mime: "image/jpeg", system: "SYSTEM_INST", user: "USER_PROMPT" },
        cfg
      )
    ).rejects.toThrow(ProviderError);
  });

  it("throws ProviderAuthError on 401 status", async () => {
    const error = new Error("Auth failed");
    (error as any).status = 401;
    generateContentMock.mockRejectedValueOnce(error);

    await expect(
      callGemini(
        { imageB64: "b64img", mime: "image/jpeg", system: "SYSTEM_INST", user: "USER_PROMPT" },
        cfg
      )
    ).rejects.toThrow(ProviderAuthError);
  });

  it("throws ProviderAuthError on 403 status", async () => {
    const error = new Error("Forbidden");
    (error as any).status = 403;
    generateContentMock.mockRejectedValueOnce(error);

    await expect(
      callGemini(
        { imageB64: "b64img", mime: "image/jpeg", system: "SYSTEM_INST", user: "USER_PROMPT" },
        cfg
      )
    ).rejects.toThrow(ProviderAuthError);
  });

  it("throws ProviderRateLimitError on 429 status", async () => {
    const error = new Error("Rate limit exceeded");
    (error as any).status = 429;
    generateContentMock.mockRejectedValueOnce(error);

    await expect(
      callGemini(
        { imageB64: "b64img", mime: "image/jpeg", system: "SYSTEM_INST", user: "USER_PROMPT" },
        cfg
      )
    ).rejects.toThrow(ProviderRateLimitError);
  });

  it("throws generic ProviderError on other API errors", async () => {
    const error = new Error("Internal Server Error");
    (error as any).status = 500;
    generateContentMock.mockRejectedValueOnce(error);

    await expect(
      callGemini(
        { imageB64: "b64img", mime: "image/jpeg", system: "SYSTEM_INST", user: "USER_PROMPT" },
        cfg
      )
    ).rejects.toThrow(ProviderError);
  });
});
