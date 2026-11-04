import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ entities: [] as unknown[], leads: [] as unknown[], queryError: null as Error | null, entityError: null as Error | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "fixture-owner" } }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ plan: "enterprise" }) }));
vi.mock("@/hooks/useInvestigationData", () => ({ useCases: () => ({ data: [{ id: "case-a", title: "Case A" }, { id: "case-b", title: "Case B" }] }) }));
vi.mock("@/hooks/useIdentityResolution", () => ({ useIdentityEntities: () => ({ data: state.entities, error: state.entityError }) }));
vi.mock("@/hooks/useSocialGraph", () => ({ useSocialGraphEdges: () => ({ data: [] }) }));
vi.mock("@/hooks/useInfrastructure", () => ({ useInfrastructureLinks: () => ({ data: [] }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.leads, error: state.queryError }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
import CorrelationsPage from "./Correlations";
import SocialGraphPage from "./SocialGraph";

beforeEach(() => {
  state.entities = []; state.leads = []; state.queryError = null; state.entityError = null;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

it("labels saved correlations as unverified leads without presenting an old numeric score as confidence", () => {
  state.leads = [{ id: "lead", source_case_id: "case-a", target_case_id: "case-b", source_type: "username", source_value: "synthetic-user", relationship_type: "shared_username_lead", confidence: 0.99 }];
  render(<CorrelationsPage />);
  expect(screen.getByText("Unverified lead; ownership not established")).toBeInTheDocument();
  expect(screen.queryByText(/99%/)).not.toBeInTheDocument();
  expect(screen.getByText(/a shared value does not establish a person or account relationship/i)).toBeInTheDocument();
});

it("does not display unsupported supplied or generated entities as resolved social graph nodes", () => {
  state.entities = [{ id: "input", entity_type: "username", entity_value: "invented-input", metadata: { source: "input" } }, { id: "candidate", entity_type: "social_profile", entity_value: "https://github.com/invented-candidate", metadata: { source: "generated" } }];
  render(<SocialGraphPage />);
  expect(screen.queryByText("invented-input")).not.toBeInTheDocument();
  expect(screen.queryByText("https://github.com/invented-candidate")).not.toBeInTheDocument();
  expect(screen.getByText(/Inputs and unreviewed candidates remain saved outside this graph/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "MINE SOCIAL GRAPH" })).toBeDisabled();
});

it("shows an observation read failure rather than implying no correlation findings", () => {
  state.queryError = new Error("SYNTHETIC source evidence unavailable");
  state.leads = [{ id: "cached", source_case_id: "case-a", target_case_id: "case-b", source_type: "username", source_value: "cached-stale-lead", relationship_type: "shared_username_lead", confidence: 0 }];
  render(<CorrelationsPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("Source observations could not be loaded");
  expect(screen.getByRole("alert")).toHaveTextContent("SYNTHETIC source evidence unavailable");
  expect(screen.queryByText("cached-stale-lead")).not.toBeInTheDocument();
});

it("shows a current review read failure and disables social graph mutation", () => {
  state.entityError = new Error("SYNTHETIC current review unavailable");
  render(<SocialGraphPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("Current review or source evidence could not be loaded");
  expect(screen.getByRole("button", { name: "MINE SOCIAL GRAPH" })).toBeDisabled();
  expect(screen.queryByText(/Add a source-backed account association review in Persona Discovery/)).not.toBeInTheDocument();
});
