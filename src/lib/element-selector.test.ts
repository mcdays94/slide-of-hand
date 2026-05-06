/**
 * Tests for the element-selector module. Uses happy-dom (declared in
 * `vite.config.ts` test environment) for a real `Element` /
 * `document.querySelector` runtime.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeSelector,
  fingerprint,
  findBySelector,
} from "./element-selector";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  root.setAttribute("data-slide-root", "");
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

/** Build a small DOM tree for round-trip tests. */
function buildSampleTree(): {
  heading: HTMLElement;
  para: HTMLElement;
  span: HTMLElement;
  span2: HTMLElement;
} {
  root.innerHTML = `
    <section class="cover">
      <h1 class="text-cf-text">Title</h1>
      <p class="text-cf-text-muted">First <span>inline</span> and <span>second</span></p>
    </section>
  `.trim();
  const heading = root.querySelector("h1") as HTMLElement;
  const para = root.querySelector("p") as HTMLElement;
  const spans = root.querySelectorAll("span");
  return {
    heading,
    para,
    span: spans[0] as HTMLElement,
    span2: spans[1] as HTMLElement,
  };
}

describe("computeSelector", () => {
  it("returns ':scope' when el === slideRoot", () => {
    expect(computeSelector(root, root)).toBe(":scope");
  });

  it("computes a single-step selector for a direct child", () => {
    const child = document.createElement("h1");
    root.appendChild(child);
    expect(computeSelector(child, root)).toBe("h1:nth-child(1)");
  });

  it("computes a multi-step selector that walks up to slideRoot", () => {
    const { heading } = buildSampleTree();
    const sel = computeSelector(heading, root);
    expect(sel).toBe("section:nth-child(1) > h1:nth-child(1)");
  });

  it("uses 1-based :nth-child indices counting element siblings only", () => {
    const { span2 } = buildSampleTree();
    const sel = computeSelector(span2, root);
    // <p> is the 2nd ELEMENT child of <section> (CSS :nth-child counts
    // element siblings, not text nodes), and the second <span> is the
    // 2nd element child of the <p>.
    expect(sel).toBe(
      "section:nth-child(1) > p:nth-child(2) > span:nth-child(2)",
    );
  });

  it("throws when el is not a descendant of slideRoot", () => {
    const orphan = document.createElement("div");
    expect(() => computeSelector(orphan, root)).toThrow(
      /not a descendant/i,
    );
  });

  it("ignores className mutations (selector is structural)", () => {
    const { heading } = buildSampleTree();
    const before = computeSelector(heading, root);
    heading.className = "totally-different-classes";
    const after = computeSelector(heading, root);
    expect(after).toBe(before);
  });
});

describe("fingerprint", () => {
  it("returns lowercase tag + first 80 chars of textContent", () => {
    const el = document.createElement("H2");
    el.textContent = "Hello, world";
    expect(fingerprint(el)).toEqual({ tag: "h2", text: "Hello, world" });
  });

  it("truncates textContent at 80 characters", () => {
    const el = document.createElement("p");
    el.textContent = "x".repeat(200);
    const fp = fingerprint(el);
    expect(fp.text.length).toBe(80);
    expect(fp.text).toBe("x".repeat(80));
  });

  it("handles elements with empty text", () => {
    const el = document.createElement("br");
    expect(fingerprint(el)).toEqual({ tag: "br", text: "" });
  });

  it("preserves leading/trailing whitespace verbatim (no trimming)", () => {
    const el = document.createElement("span");
    el.textContent = "   spaced   ";
    expect(fingerprint(el).text).toBe("   spaced   ");
  });
});

describe("findBySelector", () => {
  it("round-trips: returns 'matched' for the same element", () => {
    const { heading } = buildSampleTree();
    const sel = computeSelector(heading, root);
    const fp = fingerprint(heading);
    const result = findBySelector(root, sel, fp);
    expect(result.status).toBe("matched");
    expect(result.el).toBe(heading);
  });

  it("returns ':scope' selector to slideRoot itself", () => {
    const fp = fingerprint(root);
    const result = findBySelector(root, ":scope", fp);
    expect(result.status).toBe("matched");
    expect(result.el).toBe(root);
  });

  it("returns 'orphaned' when the selector resolves but text differs", () => {
    const { heading } = buildSampleTree();
    const sel = computeSelector(heading, root);
    const fp = fingerprint(heading); // captured BEFORE mutation
    heading.textContent = "Completely different heading";
    const result = findBySelector(root, sel, fp);
    expect(result.status).toBe("orphaned");
    expect(result.el).toBe(heading);
  });

  it("returns 'missing' when the selector no longer resolves", () => {
    const { heading } = buildSampleTree();
    const sel = computeSelector(heading, root);
    const fp = fingerprint(heading);
    // Wipe the subtree so the selector resolves to nothing.
    root.innerHTML = "";
    const result = findBySelector(root, sel, fp);
    expect(result.status).toBe("missing");
    expect(result.el).toBeNull();
  });

  it("returns 'missing' for a malformed selector (defensive)", () => {
    const fp = { tag: "p", text: "" };
    const result = findBySelector(root, "((( not valid", fp);
    expect(result.status).toBe("missing");
    expect(result.el).toBeNull();
  });

  it("survives className mutations between capture and lookup", () => {
    const { heading, para } = buildSampleTree();
    const sel = computeSelector(para, root);
    const fp = fingerprint(para);
    // The inspector's whole job is to mutate classes — make sure that
    // doesn't break re-resolution.
    heading.className = "swapped-1";
    para.className = "swapped-2";
    const result = findBySelector(root, sel, fp);
    expect(result.status).toBe("matched");
    expect(result.el).toBe(para);
  });

  it("returns 'orphaned' when the same structural position now hosts different content", () => {
    const { para } = buildSampleTree();
    const sel = computeSelector(para, root);
    const fp = fingerprint(para);
    // Replace the <p> with another <p> in the same position with new
    // text. Selector still resolves but content shifted.
    const replacement = document.createElement("p");
    replacement.textContent = "Replaced paragraph contents entirely";
    para.replaceWith(replacement);
    const result = findBySelector(root, sel, fp);
    expect(result.status).toBe("orphaned");
    expect(result.el).toBe(replacement);
  });

  it("produces a stable selector when the same JSX-like DOM is rebuilt", () => {
    // First render
    const { heading: h1 } = buildSampleTree();
    const sel1 = computeSelector(h1, root);

    // Second "render" — wipe and rebuild identical structure
    root.innerHTML = "";
    const { heading: h2 } = buildSampleTree();
    const sel2 = computeSelector(h2, root);

    expect(sel1).toBe(sel2);
    // And the new selector still resolves on the new tree.
    const result = findBySelector(root, sel2, fingerprint(h2));
    expect(result.status).toBe("matched");
    expect(result.el).toBe(h2);
  });
});
