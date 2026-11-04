import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppLayout } from "./AppLayout";
vi.mock("./OperationalDataStatus", () => ({ OperationalDataStatus: () => null }));
afterEach(cleanup);
const links = [
  ["Home", "/"], ["PDL History", "/pdl-history"], ["Organizations", "/organizations"],
  ["Alerts", "/alerts"], ["Monitoring", "/monitoring"], ["Evidence Export", "/evidence-export"],
  ["Training", "/training"], ["Knowledge Base", "/knowledge"], ["API", "/api"],
  ["Pricing", "/pricing"], ["Billing", "/billing"], ["Admin", "/admin"],
  ["Activity Logs", "/activity"], ["Settings", "/settings"],
  ["Dashboard", "/dashboard"], ["Tool Suite", "/tools"], ["Marketplace", "/marketplace"],
  ["Agents", "/agents"], ["Pipelines", "/pipelines"], ["Reports", "/reports"],
  ["Case Investigations", "/investigations"], ["Correlations", "/correlations"],
  ["Identity Resolution", "/identity"], ["Social Graph", "/social-graph"],
  ["Persona Discovery", "/personas"], ["Persona Profiles", "/persona-profile"], ["Persona Intel", "/persona-intel"],
  ["Person Investigations", "/person-investigations"], ["Person Reports", "/person-reports"],
  ["Research Sources", "/sources"], ["Research Workbench", "/research"], ["Intelligence Lab", "/intelligence"],
] as const;
describe("platform and workspace navigation", () => {
  it("exposes original modules and separately named person/research sections", () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><AppLayout /></MemoryRouter>);
    const renderedLinks = new Map(screen.getAllByRole("link").map(link => [link.textContent?.trim(), link]));
    for (const [name, path] of links) expect(renderedLinks.get(name)).toHaveAttribute("href", path);
    expect(screen.getByText("Platform", { exact: true })).toBeVisible();
    expect(screen.getByText("Person and research workspaces")).toBeVisible();
    expect(screen.getByText("INTELLIGENCE PLATFORM")).toBeVisible();
  });
  it.each([
    ["/dashboard", "Dashboard"], ["/tools?tool=dns-query", "Tool Suite"],
    ["/investigations", "Case Investigations"], ["/reports", "Reports"],
    ["/person-investigations?person=fixture", "Person Investigations"],
    ["/person-reports", "Person Reports"], ["/research", "Research Workbench"],
  ])("labels %s accurately", async (path, title) => {
    render(<MemoryRouter initialEntries={[path]}><AppLayout /></MemoryRouter>);
    await waitFor(() => expect(document.title).toBe(title + " | Insight Nexus"));
    expect(screen.getByRole("link", { name: "Insight Nexus" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByText("Person investigation workspace")).not.toBeInTheDocument();
  });
});
