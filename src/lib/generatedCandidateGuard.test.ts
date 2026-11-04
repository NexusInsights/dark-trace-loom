import { describe, it, expect, vi } from "vitest";
const from = vi.hoisted(() => vi.fn(() => { throw new Error("Unexpected candidate persistence"); }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
import { runUsernamePermutation } from "./usernamePermutationEngine";
import { runEmailPermutation } from "./emailPermutationEngine";
describe("disabled generated identifier persistence", () => {
  it("does not manufacture or save username guesses for a supplied name or handle", async () => {
    await expect(runUsernamePermutation("user", "person", "Example", "Subject", "sourceuser")).rejects.toThrow("guesses are disabled");
    expect(from).not.toHaveBeenCalled();
  });
  it("does not manufacture or save inferred mailbox addresses, including common free providers", async () => {
    await expect(runEmailPermutation("user", "person", "Example", "Subject", ["sample.org"])).rejects.toThrow("guesses are disabled");
    expect(from).not.toHaveBeenCalled();
  });
});
