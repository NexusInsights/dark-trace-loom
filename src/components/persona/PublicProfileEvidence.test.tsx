import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PublicProfileEvidence } from "./PublicProfileEvidence";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  limit: vi.fn(),
  user: { id: "saved-user" } as { id: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));

const clients: QueryClient[] = [];
function renderEvidence(personaId: string | null = "saved-persona") {
  const onError = vi.fn();
  const client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  render(<QueryClientProvider client={client}><PublicProfileEvidence personaId={personaId} /></QueryClientProvider>);
  return { client, onError };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "saved-user" };
  mocks.from.mockImplementation(() => {
    let toolName = "";
    const chain = { select: vi.fn(), eq: vi.fn(), contains: vi.fn(), order: vi.fn(), limit: vi.fn(() => mocks.limit(toolName)) };
    for (const method of [chain.select, chain.contains, chain.order]) method.mockReturnValue(chain);
    chain.eq.mockImplementation((column, value) => { if (column === "tool_name") toolName = value; return chain; });
    return chain;
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe("saved persona public-profile evidence", () => {
  it.each([{ data: [] }, { data: [{ result_data: null }] }])("shows an empty state without a query error for %j", async ({ data }) => {
    mocks.limit.mockResolvedValue({ data, error: null });
    const { client, onError } = renderEvidence();
    expect(await screen.findByText(/This saved persona has no live profile lookup/)).toBeInTheDocument();
    expect(client.getQueryState(["persona_public_profiles", "saved-persona", "saved-user"])?.status).toBe("success");
    expect(client.getQueryData(["persona_public_profiles", "saved-persona", "saved-user"])).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders retrieved evidence when a saved lookup exists", async () => {
    mocks.limit.mockResolvedValue({ data: [{ result_data: {
      username: "example", retrievedAt: "2026-10-14T12:00:00Z", checks: [],
      profiles: [{ platform: "GitHub", username: "example", profileUrl: "https://github.com/example", sourceUrl: "https://api.github.com/users/example" }],
    } }], error: null });
    const { onError } = renderEvidence();
    expect(await screen.findByRole("link", { name: "GitHub: @example" })).toHaveAttribute("href", "https://github.com/example");
    expect(screen.queryByText(/no live profile lookup/)).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps database failures visible instead of treating them as absent evidence", async () => {
    const error = new Error("Permission denied");
    mocks.limit.mockResolvedValue({ data: null, error });
    const { onError } = renderEvidence();
    expect(await screen.findByRole("alert")).toHaveTextContent("Profile evidence could not be loaded: Permission denied");
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error, expect.anything()));
  });

  it("does not query without a persona", () => {
    renderEvidence(null);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not query without a signed-in user", () => {
    mocks.user = null;
    renderEvidence();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("keeps account existence separate from a latest rejected person association", async () => {
    const profile = { platform: "GitHub", username: "example", accountId: "github:123", platformId: "123", existence: "found", evidenceKind: "public_account", personAssociation: "unreviewed", profileUrl: "https://github.com/example", sourceUrl: "https://api.github.com/users/example", retrievedAt: "2026-11-04T00:00:00Z" };
    mocks.limit.mockImplementation(toolName => Promise.resolve({ error: null, data: toolName === "public-profile-search" ? [{ id: "lookup", result_data: { schemaVersion: 2, status: "partial", username: "example", retrievedAt: profile.retrievedAt, profiles: [profile], checks: [{ platform: "GitHub", sourceUrl: profile.sourceUrl, retrievedAt: profile.retrievedAt, status: "found", profile }, { platform: "GitLab", sourceUrl: "https://gitlab.com/api/v4/users?username=example", retrievedAt: profile.retrievedAt, status: "unavailable", reason: "HTTP 429" }] } }] : [
      { result_data: { account_id: "github:123", profile_url: "https://github.com/renamed-example", decision: "rejected", reason: "The same stable account changed its handle; biography belongs to another person.", reviewed_at: "2026-11-04T02:00:00Z" } },
      { result_data: { account_id: "github:123", profile_url: profile.profileUrl, decision: "supported", reason: "Older assessment", reviewed_at: "2026-11-04T01:00:00Z" } },
    ] }));
    renderEvidence();
    expect(await screen.findByText("Person association: Rejected")).toBeInTheDocument();
    expect(screen.getByText(/Account record observed/)).toBeInTheDocument();
    expect(screen.getByText(/GitLab: unavailable - HTTP 429/)).toBeInTheDocument();
    expect(screen.queryByText(/Person association: Analyst-supported/)).not.toBeInTheDocument();
  });

  it("does not render unsafe saved profile URLs as source-backed accounts", async () => {
    mocks.limit.mockResolvedValue({ error: null, data: [{ id: "lookup", result_data: { username: "example", retrievedAt: "2026-11-04T00:00:00Z", checks: [], profiles: [{ platform: "Fake", username: "guess", profileUrl: "javascript:alert(1)", sourceUrl: "https://example.org" }] } }] });
    renderEvidence();
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid source records/);
    expect(screen.queryByRole("link", { name: /Fake:/ })).not.toBeInTheDocument();
  });

  it.each([{ displayName: { guessed: "Person" } }, { bio: ["guess"] }, { relatedProfiles: {} }, { relatedProfiles: [{ platform: "GitHub", username: {}, profileUrl: "https://github.com/example", evidence: "old claim" }] }])("reports malformed legacy account metadata without crashing: %j", async metadata => {
    mocks.limit.mockResolvedValue({ error: null, data: [{ id: "lookup", result_data: { username: "example", retrievedAt: "2026-11-04T00:00:00Z", checks: [], profiles: [{ platform: "GitHub", username: "example", profileUrl: "https://github.com/example", sourceUrl: "https://api.github.com/users/example", ...metadata }] } }] });
    renderEvidence();
    expect(await screen.findByRole("alert")).toHaveTextContent(/malformed account metadata/);
  });
});
