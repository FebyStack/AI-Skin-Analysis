import type { FaceReport, FaceDimension } from "@shared/face";
import { FACE_DIMENSIONS } from "@shared/face";

interface Props {
    report: FaceReport;
}

export function FaceReportView({ report }: Props) {
    return (
        <div className="max-w-5xl mx-auto px-4 space-y-6">

            {/* Overall */}
            <section className="rounded-xl border p-6">
                <h2 className="text-xl font-semibold">
                    Overall Skin Score
                </h2>

                <div className="mt-4 text-5xl font-bold">
                    {Math.round(report.overall.score * 100)}
                </div>

                <p className="text-sm text-gray-500 mt-2">
                    Confidence: {Math.round(report.overall.confidence * 100)}%
                </p>
            </section>


            {/* Dimensions */}
            <section>
                <h2 className="text-xl font-semibold mb-4">
                    Skin Dimensions
                </h2>

                <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {FACE_DIMENSIONS.map((dimension) => (
                        <DimensionCard
                            key={dimension}
                            name={dimension}
                            score={report.dimensions[dimension].score}
                            confidence={report.dimensions[dimension].confidence}
                        />
                    ))}
                </ul>
            </section>


            {/* Recommendations */}
            <section className="rounded-xl border p-6">
                <h2 className="text-xl font-semibold">
                    Recommendations
                </h2>

                <ul className="list-disc pl-5 mt-3 space-y-2">
                    {report.recommendations.skincare.map((item) => (
                        <li key={item}>
                            {item}
                        </li>
                    ))}
                </ul>

                {report.recommendations.treatments.length > 0 && (
                    <>
                        <h3 className="font-medium mt-5">
                            Professional options
                        </h3>

                        <ul className="list-disc pl-5 mt-2">
                            {report.recommendations.treatments.map((item) => (
                                <li key={item}>
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </section>


            {/* Disclaimer */}
            <section className="rounded-xl bg-gray-100 p-4 text-sm">
                {report.disclaimer}
            </section>

        </div>
    );
}


function DimensionCard({
    name,
    score,
    confidence,
}: {
    name: FaceDimension;
    score: number;
    confidence: number;
}) {
    return (
        <li className="border rounded-xl p-4">
            <h3 className="font-medium capitalize">
                {name}
            </h3>

            <div className="mt-3 h-2 bg-gray-200 rounded">
                <div
                    className="h-2 rounded bg-black"
                    style={{
                        width: `${score * 100}%`,
                    }}
                />
            </div>

            <p className="text-sm mt-2">
                Score: {Math.round(score * 100)}%
            </p>

            <p className="text-xs text-gray-500">
                Confidence: {Math.round(confidence * 100)}%
            </p>
        </li>
    );
}