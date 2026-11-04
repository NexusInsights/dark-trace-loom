import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonaDiscovery from "./PersonaDiscovery";
const mocks = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock("@/components/persona/PublicProfileEvidence", () => ({ PublicProfileEvidence: () => <section>Source records and review</section> }));
vi.mock("@/lib/profileLookup", () => ({ identifierSource: () => "Supplied lead" }));
vi.mock("@/hooks/usePersonas", () => ({ usePersonas: () => ({ data: [], isLoading: false }), usePersonaIdentifiers: () => ({ data: [] }), usePersonaDiscovery: () => ({ mutate: mocks.discover, isPending: false, progress: null }), useDeletePersona: () => ({ mutate: vi.fn() }) }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("source-backed discovery workflow", () => {
  it("does not expose username or email fabrication actions", () => {
    render(<PersonaDiscovery />);
    expect(screen.queryByRole("button", { name: /Generate Usernames|Generate Emails/ })).not.toBeInTheDocument();
    expect(screen.getByText(/A name alone saves a lead/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Discovery workflow" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "open Identity Review" })).toHaveAttribute("href", "/identity");
  });
  it("saves name-only input as leads, without claiming an account lookup", () => {
    render(<PersonaDiscovery />);
    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Synthetic Example" } });
    fireEvent.click(screen.getByRole("button", { name: "Save supplied leads" }));
    expect(mocks.discover).toHaveBeenCalledWith(expect.objectContaining({ name: "Synthetic Example", username: "", profileUrl: "", enrich: false }), expect.anything());
  });
  it("uses a supplied exact public URL and clears a competing username seed", () => {
    render(<PersonaDiscovery />);
    fireEvent.change(screen.getByLabelText("Or exact username"), { target: { value: "unrelated" } });
    fireEvent.change(screen.getByLabelText("Known public profile URL"), { target: { value: "https://github.com/octocat" } });
    expect(screen.getByLabelText("Or exact username")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Search public accounts" }));
    expect(mocks.discover).toHaveBeenCalledWith(expect.objectContaining({ profileUrl: "https://github.com/octocat", username: "", enrich: false }), expect.anything());
  });
});
