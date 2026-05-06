/**
 * Tests for `useResizable` — a small panel-resize hook ported from
 * cf-slides and adapted to Slide of Hand's localStorage namespace.
 *
 * The hook persists the latest width under `slide-of-hand-presenter-resize:<key>`,
 * clamps to `[minWidth, maxWidth]`, and exposes a single `onMouseDown`
 * function that starts a drag that listens for `mousemove` / `mouseup`
 * on `window`. Direction can be 1 (right edge — width grows when mouse
 * moves right) or -1 (left edge — width grows when mouse moves left).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useResizable } from "./useResizable";

const STORAGE_KEY = "slide-of-hand-presenter-resize:notes";

describe("useResizable", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => cleanup());

  it("returns the default width when storage is empty", () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );
    expect(result.current.width).toBe(300);
  });

  it("hydrates from localStorage when a valid value exists", () => {
    window.localStorage.setItem(STORAGE_KEY, "420");
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );
    expect(result.current.width).toBe(420);
  });

  it("ignores out-of-bounds persisted values", () => {
    window.localStorage.setItem(STORAGE_KEY, "9999");
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );
    expect(result.current.width).toBe(300);
  });

  it("ignores non-numeric persisted values", () => {
    window.localStorage.setItem(STORAGE_KEY, "abc");
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );
    expect(result.current.width).toBe(300);
  });

  it("scopes per storageKey", () => {
    window.localStorage.setItem(
      "slide-of-hand-presenter-resize:other",
      "250",
    );
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );
    expect(result.current.width).toBe(300);
  });

  it("updates width on mouse drag with direction=1 (right edge)", () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );

    // Start drag at clientX=500, default width 300, direction=1
    act(() => {
      const fakeEvent = {
        clientX: 500,
        preventDefault: () => undefined,
      } as unknown as React.MouseEvent;
      result.current.onMouseDown(fakeEvent, 1);
    });

    // Move mouse 50px to the right -> width should grow by 50.
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 550 }));
    });
    expect(result.current.width).toBe(350);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  it("updates width on mouse drag with direction=-1 (left edge)", () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );

    act(() => {
      const fakeEvent = {
        clientX: 500,
        preventDefault: () => undefined,
      } as unknown as React.MouseEvent;
      result.current.onMouseDown(fakeEvent, -1);
    });

    // Mouse moves 100px to the LEFT — for a left-edge handle, that grows
    // the panel to the right of the handle: width += 100.
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }));
    });
    expect(result.current.width).toBe(400);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  it("clamps width to minWidth when dragging undersized", () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );

    act(() => {
      const e = {
        clientX: 500,
        preventDefault: () => undefined,
      } as unknown as React.MouseEvent;
      result.current.onMouseDown(e, 1);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 0 }));
    });
    expect(result.current.width).toBe(200);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  it("clamps width to maxWidth when dragging oversize", () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );

    act(() => {
      const e = {
        clientX: 500,
        preventDefault: () => undefined,
      } as unknown as React.MouseEvent;
      result.current.onMouseDown(e, 1);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 9999 }));
    });
    expect(result.current.width).toBe(600);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  it("ignores mousemove without an active drag", () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1000 }));
    });
    expect(result.current.width).toBe(300);
  });

  it("persists the final width to localStorage on mouseup", () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );

    act(() => {
      const e = {
        clientX: 500,
        preventDefault: () => undefined,
      } as unknown as React.MouseEvent;
      result.current.onMouseDown(e, 1);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 540 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("340");
  });

  it("removes window listeners on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useResizable({
        storageKey: "notes",
        defaultWidth: 300,
        minWidth: 200,
        maxWidth: 600,
      }),
    );

    act(() => {
      const e = {
        clientX: 500,
        preventDefault: () => undefined,
      } as unknown as React.MouseEvent;
      result.current.onMouseDown(e, 1);
    });

    unmount();

    // After unmount, mousemove should not throw nor (since hook detached)
    // mutate any state we can observe. If the listener leaked, dispatching
    // would still try to setState on an unmounted hook (vitest would warn).
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1000 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });
});
