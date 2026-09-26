import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeviceNamePanel } from "./DeviceNamePanel";
import { DEVICE_NAME_KEY } from "../capture/capture-info";

describe("DeviceNamePanel", () => {
  beforeEach(() => localStorage.removeItem(DEVICE_NAME_KEY));

  it("saves a trimmed device name to this browser", () => {
    render(<DeviceNamePanel />);
    expect(screen.getByText("Not named yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Device name"), { target: { value: "  Clinic iPad 1  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(localStorage.getItem(DEVICE_NAME_KEY)).toBe("Clinic iPad 1");
    expect(screen.getByRole("status").textContent).toContain('tagged "Clinic iPad 1"');
  });

  it("shows the saved name and disables Save until it changes", () => {
    localStorage.setItem(DEVICE_NAME_KEY, "Front desk iPhone");
    render(<DeviceNamePanel />);
    expect((screen.getByLabelText("Device name") as HTMLInputElement).value).toBe("Front desk iPhone");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
