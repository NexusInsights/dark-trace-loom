import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(), pipelines: [] as unknown[], runs: [] as unknown[] }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-user" } }) }));
vi.mock("@/hooks/usePipelines", () => ({
  usePipelines: () => ({ data: state.pipelines, isLoading: false }), usePipelineRuns: () => ({ data: state.runs }),
  useCreatePipeline: () => ({ mutate: state.create, isPending: false }), useDeletePipeline: () => ({ mutate: vi.fn() }), useTogglePipeline: () => ({ mutate: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: state.success, warning: state.warning, error: state.error } }));
vi.mock("@/lib/pipelineEngine", () => ({ executePipeline: state.run, getPipelineTemplates: () => [{ name: "Domain lookup", description: "Fixture", schedule: "manual", tool_sequence: ["dns-query"], input_params: { domain: "" } }] }));
import Pipelines from "./Pipelines";
beforeEach(() => { cleanup(); state.create.mockReset(); state.run.mockReset(); state.success.mockReset(); state.warning.mockReset(); state.error.mockReset(); state.pipelines = []; state.runs = []; });
it("opens template inputs for editing instead of creating an unusable pipeline", () => {
  render(<Pipelines />); fireEvent.click(screen.getByText("USE TEMPLATE")); expect(state.create).not.toHaveBeenCalled();
  const input = screen.getByLabelText("Pipeline inputs"); expect(input).toHaveValue(JSON.stringify({ domain: "" }, null, 2));
  fireEvent.change(input, { target: { value: '{"domain":"example.com"}' } }); fireEvent.click(screen.getByText("CREATE"));
  expect(state.create.mock.calls[0][0].input_params).toEqual({ domain: "example.com" });
});
it("rejects invalid input JSON without a database write", () => {
  render(<Pipelines />); fireEvent.click(screen.getByText("USE TEMPLATE")); fireEvent.change(screen.getByLabelText("Pipeline inputs"), { target: { value: "[]" } }); fireEvent.click(screen.getByText("CREATE"));
  expect(state.create).not.toHaveBeenCalled(); expect(state.error).toHaveBeenCalledWith("Inputs must be a JSON object");
});
it("renders the failed provider reason and warns on partial runs", async () => {
  state.pipelines = [{ id: "pipeline", name: "Fixture", enabled: true, schedule: "manual", tool_sequence: ["dns-query"] }];
  state.runs = [{ id: "run", pipeline_id: "pipeline", status: "partial", results: [{ tool: "dns-query", status: "error", summary: "Provider unavailable" }] }];
  state.run.mockResolvedValue({ status: "partial", artifactsCreated: 0, entitiesLinked: 0 });
  render(<Pipelines />); expect(screen.getByText(/dns-query: error.*Provider unavailable/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("RUN")); await waitFor(() => expect(state.warning).toHaveBeenCalled()); expect(state.success).not.toHaveBeenCalled();
});
