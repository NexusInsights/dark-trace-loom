import { useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function OperationalDataStatus() {
  const cache = useQueryClient().getQueryCache();
  const errors = useSyncExternalStore(listener => cache.subscribe(listener), () => cache.getAll().filter(query => query.isActive() && query.state.status === "error").map(query => query.state.error?.message || "Data request failed").join("; "));
  return errors ? <div role="alert" className="border-b border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">Some operation data could not be loaded. Counts and empty panels may be incomplete. {errors}</div> : null;
}
