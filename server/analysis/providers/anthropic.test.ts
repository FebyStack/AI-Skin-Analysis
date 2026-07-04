import { describe, it, expect, vi } from "vitest";
import { callClaude, ProviderAuthError, ProviderRateLimitError, ProviderError, extractJson } from "./anthropic";

const cfg = { apiKey: "sk-test", model: "claude-sonnet-5", maxTokens: 2048 };

function okResponse(text: string) {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 20 } }),
    { status: 200 },
  );
}

describe("callClaude", () => {
  it("sends the image and prompts, returns the text content", async () => {
    const fetchFn = vi.fn(async () => okResponse('{"hello":1}'));
    const out = await callClaude(
      { imageB64: "abc=", mime: "image/jpeg", system: "SYS", user: "USER" },
      cfg,
      fetchFn,
    );
    expect(out.text).toBe('{"hello":1}');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.system).toBe("SYS");
    expect(body.messages[0].content[0].source.data).toBe("abc=");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
  });

  it("throws ProviderAuthError on 401", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(
      callClaude({ imageB64: "a=", mime: "image/jpeg", system: "s", user: "u" }, cfg, fetchFn),
    ).rejects.toThrow(ProviderAuthError);
  });

  it("throws ProviderRateLimitError on 429", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(
      callClaude({ imageB64: "a=", mime: "image/jpeg", system: "s", user: "u" }, cfg, fetchFn),
    ).rejects.toThrow(ProviderRateLimitError);
  });

  it("throws ProviderError on other failures", async () => {
    const fetchFn = vi.fn(async () => new Response("oops", { status: 500 }));
    await expect(
      callClaude({ imageB64: "a=", mime: "image/jpeg", system: "s", user: "u" }, cfg, fetchFn),
    ).rejects.toThrow(ProviderError);
  });
});

describe("extractJson", () => {
  it("parses a raw JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON wrapped in markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("returns null for non-JSON", () => {
    expect(extractJson("sorry, I cannot")).toBeNull();
  });
});
