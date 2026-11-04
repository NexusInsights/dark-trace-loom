import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
const actor = vi.hoisted(() => ({ user: { id: "fixture-user" } as { id: string } | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: actor.user, loading: false }), AuthProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/hooks/useSubscription", () => ({ SubscriptionProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: () => <Outlet /> }));
vi.mock("./pages/Auth", () => ({ default: () => <h1>Auth fixture</h1> }));
vi.mock("./pages/ResetPassword", () => ({ default: () => <h1>ResetPassword fixture</h1> }));
vi.mock("./pages/AuthCallback", () => ({ default: () => <h1>AuthCallback fixture</h1> }));
vi.mock("./pages/PdlHistory", () => ({ default: () => <h1>PdlHistory fixture</h1> }));
vi.mock("./pages/Index", () => ({ default: () => <h1>Index fixture</h1> }));
vi.mock("./pages/Dashboard", () => ({ default: () => <h1>Dashboard fixture</h1> }));
vi.mock("./pages/ToolSuite", () => ({ default: () => <h1>ToolSuite fixture</h1> }));
vi.mock("./pages/Marketplace", () => ({ default: () => <h1>Marketplace fixture</h1> }));
vi.mock("./pages/Agents", () => ({ default: () => <h1>Agents fixture</h1> }));
vi.mock("./pages/Pipelines", () => ({ default: () => <h1>Pipelines fixture</h1> }));
vi.mock("./pages/Correlations", () => ({ default: () => <h1>Correlations fixture</h1> }));
vi.mock("./pages/IdentityResolution", () => ({ default: () => <h1>IdentityResolution fixture</h1> }));
vi.mock("./pages/SocialGraph", () => ({ default: () => <h1>SocialGraph fixture</h1> }));
vi.mock("./pages/PersonaDiscovery", () => ({ default: () => <h1>PersonaDiscovery fixture</h1> }));
vi.mock("./pages/PersonaProfile", () => ({ default: () => <h1>PersonaProfile fixture</h1> }));
vi.mock("./pages/PersonaIntelDashboard", () => ({ default: () => <h1>PersonaIntelDashboard fixture</h1> }));
vi.mock("./pages/Training", () => ({ default: () => <h1>Training fixture</h1> }));
vi.mock("./pages/KnowledgeBase", () => ({ default: () => <h1>KnowledgeBase fixture</h1> }));
vi.mock("./pages/ApiDocs", () => ({ default: () => <h1>ApiDocs fixture</h1> }));
vi.mock("./pages/Pricing", () => ({ default: () => <h1>Pricing fixture</h1> }));
vi.mock("./pages/Organizations", () => ({ default: () => <h1>Organizations fixture</h1> }));
vi.mock("./pages/ActivityLogs", () => ({ default: () => <h1>ActivityLogs fixture</h1> }));
vi.mock("./pages/Alerts", () => ({ default: () => <h1>Alerts fixture</h1> }));
vi.mock("./pages/Monitoring", () => ({ default: () => <h1>Monitoring fixture</h1> }));
vi.mock("./pages/Investigations", () => ({ default: () => <h1>Investigations fixture</h1> }));
vi.mock("./pages/Billing", () => ({ default: () => <h1>Billing fixture</h1> }));
vi.mock("./pages/Reports", () => ({ default: () => <h1>Reports fixture</h1> }));
vi.mock("./pages/EvidenceExport", () => ({ default: () => <h1>EvidenceExport fixture</h1> }));
vi.mock("./pages/Admin", () => ({ default: () => <h1>Admin fixture</h1> }));
vi.mock("./pages/PersonInvestigations", () => ({ default: () => <h1>PersonInvestigations fixture</h1> }));
vi.mock("./pages/PersonSources", () => ({ default: () => <h1>PersonSources fixture</h1> }));
vi.mock("./pages/PersonSettings", () => ({ default: () => <h1>PersonSettings fixture</h1> }));
vi.mock("./pages/PersonReports", () => ({ default: () => <h1>PersonReports fixture</h1> }));
vi.mock("./pages/IntelligenceLab", () => ({ default: () => <h1>IntelligenceLab fixture</h1> }));
vi.mock("./pages/ResearchWorkbench", () => ({ default: () => <h1>ResearchWorkbench fixture</h1> }));
vi.mock("./pages/AcceptInvite", () => ({ default: () => <h1>AcceptInvite fixture</h1> }));
vi.mock("./pages/NotFound", () => ({ default: () => <h1>NotFound fixture</h1> }));
import { AppRoutes } from "./App";
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname + location.search + location.hash}</output>; }
function mount(path: string) { return render(<MemoryRouter initialEntries={[path]}><AppRoutes /><Location /></MemoryRouter>); }
afterEach(() => { cleanup(); actor.user = { id: "fixture-user" }; });
const routes = [
  ["/", "Index"], ["/dashboard", "Dashboard"], ["/tools", "ToolSuite"],
  ["/marketplace", "Marketplace"], ["/agents", "Agents"], ["/pipelines", "Pipelines"],
  ["/correlations", "Correlations"], ["/identity", "IdentityResolution"],
  ["/social-graph", "SocialGraph"], ["/personas", "PersonaDiscovery"],
  ["/persona-profile?id=fixture-person", "PersonaProfile"], ["/persona-intel", "PersonaIntelDashboard"],
  ["/investigations", "Investigations"], ["/reports", "Reports"],
  ["/training", "Training"], ["/knowledge", "KnowledgeBase"], ["/api", "ApiDocs"], ["/pricing", "Pricing"],
  ["/person-investigations?person=fixture-person&tab=report", "PersonInvestigations"],
  ["/person-reports", "PersonReports"], ["/sources", "PersonSources"], ["/intelligence", "IntelligenceLab"],
  ["/research", "ResearchWorkbench"], ["/settings", "PersonSettings"], ["/monitoring", "Monitoring"],
  ["/pdl-history", "PdlHistory"], ["/organizations", "Organizations"], ["/activity", "ActivityLogs"],
  ["/alerts", "Alerts"], ["/evidence-export", "EvidenceExport"], ["/billing", "Billing"], ["/admin", "Admin"],
] as const;
describe("original platform and separate person/research routes", () => {
  it.each(routes)("renders %s without a replacement workspace", async (path, page) => {
    mount(path);
    expect(await screen.findByText(page + " fixture")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(path);
  });
  it.each(["/tools?tool=dns-query", "/tools?tool=marketplace%3Afixture-install"])("does not restrict registered tool links: %s", path => {
    mount(path); expect(screen.getByText("ToolSuite fixture")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(path);
  });
  it.each([
    ["/case-files?case=fixture-case#evidence", "/investigations?case=fixture-case#evidence", "Investigations"],
    ["/legacy-reports?case=fixture-case", "/reports?case=fixture-case", "Reports"],
    ["/landing?campaign=fixture", "/?campaign=fixture", "Index"],
    ["/investigations?person=fixture-person&tab=report#evidence", "/person-investigations?person=fixture-person&tab=report#evidence", "PersonInvestigations"],
  ])("preserves compatibility link %s", async (from, target, page) => {
    mount(from); expect(await screen.findByText(page + " fixture")).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(target));
  });
  it.each(["/pipelines", "/person-investigations", "/persona-profile?id=fixture-person"])("protects %s from signed-out access", async path => {
    actor.user = null;
    mount(path);
    expect(await screen.findByText("Auth fixture")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/auth");
  });
});
