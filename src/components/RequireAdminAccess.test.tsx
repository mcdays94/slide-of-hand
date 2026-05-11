/**
 * Tests for `<RequireAdminAccess>` — the client-side admin route
 * guard added 2026-05-11 after a user reported reaching
 * `/admin/decks/<slug>` via homepage → Studio (client-side React
 * Router nav) without an Access SSO prompt.
 *
 * The guard is small but load-bearing: it's the only thing between
 * an unauthenticated visitor and the admin chrome on every in-app
 * navigation to `/admin/*`. Pin every state transition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const useAccessAuthMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/use-access-auth", () => ({
  useAccessAuth: useAccessAuthMock,
}));

import { RequireAdminAccess } from "./RequireAdminAccess";

beforeEach(() => {
  useAccessAuthMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("<RequireAdminAccess>", () => {
  it("renders children when the visitor is authenticated", () => {
    useAccessAuthMock.mockReturnValue("authenticated");
    render(
      <RequireAdminAccess>
        <div data-testid="protected-child">admin content</div>
      </RequireAdminAccess>,
    );
    expect(screen.getByTestId("protected-child")).toBeTruthy();
    expect(screen.queryByTestId("admin-auth-required")).toBeNull();
    expect(screen.queryByTestId("admin-auth-checking")).toBeNull();
  });

  it("renders the sign-in landing when the visitor is unauthenticated", () => {
    useAccessAuthMock.mockReturnValue("unauthenticated");
    render(
      <RequireAdminAccess>
        <div data-testid="protected-child">admin content</div>
      </RequireAdminAccess>,
    );
    // Children are NOT rendered — short-circuited by the gate.
    expect(screen.queryByTestId("protected-child")).toBeNull();
    // The landing IS rendered with its expected affordances.
    const landing = screen.getByTestId("admin-auth-required");
    expect(landing.getAttribute("role")).toBe("alert");
    expect(screen.getByText(/sign.?in required/i)).toBeTruthy();
    expect(screen.getByTestId("admin-auth-reload")).toBeTruthy();
    const home = screen.getByTestId("admin-auth-home") as HTMLAnchorElement;
    expect(home.getAttribute("href")).toBe("/");
  });

  it("renders the brief 'Checking session…' splash while the probe is in flight", () => {
    useAccessAuthMock.mockReturnValue("checking");
    render(
      <RequireAdminAccess>
        <div data-testid="protected-child">admin content</div>
      </RequireAdminAccess>,
    );
    expect(screen.getByTestId("admin-auth-checking")).toBeTruthy();
    // Neither the children nor the landing render in the checking state
    // — avoids flashing UI that would have to be swapped.
    expect(screen.queryByTestId("protected-child")).toBeNull();
    expect(screen.queryByTestId("admin-auth-required")).toBeNull();
  });

  it("does not mount children for unauthenticated visitors (defense in depth)", () => {
    // The point of the guard is to prevent children's effects from
    // firing — e.g. wasted KV fetches inside an admin deck route.
    // Pin that by rendering a child that throws on mount.
    useAccessAuthMock.mockReturnValue("unauthenticated");
    function ExplodingChild(): never {
      throw new Error("child mounted despite unauthenticated state");
    }
    expect(() => {
      render(
        <RequireAdminAccess>
          <ExplodingChild />
        </RequireAdminAccess>,
      );
    }).not.toThrow();
  });

  it("clicking 'Sign in via Access' triggers window.location.reload", () => {
    useAccessAuthMock.mockReturnValue("unauthenticated");
    const reloadSpy = vi.fn();
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window.location,
      "reload",
    );
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: reloadSpy,
    });
    try {
      render(
        <RequireAdminAccess>
          <div>admin</div>
        </RequireAdminAccess>,
      );
      fireEvent.click(screen.getByTestId("admin-auth-reload"));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window.location, "reload", originalDescriptor);
      }
    }
  });
});
