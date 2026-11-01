import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ capture: vi.fn(), password: vi.fn(), fingerprint: vi.fn() }));
vi.mock('./privacy-password.mjs', () => ({ capturePrivacySnapshot: h.capture, checkPrivatePassword: h.password, comparePrivacySnapshots: () => ({ changed: false, changes: [], limitation: 'Synthetic comparison' }) }));
vi.mock('../intelligence/browser-client.js', () => ({ captureFingerprint: h.fingerprint }));
import { BrowserPrivacyPanel, PrivatePasswordPanel, type LocalResearchExecutor } from './PrivacyPanels';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('private panels require the assigned admission executor', () => {
  it('does not inspect browser signals before explicit consent and successful executor admission', async () => {
    const execute = vi.fn<LocalResearchExecutor>().mockRejectedValue(new Error('Daily allowance unavailable'));
    render(<BrowserPrivacyPanel execute={execute as LocalResearchExecutor} />);
    expect(screen.getByRole('button', { name: 'Capture baseline' })).toBeDisabled(); expect(execute).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('I agree to inspect this browser locally.')); fireEvent.click(screen.getByRole('button', { name: 'Capture baseline' }));
    await screen.findByRole('alert'); expect(execute).toHaveBeenCalledOnce(); expect(execute.mock.calls[0][0]).toBe('research-privacy'); expect(typeof execute.mock.calls[0][1]).toBe('function'); expect(h.capture).not.toHaveBeenCalled(); expect(h.fingerprint).not.toHaveBeenCalled();
  });

  it('does not query while typing, clears password on submit, and passes private input only inside a local closure', async () => {
    let accept!: (result: unknown) => void;
    const execute = vi.fn((_action: string, _operation: unknown, _options: { signal: AbortSignal }) => new Promise<unknown>(resolve => { accept = resolve; }));
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<PrivatePasswordPanel execute={execute as LocalResearchExecutor} />);
    fireEvent.change(screen.getByLabelText('Password to check'), { target: { value: 'PRIVATE_PASSWORD_FIXTURE' } });
    fireEvent.click(screen.getByLabelText('I understand that HIBP receives a five-character hash prefix and my network request.'));
    expect(execute).not.toHaveBeenCalled(); expect(h.password).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check password exposure' }));
    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Password to check')).toHaveValue(''); expect(execute.mock.calls[0][0]).toBe('research-password'); expect(typeof execute.mock.calls[0][1]).toBe('function'); expect(JSON.stringify(execute.mock.calls)).not.toContain('PRIVATE_PASSWORD_FIXTURE'); expect(storage).not.toHaveBeenCalled();
    await act(async () => { accept({ status: 'not_found', exposureCount: 0, checkedAt: '2026-11-01T12:00:00Z', limitation: 'Missing match is not a safety guarantee.' }); });
    expect(screen.getByText('No matching password hash found in this response')).toBeInTheDocument(); expect(document.body.textContent).not.toContain('PRIVATE_PASSWORD_FIXTURE'); expect(storage).not.toHaveBeenCalled();
  });

  it('aborts password executor work on cancel/unmount and has no direct fallback without an executor', async () => {
    let reject!: (error: unknown) => void;
    const execute = vi.fn((_action: string, _operation: unknown, _options: { signal: AbortSignal }) => new Promise<unknown>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const view = render(<PrivatePasswordPanel execute={execute as LocalResearchExecutor} />);
    fireEvent.change(screen.getByLabelText('Password to check'), { target: { value: 'PRIVATE_PASSWORD_FIXTURE' } }); fireEvent.click(screen.getByLabelText('I understand that HIBP receives a five-character hash prefix and my network request.')); fireEvent.click(screen.getByRole('button', { name: 'Check password exposure' }));
    await waitFor(() => expect(execute).toHaveBeenCalledOnce()); const signal = execute.mock.calls[0][2].signal;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel password check' })); expect(signal.aborted).toBe(true);
    await act(async () => { reject(new DOMException('Cancelled', 'AbortError')); });
    fireEvent.change(screen.getByLabelText('Password to check'), { target: { value: 'PRIVATE_PASSWORD_FIXTURE' } }); fireEvent.click(screen.getByRole('button', { name: 'Check password exposure' })); await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    const unmountSignal = execute.mock.calls[1][2].signal; view.unmount(); expect(unmountSignal.aborted).toBe(true); await act(async () => { reject(new DOMException('Cancelled', 'AbortError')); });
    render(<PrivatePasswordPanel execute={undefined as unknown as LocalResearchExecutor} />); fireEvent.change(screen.getByLabelText('Password to check'), { target: { value: 'PRIVATE_PASSWORD_FIXTURE' } }); fireEvent.click(screen.getByLabelText('I understand that HIBP receives a five-character hash prefix and my network request.')); fireEvent.click(screen.getByRole('button', { name: 'Check password exposure' }));
    await screen.findByRole('alert'); expect(h.password).not.toHaveBeenCalled();
  });
});
