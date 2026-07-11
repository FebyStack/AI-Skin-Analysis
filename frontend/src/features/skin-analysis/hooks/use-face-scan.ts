import { useCallback, useMemo, useState } from "react";
import type { FaceAngle, FaceReport } from "@shared/face";
import { createSequence, instructionFor } from "@ai/face/guidance/sequence";
import { buildFaceReport } from "@ai/face/pipeline";
import type { AnalyzedView } from "@ai/face/types";

export interface FaceScanDeps {
    /** Grab + analyze the current camera frame for the requested angle (real impl wires
     *  video → pixels + detectGeometry → analyzeView). Injected for tests. */
    analyzeFrame: (angle: FaceAngle) => Promise<AnalyzedView>;
    modelVersions?: Record<string, string>;
}

export function useFaceScan({ analyzeFrame, modelVersions = { "face-landmarker": "v1" } }: FaceScanDeps) {
    const [seq, setSeq] = useState(() => createSequence());
    const [views, setViews] = useState<AnalyzedView[]>([]);
    const [report, setReport] = useState<FaceReport | null>(null);
    const [busy, setBusy] = useState(false);

    const captureCurrent = useCallback(async () => {
        if (seq.done || busy) return;
        setBusy(true);
        try {
            const view = await analyzeFrame(seq.current);
            const next = seq.accept(view.quality);
            setSeq(next);
            if (view.quality.ok) {
                const all = [...views, view];
                setViews(all);
                if (next.done) setReport(buildFaceReport(all, modelVersions));
            }
        } finally {
            setBusy(false);
        }
    }, [seq, views, busy, analyzeFrame, modelVersions]);

    const instruction = useMemo(
        () => instructionFor(seq.current, seq.lastIssues[0]),
        [seq],
    );

    return {
        currentAngle: seq.current, stepIndex: seq.index, totalSteps: 5,
        done: seq.done, instruction, lastIssues: seq.lastIssues,
        busy, report, captureCurrent,
        reset: () => { setSeq(createSequence()); setViews([]); setReport(null); },
    };
}