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
  const chain = { select: vi.fn(), eq: vi.fn(), contains: vi.fn(), order: vi.fn(), limit: mocks.limit };
  for (const method of [chain.select, chain.eq, chain.contains, chain.order]) method.mockReturnValue(chain);
  mocks.from.mockReturnValue(chain);
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe("saved persona public-profile evidence", () => {
  it.each([[], [{ result_data: null }]])("shows an empty state without a query error for %j", async data => {
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
});
