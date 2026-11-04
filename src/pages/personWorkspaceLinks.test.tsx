import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const fixtures = vi.hoisted(() => ({ people: [{ id: "fixture-person", persona_label: "Controlled fixture" }] }));
vi.mock("@/hooks/usePersonas", () => ({ usePersonas: () => ({ data: fixtures.people, error: null, isLoading: false }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: {}, isLoading: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "fixture-user" } }) }));
vi.mock("@/components/tools/marketplaceRemoteTools", () => ({ getMarketplaceStatuses: vi.fn() }));
vi.mock("@/components/intel", () => ({ GlassPanel: ({ children }: { children: React.ReactNode }) => <section>{children}</section> }));
import PersonReports from "./PersonReports";
import PersonSources from "./PersonSources";
afterEach(() => { cleanup(); fixtures.people = [{ id: "fixture-person", persona_label: "Controlled fixture" }]; });
describe("person workspace links remain separate from original cases", () => {
  it("opens a person's report in the named person workspace", () => {
    render(<MemoryRouter><PersonReports /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Controlled fixture" })).toHaveAttribute("href", "/person-investigations?person=fixture-person&tab=report");
  });
  it("keeps the empty-state call to action within the person workspace", () => {
    fixtures.people = [];
    render(<MemoryRouter><PersonReports /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Start your first investigation" })).toHaveAttribute("href", "/person-investigations");
  });
  it("links research sources back to person investigations", () => {
    render(<MemoryRouter><PersonSources /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Open investigations" })).toHaveAttribute("href", "/person-investigations");
  });
});
