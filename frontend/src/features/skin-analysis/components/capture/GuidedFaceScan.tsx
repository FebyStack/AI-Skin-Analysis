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
            <div
                className="
          aspect-[3/4]
          max-h-[60vh]
          w-full
          rounded-3xl
          border
          flex
          items-center
          justify-center
        "
            >
                <span>
                    Camera preview
                </span>
            </div>


            {/* Progress */}
            <div>
                Step {scan.stepIndex + 1} of {scan.totalSteps}
            </div>


            {/* Guidance — doubles as the retake message when a capture fails */}
            <p
                aria-live="polite"
                className={hasIssue ? "rounded-lg bg-amber-50 px-4 py-2 text-amber-900 text-center" : "text-center"}
            >
                {scan.instruction}
            </p>


            <button
                className="min-h-[44px] px-6 rounded-lg"
                disabled={scan.busy || scan.done}
                onClick={scan.captureCurrent}
            >
                Capture
            </button>

        </div>
    );
}