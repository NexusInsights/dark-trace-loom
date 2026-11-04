import type { PropsWithChildren } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonaIntelDashboard from "./PersonaIntelDashboard";

const state = vi.hoisted(() => ({
  people: [] as { id: string; persona_label: string }[],
  accounts: [] as { id: string; entity_type: string; entity_value: string; metadata?: unknown }[],
  error: null as Error | null, loading: false, navigate: vi.fn(),
}));
vi.mock("@/hooks/usePersonas", () => ({ usePersonas: () => ({ data: state.people, isLoading: state.loading, error: state.error }) }));
vi.mock("@/hooks/useIdentityResolution", () => ({ useIdentityEntities: () => ({ data: state.accounts, isLoading: state.loading, error: null }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => state.navigate }));
vi.mock("@/components/intel", () => ({
  GlassPanel: ({ children }: PropsWithChildren) => <div>{children}</div>,
  StatDisplay: ({ label, value }: { label: string; value: number }) => <p>{label}: {value}</p>,
}));
beforeEach(() => { state.people = [{ id: "person-a", persona_label: "Supplied lead" }]; state.accounts = []; state.error = null; state.loading = false; vi.clearAllMocks(); });
afterEach(cleanup);

describe("persona evidence overview", () => {
  it("keeps saved leads separate from unsupported account guesses and risk claims", () => {
    state.accounts = [{ id: "guess", entity_type: "username", entity_value: "madeup-alex", metadata: { identity_evidence: { persona_id: "person-a" } } }];
    render(<PersonaIntelDashboard />);
    expect(screen.getByText("SAVED LEADS: 1")).toBeInTheDocument();
    expect(screen.getByText("SUPPORTED ACCOUNT ASSOCIATIONS: 0")).toBeInTheDocument();
    expect(screen.queryByText("madeup-alex")).not.toBeInTheDocument();
    expect(screen.queryByText(/HIGH CONNECTIVITY|RISK SCORE|RECENT DISCOVERIES/)).not.toBeInTheDocument();
    expect(screen.getByText(/No current source-bound association/)).toBeInTheDocument();
  });
  it("shows a source-bound association with source and review links and no ownership percentage", () => {
    state.accounts = [{ id: "account", entity_type: "social_profile", entity_value: "https://github.com/sampleuser", metadata: { identity_evidence: {
      classification: "analyst_supported_association", persona_id: "person-a", account_id: "github:123", profile_url: "https://github.com/sampleuser",
      lookup_result_id: "lookup", review_id: "review", source_url: "https://api.github.com/users/sampleuser", supporting_source_url: "https://sample.org/author",
      retrieved_at: "2026-11-04T00:00:00Z", reviewed_at: "2026-11-04T01:00:00Z",
    } } }];
    render(<PersonaIntelDashboard />);
    expect(screen.getByText("SUPPORTED ACCOUNT ASSOCIATIONS: 1")).toBeInTheDocument();
    expect(screen.getByText("Analyst-supported association")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retrieved source record" })).toHaveAttribute("href", "https://api.github.com/users/sampleuser");
    expect(screen.getByRole("link", { name: "Association support cited by analyst" })).toHaveAttribute("href", "https://sample.org/author");
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review dossier" }));
    expect(state.navigate).toHaveBeenCalledWith("/persona-profile?id=person-a");
  });
  it("renders unavailable source reads as errors rather than claiming no results", () => {
    state.error = new Error("Source access denied");
    render(<PersonaIntelDashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Source access denied");
    expect(screen.queryByText("SUPPORTED ACCOUNT ASSOCIATIONS: 0")).not.toBeInTheDocument();
  });
  it("does not show completed metrics while evidence is still loading", () => {
    state.loading = true;
    render(<PersonaIntelDashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading source-bound account associations");
    expect(screen.queryByText("SAVED LEADS: 1")).not.toBeInTheDocument();
  });
});
