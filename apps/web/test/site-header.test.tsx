// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SiteHeader } from "../components/site-header";

function renderHeader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(SiteHeader)));
}

const route = vi.hoisted(() => ({ pathname: "/login" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: PropsWithChildren<{ href: string }>) =>
    createElement("a", { href }, children),
}));
vi.mock("next/image", () => ({ default: () => createElement("span") }));
afterEach(cleanup);

it("shows auth navigation instead of workspace links before sign-in", () => {
  route.pathname = "/login";
  renderHeader();
  expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "My kits" })).toBeNull();
  expect(screen.queryByRole("link", { name: "New kit" })).toBeNull();
});

it("shows workspace navigation on a protected page", () => {
  route.pathname = "/kits";
  renderHeader();
  expect(screen.getByRole("link", { name: "My kits" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "New kit" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Create account" })).toBeNull();
});
