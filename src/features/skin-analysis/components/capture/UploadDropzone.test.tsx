import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadDropzone } from "./UploadDropzone";

describe("UploadDropzone", () => {
  it("passes a selected image file to onFile", async () => {
    const onFile = vi.fn();
    render(<UploadDropzone onFile={onFile} />);
    const file = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/upload a photo/i) as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("ignores non-image files", async () => {
    const onFile = vi.fn();
    render(<UploadDropzone onFile={onFile} />);
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/upload a photo/i) as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(onFile).not.toHaveBeenCalled();
  });
});
