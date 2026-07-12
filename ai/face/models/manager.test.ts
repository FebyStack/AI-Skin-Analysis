import { describe, it, expect } from "vitest";
import { ModelManager, MockClassifier, type ModelDescriptor } from "./manager";

const desc = (over: Partial<ModelDescriptor> = {}): ModelDescriptor => ({
    name: "face-landmarker", version: "1.0.0", task: "landmarks", framework: "mediapipe",
    files: [{ path: "face_landmarker.task", sha256: "abc", bytes: 1 }],
    createdAt: "2026-07-10", ...over,
});

describe("ModelManager", () => {
    it("activates a descriptor via its framework loader and reports versions", async () => {
        const mm = new ModelManager();
        mm.registerLoader("mediapipe", async (d) => ({ loaded: d.name }));
        await mm.activate(desc());
        expect(mm.get("face-landmarker")).toEqual({ loaded: "face-landmarker" });
        expect(mm.versions()).toEqual({ "face-landmarker": "1.0.0" });
    });
    it("rejects activation without a registered loader", async () => {
        const mm = new ModelManager();
        await expect(mm.activate(desc({ framework: "onnx" }))).rejects.toThrow(/loader/i);
    });
    it("re-activation replaces the version atomically", async () => {
        const mm = new ModelManager();
        mm.registerLoader("mediapipe", async (d) => d.version);
        await mm.activate(desc());
        await mm.activate(desc({ version: "1.1.0" }));
        expect(mm.versions()["face-landmarker"]).toBe("1.1.0");
    });
});

describe("MockClassifier", () => {
    it("is deterministic and honest about being a mock", async () => {
        const c = new MockClassifier(["A", "B"]);
        const r1 = await c.classify({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        const r2 = await c.classify({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        expect(r1).toEqual(r2);
        expect(r1.model.name).toMatch(/mock/i);
        expect(r1.top[0].confidence).toBeLessThanOrEqual(1);
    });
});