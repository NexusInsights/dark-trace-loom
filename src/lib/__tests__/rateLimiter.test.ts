import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/rateLimiter";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows a burst of 10 then blocks", () => {
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit("tool").allowed).toBe(true);
    }
    expect(checkRateLimit("tool").allowed).toBe(false);
  });

  it("keeps buckets independent per tool", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("a");
    expect(checkRateLimit("a").allowed).toBe(false);
    expect(checkRateLimit("b").allowed).toBe(true);
  });

  it("refills 2 tokens per second", () => {
    for (let i = 0; i < 11; i++) checkRateLimit("tool");
    vi.advanceTimersByTime(1000);
    expect(checkRateLimit("tool").allowed).toBe(true);
    expect(checkRateLimit("tool").allowed).toBe(true);
    expect(checkRateLimit("tool").allowed).toBe(false);
  });

  it("carries the leftover of a partially consumed interval", () => {
    for (let i = 0; i < 11; i++) checkRateLimit("tool");
    vi.advanceTimersByTime(1400);
    expect(checkRateLimit("tool").allowed).toBe(true);
    expect(checkRateLimit("tool").allowed).toBe(true);
    expect(checkRateLimit("tool").allowed).toBe(false);
    // Two seconds have now elapsed in total, so another refill is due.
    vi.advanceTimersByTime(600);
    expect(checkRateLimit("tool").allowed).toBe(true);
  });

  it("reports the time remaining until the next refill", () => {
    for (let i = 0; i < 11; i++) checkRateLimit("tool");
    expect(checkRateLimit("tool").retryAfterMs).toBe(1000);
    vi.advanceTimersByTime(600);
    expect(checkRateLimit("tool").retryAfterMs).toBe(400);
  });

  it("caps refill at the burst maximum", () => {
    checkRateLimit("tool");
    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit("tool").allowed).toBe(true);
    }
    expect(checkRateLimit("tool").allowed).toBe(false);
  });
});
