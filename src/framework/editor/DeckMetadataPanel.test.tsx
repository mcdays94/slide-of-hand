/**
 * Component tests for `<DeckMetadataPanel>`. The panel is a controlled
 * component over `meta` + `onUpdateMeta`, so we drive it with a small
 * stateful wrapper and assert against the rendered DOM.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import type { DataDeckMeta } from "@/lib/deck-record";
import { DeckMetadataPanel } from "./DeckMetadataPanel";

afterEach(() => cleanup());

vi.mock("framer-motion", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passthrough = (tag: string) =>
    function Stub({ children, ...rest }: any) {
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        variants: _v,
        whileHover: _wh,
        whileTap: _wt,
        layout: _l,
        ...html
      } = rest;
      const Tag = tag as any;
      return <Tag {...html}>{children}</Tag>;
    };
  return {
    motion: new Proxy(
      {},
      { get: (_t, prop: string) => passthrough(prop as string) },
    ),
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

function sampleMeta(): DataDeckMeta {
  return {
    slug: "hello",
    title: "Hello",
    date: "2026-05-01",
    visibility: "private",
    description: "A demo deck.",
    author: "Test Author",
    runtimeMinutes: 20,
  };
}

interface HarnessProps {
  initial: DataDeckMeta;
  open?: boolean;
  onClose?: () => void;
  onChangeMeta?: (m: DataDeckMeta) => void;
}

function Harness({
  initial,
  open = true,
  onClose = () => {},
  onChangeMeta,
}: HarnessProps) {
  const [meta, setMeta] = useState(initial);
  return (
    <DeckMetadataPanel
      open={open}
      meta={meta}
      onClose={onClose}
      onUpdateMeta={(updater) => {
        setMeta((curr) => {
          const next = updater(curr);
          onChangeMeta?.(next);
          return next;
        });
      }}
    />
  );
}

describe("<DeckMetadataPanel>", () => {
  it("renders nothing when open=false", () => {
    render(<Harness initial={sampleMeta()} open={false} />);
    expect(screen.queryByTestId("deck-meta-panel")).toBeNull();
  });

  it("renders the panel when open=true", () => {
    render(<Harness initial={sampleMeta()} />);
    expect(screen.getByTestId("deck-meta-panel")).toBeDefined();
  });

  it("shows the current title in the title input", () => {
    render(<Harness initial={sampleMeta()} />);
    const input = screen.getByTestId("deck-meta-title") as HTMLInputElement;
    expect(input.value).toBe("Hello");
  });

  it("typing in the title field updates the draft via onUpdateMeta", () => {
    const onChange = vi.fn();
    render(<Harness initial={sampleMeta()} onChangeMeta={onChange} />);
    const input = screen.getByTestId("deck-meta-title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    expect(input.value).toBe("Renamed");
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect((lastCall[0] as DataDeckMeta).title).toBe("Renamed");
  });

  it("shows description, author, event, cover, runtime as controlled inputs", () => {
    render(<Harness initial={sampleMeta()} />);
    expect(
      (screen.getByTestId("deck-meta-description") as HTMLTextAreaElement)
        .value,
    ).toBe("A demo deck.");
    expect(
      (screen.getByTestId("deck-meta-author") as HTMLInputElement).value,
    ).toBe("Test Author");
    expect(
      (screen.getByTestId("deck-meta-runtime") as HTMLInputElement).value,
    ).toBe("20");
    // Empty optional fields render as empty strings.
    expect(
      (screen.getByTestId("deck-meta-event") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("deck-meta-cover") as HTMLInputElement).value,
    ).toBe("");
  });

  it("clearing an optional field removes it from meta (does NOT keep empty string)", () => {
    let last: DataDeckMeta | undefined;
    render(
      <Harness
        initial={sampleMeta()}
        onChangeMeta={(m) => {
          last = m;
        }}
      />,
    );
    const author = screen.getByTestId("deck-meta-author") as HTMLInputElement;
    fireEvent.change(author, { target: { value: "" } });
    expect(last?.author).toBeUndefined();
  });

  it("setting an optional field stores the trimmed value", () => {
    let last: DataDeckMeta | undefined;
    render(
      <Harness
        initial={sampleMeta()}
        onChangeMeta={(m) => {
          last = m;
        }}
      />,
    );
    const event = screen.getByTestId("deck-meta-event") as HTMLInputElement;
    fireEvent.change(event, { target: { value: "DTX Manchester 2026" } });
    expect(last?.event).toBe("DTX Manchester 2026");
  });

  it("the visibility radio reflects the current value", () => {
    render(<Harness initial={sampleMeta()} />);
    const priv = screen.getByTestId(
      "deck-meta-visibility-private",
    ) as HTMLInputElement;
    const pub = screen.getByTestId(
      "deck-meta-visibility-public",
    ) as HTMLInputElement;
    expect(priv.checked).toBe(true);
    expect(pub.checked).toBe(false);
  });

  it("clicking the public radio updates meta.visibility", () => {
    let last: DataDeckMeta | undefined;
    render(
      <Harness
        initial={sampleMeta()}
        onChangeMeta={(m) => {
          last = m;
        }}
      />,
    );
    const pub = screen.getByTestId(
      "deck-meta-visibility-public",
    ) as HTMLInputElement;
    fireEvent.click(pub);
    expect(last?.visibility).toBe("public");
  });

  it("clearing runtimeMinutes removes the field from meta", () => {
    let last: DataDeckMeta | undefined;
    render(
      <Harness
        initial={sampleMeta()}
        onChangeMeta={(m) => {
          last = m;
        }}
      />,
    );
    const runtime = screen.getByTestId(
      "deck-meta-runtime",
    ) as HTMLInputElement;
    fireEvent.change(runtime, { target: { value: "" } });
    expect(last?.runtimeMinutes).toBeUndefined();
  });

  it("setting runtimeMinutes coerces to a positive integer", () => {
    let last: DataDeckMeta | undefined;
    render(
      <Harness
        initial={sampleMeta()}
        onChangeMeta={(m) => {
          last = m;
        }}
      />,
    );
    const runtime = screen.getByTestId(
      "deck-meta-runtime",
    ) as HTMLInputElement;
    fireEvent.change(runtime, { target: { value: "45" } });
    expect(last?.runtimeMinutes).toBe(45);
  });

  it("Close button calls onClose", () => {
    const onClose = vi.fn();
    render(<Harness initial={sampleMeta()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("deck-meta-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc key calls onClose", () => {
    const onClose = vi.fn();
    render(<Harness initial={sampleMeta()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("the panel is non-modal — the backdrop wrapper does not trap pointer events", () => {
    // The panel is a docked sidebar, not a modal — we want users to
    // keep clicking Save / Reset / the filmstrip with the panel open.
    render(<Harness initial={sampleMeta()} />);
    const backdrop = screen.getByTestId("deck-meta-backdrop");
    expect(backdrop.className).toContain("pointer-events-none");
    const panel = screen.getByTestId("deck-meta-panel");
    expect(panel.className).toContain("pointer-events-auto");
  });

  it("clicking inside the panel does NOT call onClose", () => {
    const onClose = vi.fn();
    render(<Harness initial={sampleMeta()} onClose={onClose} />);
    const panel = screen.getByTestId("deck-meta-panel");
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });
});
