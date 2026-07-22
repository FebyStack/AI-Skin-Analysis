import { useEffect } from "react";
import { useFaceScan } from "../../hooks/use-face-scan";
import type { AnalyzedView } from "../../../../../../ai/face/types";
import type { FaceReport } from "../../../../../../shared/face";

interface GuidedFaceScanProps {
    analyzeFrame: (angle: AnalyzedView["angle"]) => Promise<AnalyzedView>;
    onComplete: (report: FaceReport) => void;
}

export function GuidedFaceScan({
    analyzeFrame,
    onComplete,
}: GuidedFaceScanProps) {
    const scan = useFaceScan({
        analyzeFrame,
    });

    useEffect(() => {
        if (scan.report) {
            onComplete(scan.report);
        }
    }, [scan.report, onComplete]);

    const hasIssue = scan.lastIssues.length > 0;

    return (
        <div className="flex flex-col items-center gap-4">

            {/* Camera frame placeholder */}
            <div className="flex aspect-[3/4] max-h-[60vh] w-full items-center justify-center rounded-3xl border border-hairline bg-surface text-ink-tertiary">
                <span>Camera preview</span>
            </div>


            {/* Progress */}
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gold">
                Step {scan.stepIndex + 1} of {scan.totalSteps}
            </div>


            {/* Guidance — doubles as the retake message when a capture fails */}
            <p
                aria-live="polite"
                className={hasIssue ? "rounded-xl border border-soon-edge bg-soon-surface px-4 py-2 text-center text-soon" : "text-center text-ink"}
            >
                {scan.instruction}
            </p>


            <button className="btn-primary px-6" disabled={scan.busy || scan.done} onClick={scan.captureCurrent}>
                Capture
            </button>

        </div>
    );
}