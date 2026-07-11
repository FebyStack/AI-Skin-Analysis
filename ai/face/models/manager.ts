import type { Pixels } from "../types";

export interface ModelDescriptor {
    name: string;
    version: string;
    task: "landmarks" | "classification" | "dimension-scoring";
    framework: "mediapipe" | "onnx" | "mock" | "heuristic";
    files: { path: string; sha256: string; bytes: number }[];
    inputSpec?: { width: number; height: number; channels: number; normalize?: string };
    classes?: string[];
    metrics?: Record<string, number> | null;
    datasetManifestSha256?: string | null;
    createdAt?: string;
    notes?: string;
}

export type ModelLoader = (d: ModelDescriptor) => Promise<unknown>;

export class ModelManager {
    private loaders = new Map<string, ModelLoader>();
    private active = new Map<string, { descriptor: ModelDescriptor; handle: unknown }>();

    registerLoader(framework: ModelDescriptor["framework"], loader: ModelLoader): void {
        this.loaders.set(framework, loader);
    }
    async activate(descriptor: ModelDescriptor): Promise<void> {
        const loader = this.loaders.get(descriptor.framework);
        if (!loader) throw new Error(`no loader registered for framework "${descriptor.framework}"`);
        const handle = await loader(descriptor);   // load fully BEFORE switching (atomic)
        this.active.set(descriptor.name, { descriptor, handle });
    }
    get<T = unknown>(name: string): T | null {
        return (this.active.get(name)?.handle as T) ?? null;
    }
    descriptor(name: string): ModelDescriptor | null {
        return this.active.get(name)?.descriptor ?? null;
    }
    versions(): Record<string, string> {
        return Object.fromEntries([...this.active.values()].map((m) => [m.descriptor.name, m.descriptor.version]));
    }
}

// ---- Classification seam (future lesion module + learned analyzers) ----
export interface ClassificationOutput {
    top: { label: string; confidence: number }[];
    model: { name: string; version: string };
}
export interface Classifier {
    classify(pixels: Pixels): Promise<ClassificationOutput>;
}

/** Dev/test classifier — deterministic, no weights, no downloads. Replaces any "untrained dev model". */
export class MockClassifier implements Classifier {
    constructor(private labels: string[]) { }

    async classify(_pixels: Pixels): Promise<ClassificationOutput> {
        const top = this.labels.map((label, i) => ({
            label,
            confidence: Math.max(
                0.05,
                0.9 - i * 0.85 / Math.max(1, this.labels.length - 1),
            ),
        }));

        return {
            top,
            model: {
                name: "mock-classifier",
                version: "0.0.0",
            },
        };
    }
}

// Reserved (Phase D implements; interface fixed now so nothing refactors later):
export interface ModelUpdateService {
    sync(): Promise<Record<string, string>>;   // manifest → verified cache → activate; returns versions
    rollbackLocal(name: string): Promise<boolean>; // reactivate previous cached version
}
// Reserved (future): class OnnxClassifier implements Classifier — onnxruntime-web loader under framework "onnx".