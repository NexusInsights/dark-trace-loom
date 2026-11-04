import type { PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_EXPANSION_MESSAGE, useRunExpansion } from "./useIdentityExpansion";

const fixtures = vi.hoisted(() => ({
  user: { id: "synthetic-user" } as { id: string } | null,
  invoke: vi.fn(), from: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: fixtures.invoke }, from: fixtures.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: fixtures.user }) }));
vi.mock("sonner", () => ({ toast: { success: fixtures.success, info: fixtures.info, error: fixtures.error } }));

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useRunExpansion(), { wrapper });
}
beforeEach(() => { vi.clearAllMocks(); fixtures.user = { id: "synthetic-user" }; });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("legacy expansion client quarantine", () => {
  it("never invokes the older remote generator and never reports fabricated progress as success", async () => {
    const { result } = setup();
    await act(async () => {
      expect(await result.current.mutateAsync({ entity_id: "seed", entity_type: "username", entity_value: "synthetic.handle" }))
        .toEqual({ status: "not_configured", success: false, reason: LEGACY_EXPANSION_MESSAGE });
    });
    expect(fixtures.invoke).not.toHaveBeenCalled();
    expect(fixtures.from).not.toHaveBeenCalled();
    expect(fixtures.success).not.toHaveBeenCalled();
    expect(fixtures.info).toHaveBeenCalledWith(LEGACY_EXPANSION_MESSAGE);
  });
  it("requires sign-in without making any network or persistence call", async () => {
    fixtures.user = null;
    const { result } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync({ entity_id: "seed", entity_type: "username", entity_value: "synthetic.handle" })).rejects.toThrow("Not authenticated");
    });
    expect(fixtures.invoke).not.toHaveBeenCalled();
    expect(fixtures.from).not.toHaveBeenCalled();
    expect(fixtures.success).not.toHaveBeenCalled();
  });
});
