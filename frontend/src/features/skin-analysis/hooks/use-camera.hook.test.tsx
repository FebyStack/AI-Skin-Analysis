import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCamera } from "./use-camera";

function fakeStream() {
  const track = { stop: vi.fn() };
  return {
    stream: { getTracks: () => [track] } as unknown as MediaStream,
    track,
  };
}

describe("useCamera stream lifecycle", () => {
  let streams: ReturnType<typeof fakeStream>[];
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    streams = [];
    getUserMedia = vi.fn(async () => {
      const s = fakeStream();
      streams.push(s);
      return s.stream;
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
  });

  afterEach(() => {
    // @ts-expect-error cleanup test shim
    delete navigator.mediaDevices;
  });

  it("stops the previous stream when start() is called again", async () => {
    const { result } = renderHook(() => useCamera("face"));
    await act(() => result.current.start());
    await act(() => result.current.start());
    expect(streams).toHaveLength(2);
    expect(streams[0].track.stop).toHaveBeenCalled();
    expect(streams[1].track.stop).not.toHaveBeenCalled();
  });

  it("discards a stale in-flight stream when a newer start() wins", async () => {
    let release0!: (s: MediaStream) => void;
    let release1!: (s: MediaStream) => void;
    const s0 = fakeStream();
    const s1 = fakeStream();
    getUserMedia
      .mockImplementationOnce(() => new Promise((res) => (release0 = res)))
      .mockImplementationOnce(() => new Promise((res) => (release1 = res)));

    const { result } = renderHook(() => useCamera("face"));
    let p0!: Promise<void>;
    let p1!: Promise<void>;
    act(() => {
      p0 = result.current.start();
      p1 = result.current.start();
    });
    // Newer call resolves first…
    release1(s1.stream);
    await act(() => p1);
    // …then the stale one resolves late.
    release0(s0.stream);
    await act(() => p0);
    // The stale stream must be stopped immediately; the winner stays live.
    expect(s0.track.stop).toHaveBeenCalled();
    expect(s1.track.stop).not.toHaveBeenCalled();
    expect(result.current.status).toBe("live");
  });

  it("stops the live stream on unmount", async () => {
    const { result, unmount } = renderHook(() => useCamera("face"));
    await act(() => result.current.start());
    unmount();
    expect(streams[0].track.stop).toHaveBeenCalled();
  });
});
