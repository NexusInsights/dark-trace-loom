import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthPage from './Auth';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(), signUp: vi.fn(), signInWithOtp: vi.fn(), resetPasswordForEmail: vi.fn(), signInWithOAuth: vi.fn(),
}));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('sonner', () => ({ toast: notifications }));
vi.mock('@/components/intel', () => ({ GlassPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

function mount(mode = 'login') { render(<MemoryRouter initialEntries={[`/auth?mode=${mode}`]}><AuthPage /></MemoryRouter>); }
function enterEmail() { fireEvent.change(screen.getByPlaceholderText('operator@agency.gov'), { target: { value: 'operator@example.test' } }); }
function enterPassword() { fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'ControlledFixture123!' } }); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('VITE_GOOGLE_OAUTH_ENABLED', 'false');
  vi.stubEnv('VITE_SUPABASE_URL', 'https://owned-auth.example.test');
  for (const name of ['signInWithPassword', 'signUp', 'signInWithOtp', 'resetPasswordForEmail'] as const)
    auth[name].mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('email authentication while removing the broker', () => {
  it('keeps Google disabled with a clear explanation until it is configured', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(screen.getByText(/Google sign-in has not been configured/)).toBeVisible();
  });
  it('preserves password sign-in on the configured backend', async () => {
    mount(); enterEmail(); enterPassword(); fireEvent.click(screen.getByRole('button', { name: 'SIGN IN' }));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'operator@example.test', password: 'ControlledFixture123!' }));
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });
  it('preserves signup and confirmation return to this app', async () => {
    mount('signup'); enterEmail(); enterPassword(); fireEvent.click(screen.getByRole('button', { name: 'CREATE ACCOUNT' }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith({ email: 'operator@example.test', password: 'ControlledFixture123!', options: { emailRedirectTo: `${window.location.origin}/` } }));
  });
  it('preserves magic links and their dashboard return URL', async () => {
    mount('magic'); enterEmail(); fireEvent.click(screen.getByRole('button', { name: 'SEND MAGIC LINK' }));
    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'operator@example.test', options: { emailRedirectTo: `${window.location.origin}/dashboard` } }));
  });
  it('preserves password-recovery email and its reset return URL', async () => {
    mount(); enterEmail(); fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('operator@example.test', { redirectTo: `${window.location.origin}/reset-password` }));
  });
  it('shows backend failures without reporting that an email was sent', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: new Error('Controlled SMTP unavailable') });
    mount('magic'); enterEmail(); fireEvent.click(screen.getByRole('button', { name: 'SEND MAGIC LINK' }));
    await waitFor(() => expect(notifications.error).toHaveBeenCalledWith('Controlled SMTP unavailable'));
    expect(notifications.success).not.toHaveBeenCalled();
  });
  it('calls direct Google OAuth when explicitly enabled and displays provider errors', async () => {
    vi.stubEnv('VITE_GOOGLE_OAUTH_ENABLED', 'true');
    auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: 'Google provider credentials are missing' } });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback`, skipBrowserRedirect: true } }));
    await waitFor(() => expect(notifications.error).toHaveBeenCalledWith('Google provider credentials are missing'));
  });
});
