import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type UsageResponse = { data: unknown; error: unknown };
const h = vi.hoisted(() => ({ query: vi.fn(), accounts: [] as string[], auth: { user: { id: 'account-a' } } as { user: { id: string } | null } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: (column: string, value: string) => { if (column === 'user_id') h.accounts.push(value); return query; }, abortSignal: h.query };
  return query;
} } }));
import { useUsageTracking } from './useUsageTracking';

function deferred() {
  let resolve!: (response: UsageResponse) => void;
  const promise = new Promise<UsageResponse>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (executions: number): UsageResponse => ({ data: [{ executions }], error: null });
beforeEach(() => { vi.resetAllMocks(); h.accounts = []; h.auth = { user: { id: 'account-a' } }; h.query.mockResolvedValue(response(3)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('optional same-account usage background refresh', () => {
  it('retains verified access and count during background work, then adopts the fresh total', async () => {
    const { result } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const next = deferred(); h.query.mockReturnValueOnce(next.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh({ background: true }); });
    expect(result.current.loading).toBe(false); expect(result.current.dailyTotal).toBe(3); expect(result.current.error).toBeNull();
    await act(async () => { next.resolve(response(4)); await pending; });
    expect(result.current.dailyTotal).toBe(4); expect(result.current.loading).toBe(false);
  });

  it('preserves the blocking default for legacy and explicit account rechecks', async () => {
    const { result } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const next = deferred(); h.query.mockReturnValueOnce(next.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh(); });
    expect(result.current.loading).toBe(true); expect(result.current.dailyTotal).toBe(3);
    await act(async () => { next.resolve(response(4)); await pending; });
    expect(result.current.loading).toBe(false);
  });

  it('never treats a requested initial background refresh as verified access', async () => {
    const initial = deferred(); const next = deferred(); h.query.mockReturnValueOnce(initial.promise).mockReturnValueOnce(next.promise);
    const { result } = renderHook(useUsageTracking); expect(result.current.loading).toBe(true);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh({ background: true }); });
    expect(result.current.loading).toBe(true); expect(result.current.dailyTotal).toBe(0);
    await act(async () => { initial.resolve(response(99)); next.resolve(response(2)); await pending; });
    expect(result.current.dailyTotal).toBe(2); expect(result.current.loading).toBe(false);
  });

  it('requires fresh verification for another account and ignores late results and refresh closures from the old account', async () => {
    const { result, rerender } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.dailyTotal).toBe(3));
    const oldRefresh = result.current.refresh;
    const oldWork = deferred(); const newWork = deferred(); h.query.mockReturnValueOnce(oldWork.promise).mockReturnValueOnce(newWork.promise);
    let pending!: Promise<void>;
    act(() => { pending = oldRefresh({ background: true }); });
    h.auth = { user: { id: 'account-b' } }; rerender();
    expect(result.current.loading).toBe(true); expect(result.current.dailyTotal).toBe(0);
    await act(async () => { oldWork.resolve(response(99)); await pending; await oldRefresh({ background: true }); });
    expect(result.current.loading).toBe(true); expect(result.current.dailyTotal).toBe(0); expect(h.query).toHaveBeenCalledTimes(3);
    await act(async () => { newWork.resolve(response(1)); });
    expect(result.current.dailyTotal).toBe(1); expect(result.current.loading).toBe(false); expect(h.accounts).toEqual(['account-a', 'account-a', 'account-b']);
  });

  it('exposes a failed background verification and retains the error until a successful response', async () => {
    const { result } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.loading).toBe(false));
    h.query.mockResolvedValueOnce({ data: null, error: { message: 'Usage verification unavailable' } });
    await act(() => result.current.refresh({ background: true }));
    expect(result.current.dailyTotal).toBe(3); expect(result.current.error).toBe('Usage verification unavailable');
    const retry = deferred(); h.query.mockReturnValueOnce(retry.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh({ background: true }); });
    expect(result.current.error).toBe('Usage verification unavailable');
    await act(async () => { retry.resolve(response(4)); await pending; });
    expect(result.current.error).toBeNull(); expect(result.current.dailyTotal).toBe(4);
  });

  it('fails closed on malformed background counts without replacing the last verified total', async () => {
    const { result } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.loading).toBe(false));
    h.query.mockResolvedValueOnce({ data: [{ executions: -1 }], error: null });
    await act(() => result.current.refresh({ background: true }));
    expect(result.current.dailyTotal).toBe(3); expect(result.current.error).toContain('invalid execution counts');
  });

  it('blocks a new UTC day until its usage is freshly verified', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T23:59:00Z'));
    const { result } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.setSystemTime(new Date('2026-11-02T00:01:00Z'));
    const next = deferred(); h.query.mockReturnValueOnce(next.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh({ background: true }); });
    expect(result.current.loading).toBe(true);
    await act(async () => { next.resolve(response(0)); await pending; });
    expect(result.current.dailyTotal).toBe(0); expect(result.current.loading).toBe(false);
  });

  it('does not let a late background result overwrite a later verified refresh', async () => {
    const { result } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const slow = deferred(); const fast = deferred(); h.query.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    let oldPending!: Promise<void>; let newPending!: Promise<void>;
    act(() => { oldPending = result.current.refresh({ background: true }); newPending = result.current.refresh({ background: true }); });
    await act(async () => { fast.resolve(response(5)); await newPending; slow.resolve(response(4)); await oldPending; });
    expect(result.current.dailyTotal).toBe(5); expect(result.current.loading).toBe(false);
  });
});
