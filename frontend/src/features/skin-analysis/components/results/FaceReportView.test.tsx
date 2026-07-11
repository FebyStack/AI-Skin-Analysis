import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FaceReportView } from "./FaceReportView";
import { goldenFaceReport } from "../../../../../../shared/testing/face-fixtures";

describe("FaceReportView", () => {
    it("renders overall score, all dimensions, recommendations, disclaimer", () => {
        render(<FaceReportView report={goldenFaceReport()} />);

        expect(screen.getByText(/overall/i)).toBeInTheDocument();

        expect(screen.getAllByRole("listitem").length)
            .toBeGreaterThanOrEqual(11);

        expect(screen.getByText(/sunscreen/i))
            .toBeInTheDocument();

        expect(screen.getByText(/not a medical diagnosis/i))
            .toBeInTheDocument();
    });
});

describe("FaceReportView", () => {
    it("renders overall score, all dimensions, recommendations, disclaimer", () => {
        render(<FaceReportView report={goldenFaceReport()} />);

        expect(screen.getByText(/overall/i))
            .toBeInTheDocument();

        expect(screen.getAllByRole("listitem").length)
            .toBeGreaterThanOrEqual(11);

        expect(screen.getByText(/sunscreen/i))
            .toBeInTheDocument();

        expect(screen.getByText(/not a medical diagnosis/i))
            .toBeInTheDocument();
    });
});