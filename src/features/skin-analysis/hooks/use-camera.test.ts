import { describe, it, expect } from "vitest";
import { cameraConstraints, isSecureContextForCamera } from "./use-camera";

describe("cameraConstraints", () => {
  it("uses the front camera for face mode", () => {
    expect(cameraConstraints("face").video).toMatchObject({ facingMode: "user" });
  });

  it("uses the rear camera for closeup mode", () => {
    expect(cameraConstraints("closeup").video).toMatchObject({
      facingMode: "environment",
    });
  });
});

describe("isSecureContextForCamera", () => {
  it("allows https", () => {
    expect(isSecureContextForCamera("https:", "example.com")).toBe(true);
  });

  it("allows localhost over http", () => {
    expect(isSecureContextForCamera("http:", "localhost")).toBe(true);
  });

  it("blocks http on a remote host", () => {
    expect(isSecureContextForCamera("http:", "example.com")).toBe(false);
  });
});
