import { describe, it, expect } from "vitest";
import { platformFromUA } from "./capture-info";

describe("platformFromUA", () => {
  it("reads iPhone iOS version", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
    expect(platformFromUA(ua, 5)).toBe("iPhone iOS 17.5");
  });
  it("tells iPadOS (Mac UA + touch) from a real Mac", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15";
    expect(platformFromUA(ua, 5)).toBe("iPad iPadOS 17.4");
    expect(platformFromUA(ua, 0)).toBe("Mac");
  });
  it("keeps the Android model but drops Chrome's reduced 'K' placeholder", () => {
    expect(platformFromUA("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile", 5)).toBe("Android 14 Pixel 8");
    expect(platformFromUA("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/120 Mobile", 5)).toBe("Android 10");
  });
});
