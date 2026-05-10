import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeBox } from "./CodeBox";

afterEach(() => cleanup());
import type { Snippet } from "../../lib/snippets";

const SNIPPETS: Snippet[] = [
  {
    id: "compute",
    label: "Pure compute",
    description: "compute description",
    code: "// compute snippet code",
    parentCode: "// compute parent worker",
  },
  {
    id: "fetch",
    label: "Fetch the world",
    description: "fetch description",
    code: "// fetch snippet code",
    parentCode: "// fetch parent worker",
  },
];

describe("CodeBox", () => {
  it("renders the active snippet's label, description, parent code, and spawned code preview", () => {
    render(
      <CodeBox
        snippets={SNIPPETS}
        active="compute"
        onTabChange={vi.fn()}
        onSpawn={vi.fn()}
        status="idle"
      />,
    );
    expect(screen.getByText("compute description")).toBeInTheDocument();
    expect(screen.getByTestId("parent-code-preview")).toHaveTextContent(
      "// compute parent worker",
    );
    expect(screen.getByTestId("code-preview")).toHaveTextContent(
      "// compute snippet code",
    );
  });

  it("swaps both parent and spawned code when the active snippet changes", () => {
    const { rerender } = render(
      <CodeBox
        snippets={SNIPPETS}
        active="compute"
        onTabChange={vi.fn()}
        onSpawn={vi.fn()}
        status="idle"
      />,
    );
    expect(screen.getByTestId("parent-code-preview")).toHaveTextContent(
      "// compute parent worker",
    );

    rerender(
      <CodeBox
        snippets={SNIPPETS}
        active="fetch"
        onTabChange={vi.fn()}
        onSpawn={vi.fn()}
        status="idle"
      />,
    );

    expect(screen.getByTestId("parent-code-preview")).toHaveTextContent(
      "// fetch parent worker",
    );
    expect(screen.getByTestId("code-preview")).toHaveTextContent(
      "// fetch snippet code",
    );
  });

  it("calls onTabChange when a tab is clicked", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CodeBox
        snippets={SNIPPETS}
        active="compute"
        onTabChange={onTabChange}
        onSpawn={vi.fn()}
        status="idle"
      />,
    );
    await user.click(screen.getByTestId("tab-fetch"));
    expect(onTabChange).toHaveBeenCalledWith("fetch");
  });

  it("disables tab buttons while loading", () => {
    render(
      <CodeBox
        snippets={SNIPPETS}
        active="compute"
        onTabChange={vi.fn()}
        onSpawn={vi.fn()}
        status="loading"
      />,
    );
    expect(screen.getByTestId("tab-fetch")).toBeDisabled();
    expect(screen.getByTestId("spawn-button")).toBeDisabled();
    expect(screen.getByTestId("spawn-button")).toHaveTextContent(/spawning/i);
  });

  it("calls onSpawn with undefined when the canonical snippet is used", async () => {
    const onSpawn = vi.fn();
    const user = userEvent.setup();
    render(
      <CodeBox
        snippets={SNIPPETS}
        active="compute"
        onTabChange={vi.fn()}
        onSpawn={onSpawn}
        status="idle"
      />,
    );
    await user.click(screen.getByTestId("spawn-button"));
    expect(onSpawn).toHaveBeenCalledWith(undefined);
  });

  it("toggles to edit mode and passes the edited code on spawn", async () => {
    const onSpawn = vi.fn();
    const user = userEvent.setup();
    render(
      <CodeBox
        snippets={SNIPPETS}
        active="compute"
        onTabChange={vi.fn()}
        onSpawn={onSpawn}
        status="idle"
      />,
    );
    await user.click(screen.getByTestId("edit-toggle"));
    const editor = screen.getByTestId("code-editor") as HTMLTextAreaElement;
    expect(editor).toBeInTheDocument();
    expect(editor.value).toContain("compute snippet code");

    await user.clear(editor);
    await user.type(editor, "// edited body");
    await user.click(screen.getByTestId("spawn-button"));
    expect(onSpawn).toHaveBeenLastCalledWith("// edited body");
  });

  it("shows a retry button and error text in failed state", async () => {
    const onSpawn = vi.fn();
    const user = userEvent.setup();
    render(
      <CodeBox
        snippets={SNIPPETS}
        active="compute"
        onTabChange={vi.fn()}
        onSpawn={onSpawn}
        status="failed"
        errorMessage="Boom: bind error"
      />,
    );
    expect(screen.getByTestId("error-text")).toHaveTextContent(
      "Boom: bind error",
    );
    await user.click(screen.getByTestId("retry-button"));
    expect(onSpawn).toHaveBeenCalledTimes(1);
  });

  it("resets edit mode and edited code when the active snippet changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CodeBox
        snippets={SNIPPETS}
        active="compute"
        onTabChange={vi.fn()}
        onSpawn={vi.fn()}
        status="idle"
      />,
    );
    await user.click(screen.getByTestId("edit-toggle"));
    expect(screen.getByTestId("code-editor")).toBeInTheDocument();

    rerender(
      <CodeBox
        snippets={SNIPPETS}
        active="fetch"
        onTabChange={vi.fn()}
        onSpawn={vi.fn()}
        status="idle"
      />,
    );

    // Edit mode should reset; the canonical fetch snippet preview should be visible.
    expect(screen.queryByTestId("code-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("code-preview")).toHaveTextContent(
      "// fetch snippet code",
    );
  });
});
