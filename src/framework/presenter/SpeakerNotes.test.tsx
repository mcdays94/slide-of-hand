/**
 * `<SpeakerNotes>` tests — body rendering + font-size knob + persistence.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NOTES_FONT_SIZE_KEY, SpeakerNotes } from "./SpeakerNotes";

describe("<SpeakerNotes>", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => cleanup());

  it("renders the notes content", () => {
    render(<SpeakerNotes notes={<p>Hello world</p>} />);
    expect(screen.getByTestId("speaker-notes-body").textContent).toContain(
      "Hello world",
    );
  });

  it("falls back to a placeholder when notes are missing", () => {
    render(<SpeakerNotes />);
    expect(screen.getByTestId("speaker-notes-body").textContent).toContain(
      "No notes for this slide.",
    );
  });

  it("renders an orange kicker", () => {
    render(<SpeakerNotes />);
    expect(
      screen.getByTestId("speaker-notes-kicker").className,
    ).toContain("text-cf-orange");
  });

  it("starts at the default 16px when no value is persisted", () => {
    render(<SpeakerNotes />);
    expect(
      screen.getByTestId("speaker-notes-fontsize-value").textContent,
    ).toBe("16");
  });

  it("hydrates from localStorage when a valid value exists", () => {
    window.localStorage.setItem(NOTES_FONT_SIZE_KEY, "20");
    render(<SpeakerNotes />);
    expect(
      screen.getByTestId("speaker-notes-fontsize-value").textContent,
    ).toBe("20");
  });

  it("ignores out-of-range persisted values", () => {
    window.localStorage.setItem(NOTES_FONT_SIZE_KEY, "999");
    render(<SpeakerNotes />);
    expect(
      screen.getByTestId("speaker-notes-fontsize-value").textContent,
    ).toBe("16");
  });

  it("increases font size up to 22, then disables the +", () => {
    render(<SpeakerNotes />);
    const inc = screen.getByTestId("speaker-notes-fontsize-increase");
    fireEvent.click(inc); // 18
    fireEvent.click(inc); // 20
    fireEvent.click(inc); // 22
    expect(
      screen.getByTestId("speaker-notes-fontsize-value").textContent,
    ).toBe("22");
    expect(inc.getAttribute("disabled")).not.toBeNull();
  });

  it("decreases font size down to 12, then disables the -", () => {
    render(<SpeakerNotes />);
    const dec = screen.getByTestId("speaker-notes-fontsize-decrease");
    fireEvent.click(dec); // 14
    fireEvent.click(dec); // 12
    expect(
      screen.getByTestId("speaker-notes-fontsize-value").textContent,
    ).toBe("12");
    expect(dec.getAttribute("disabled")).not.toBeNull();
  });

  it("persists changed font size to localStorage", () => {
    render(<SpeakerNotes />);
    fireEvent.click(screen.getByTestId("speaker-notes-fontsize-increase"));
    expect(window.localStorage.getItem(NOTES_FONT_SIZE_KEY)).toBe("18");
  });

  it("applies a Tailwind utility class for the chosen size (no inline style)", () => {
    render(<SpeakerNotes />);
    fireEvent.click(screen.getByTestId("speaker-notes-fontsize-increase"));
    const body = screen.getByTestId("speaker-notes-body");
    expect(body.className).toContain("text-[18px]");
    // Ensure the body element does NOT carry an inline fontSize style.
    expect(body.getAttribute("style") ?? "").not.toContain("font-size");
  });
});
