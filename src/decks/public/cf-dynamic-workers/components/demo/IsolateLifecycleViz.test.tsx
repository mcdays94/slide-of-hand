import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IsolateLifecycleViz } from "./IsolateLifecycleViz";

describe("IsolateLifecycleViz", () => {
  afterEach(() => cleanup());

  it("renders the awaiting-spawn label in idle state", () => {
    render(<IsolateLifecycleViz state="idle" counter={0} />);
    const pill = screen.getByTestId("lifecycle-status-pill");
    expect(pill).toHaveAttribute("data-state", "idle");
    expect(pill).toHaveTextContent("Awaiting spawn");
  });

  it("renders the loading label and elapsed pill in loading state", () => {
    render(
      <IsolateLifecycleViz
        state="loading"
        meta={{ id: "iso_abcdef" }}
        counter={1}
      />,
    );
    const pill = screen.getByTestId("lifecycle-status-pill");
    expect(pill).toHaveAttribute("data-state", "loading");
    expect(pill).toHaveTextContent(/Loading/i);
    expect(screen.getByTestId("isolate-id")).toHaveTextContent("iso_abcdef");
  });

  it("renders elapsed and memory pills in result state", () => {
    render(
      <IsolateLifecycleViz
        state="result"
        meta={{ id: "iso_xyz", elapsedMs: 42, memoryKb: 128 }}
        counter={3}
      />,
    );
    expect(screen.getByTestId("lifecycle-status-pill")).toHaveTextContent(
      "Result returned",
    );
    expect(screen.getByText("42 ms")).toBeInTheDocument();
    expect(screen.getByText("128 kB")).toBeInTheDocument();
  });

  it("surfaces the error message in failed state", () => {
    render(
      <IsolateLifecycleViz
        state="failed"
        meta={{ id: "iso_fail", errorMessage: "Boom: bind error" }}
        counter={1}
      />,
    );
    expect(screen.getByTestId("lifecycle-status-pill")).toHaveAttribute(
      "data-state",
      "failed",
    );
    expect(screen.getByText("Boom: bind error")).toBeInTheDocument();
  });

  it("renders the counter padded to three digits", () => {
    render(<IsolateLifecycleViz state="idle" counter={7} />);
    expect(screen.getByTestId("isolate-counter")).toHaveTextContent("007");
  });

  it("renders the recent-isolates ribbon in newest-first order", () => {
    render(
      <IsolateLifecycleViz
        state="result"
        counter={5}
        recentIds={["iso_aaa", "iso_bbb", "iso_ccc"]}
      />,
    );
    const ribbon = screen.getByTestId("recent-isolates");
    const items = ribbon.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[0]).toHaveTextContent("iso_aaa");
    expect(items[1]).toHaveTextContent("iso_bbb");
    expect(items[2]).toHaveTextContent("iso_ccc");
  });

  it("caps the recent-isolates ribbon at 5 entries", () => {
    render(
      <IsolateLifecycleViz
        state="result"
        counter={10}
        recentIds={["a", "b", "c", "d", "e", "f", "g"]}
      />,
    );
    const items = screen
      .getByTestId("recent-isolates")
      .querySelectorAll("li");
    expect(items.length).toBe(5);
  });

  it("renders an em dash when no isolate id is present", () => {
    render(<IsolateLifecycleViz state="idle" counter={0} />);
    expect(screen.getByTestId("isolate-id")).toHaveTextContent("—");
  });
});
