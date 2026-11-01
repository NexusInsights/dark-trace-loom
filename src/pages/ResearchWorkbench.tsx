import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { usePersonas } from '@/hooks/usePersonas';
import { checkToolExecutionGate, getPlanPermissions } from '@/lib/planGating';
import { MonitorCoveragePanel } from '@/features/research/MonitorCoveragePanel';
import { BrowserPrivacyPanel, PrivatePasswordPanel, type LocalResearchExecutor } from '@/features/research/PrivacyPanels';
import { EmailAuthenticityPanel } from '@/features/research/EmailAuthenticityPanel';
import { verifyEmailMessage } from '@/features/research/email-client';
import { EvidenceWorkbenchPanel, type EvidenceLedger } from '@/features/research/EvidenceWorkbenchPanel';
import { MethodsCatalogPanel } from '@/features/research/MethodsCatalogPanel';
import { executeResearchAction } from '@/features/research/admission-client';
import { importInvestigationEvidence, loadResearchLedger, lookupOrganizationEvidence, researchContext, saveResearchLedger } from '@/features/research/research-client';

const sections = [
  { id: 'sources', title: 'Snapshots & coverage' }, { id: 'privacy', title: 'Browser privacy' },
  { id: 'email', title: 'Email authenticity' }, { id: 'password', title: 'Password exposure' },
  { id: 'evidence', title: 'Evidence workbench' }, { id: 'methods', title: 'Methods library' },
] as const;
type Section = typeof sections[number]['id'];

export default function ResearchWorkbench() {
  const { user, loading: authLoading } = useAuth();
  const { plan, loading: planLoading, error: planError, refreshSubscription } = useSubscription();
  const usage = useUsageTracking();
  const refreshUsage = usage.refresh;
  const refreshUsageInBackground = useCallback(() => refreshUsage({ background: true }), [refreshUsage]);
  const { data: people = [], error: peopleError, isLoading: peopleLoading } = usePersonas();
  const [params, setParams] = useSearchParams();
  const [section, setSection] = useState<Section>(() => sections.some(item => item.id === params.get('section')) ? params.get('section') as Section : 'sources');
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState(''); const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setPersonaId(null); setPurpose(''); setAuthorized(false); setMessage(''); }, [user?.id]);
  const permissions = getPlanPermissions(plan);
  const loading = authLoading || planLoading || usage.loading;
  const accessError = !user || user.is_anonymous ? 'Sign in to use the research workspace.' : planError || usage.error;
  const blocked = loading || !!accessError;
  const toolGate = checkToolExecutionGate(plan, usage.dailyTotal);
  const toolBlocked = blocked || !toolGate.allowed;
  const reason = loading ? 'Account permissions and daily usage are being checked.' : accessError || (!toolGate.allowed ? toolGate.reason : undefined);
  const person = people.find(row => row.id === personaId);
  const contextKey = researchContext(personaId);
  const actor = user ? `analyst:${user.id}` : 'signed-out';
  const requireAccess = useCallback(() => { if (blocked || !user) throw new Error('Account access could not be verified. Recheck your session.'); return user.id; }, [blocked, user]);
  const requireToolAccess = useCallback(() => { const id = requireAccess(); if (!toolGate.allowed) throw new Error(toolGate.reason); return id; }, [requireAccess, toolGate.allowed, toolGate.reason]);
  const executeLocal: LocalResearchExecutor = useCallback((action, operation, options) => {
    requireToolAccess(); return executeResearchAction(action, operation, { ...options, onUsageRefresh: refreshUsageInBackground });
  }, [requireToolAccess, refreshUsageInBackground]);
  const emailVerifier = useCallback(async (file: File, options?: { signal?: AbortSignal }) => { requireToolAccess(); const result = await verifyEmailMessage(file, options); await refreshUsageInBackground(); return result; }, [requireToolAccess, refreshUsageInBackground]);
  const load = useCallback(() => loadResearchLedger(requireAccess(), personaId), [requireAccess, personaId]);
  const save = useCallback((ledger: EvidenceLedger) => saveResearchLedger(requireAccess(), personaId, ledger, { purpose, authorized }), [requireAccess, personaId, purpose, authorized]);
  const importSaved = useCallback(async () => {
    if (!personaId || !person || !authorized || !purpose.trim()) throw new Error('Select an investigation and record your source authorization first.');
    return importInvestigationEvidence(requireAccess(), personaId, person.persona_label);
  }, [personaId, person, authorized, purpose, requireAccess]);
  const lookup = useCallback(async (lei: string) => { const result = await lookupOrganizationEvidence(requireToolAccess(), lei); await refreshUsageInBackground(); return result; }, [requireToolAccess, refreshUsageInBackground]);
  const changeSection = (next: Section) => { setSection(next); setParams({ section: next }); };
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6" key={user?.id || 'anonymous'}>
    <header className="space-y-3"><p className="text-xs uppercase tracking-wider text-primary">Research and evidence</p><h1 className="text-2xl font-semibold sm:text-3xl">Research Workbench</h1><p className="max-w-4xl text-sm text-muted-foreground">Keep source evidence, coverage and review decisions together. Inspect your browser and passwords privately, verify original email, and explore documented identification methods.</p><p className="text-sm text-muted-foreground">Daily tool usage: {usage.dailyTotal}{permissions.maxToolRunsPerDay > 0 ? ` / ${permissions.maxToolRunsPerDay}` : ''}. Privacy/password, email and registry checks share the existing tool allowance. Evidence editing and monitoring retain their own plan and approved-source controls.</p></header>
    {(reason || accessError) && <div className="rounded-lg border border-amber-500/50 bg-amber-950/30 p-4 text-sm text-amber-100" role={accessError ? 'alert' : 'status'}>{reason || accessError}<button className="ml-3 underline" onClick={() => { void Promise.all([refreshSubscription(), usage.refresh()]).then(() => setMessage('Account checks refreshed.')).catch(() => setMessage('Account checks could not be refreshed.')); }}>Recheck account access</button></div>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    <nav aria-label="Research sections" className="flex flex-wrap gap-2">{sections.map(item => <button key={item.id} className={`rounded-lg border px-3 py-2 text-sm ${section === item.id ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary/30'}`} aria-pressed={section === item.id} onClick={() => changeSection(item.id)}>{item.title}</button>)}</nav>
    {section === 'sources' && <MonitorCoveragePanel />}
    {section === 'privacy' && <BrowserPrivacyPanel execute={executeLocal} disabled={toolBlocked} reason={reason} />}
    {section === 'email' && <EmailAuthenticityPanel verifyMessage={emailVerifier} disabled={toolBlocked} reason={reason} />}
    {section === 'password' && <PrivatePasswordPanel execute={executeLocal} disabled={toolBlocked} reason={reason} />}
    {section === 'methods' && <MethodsCatalogPanel />}
    {section === 'evidence' && <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-4 space-y-3"><h2 className="font-semibold">Workspace and permitted purpose</h2><label className="block text-sm">Saved investigation context<select aria-label="Saved investigation context" className="mt-1 w-full rounded border border-border bg-secondary p-2" value={personaId || ''} onChange={event => { setPersonaId(event.target.value || null); setAuthorized(false); }} disabled={blocked || peopleLoading}><option value="">Separate research workspace</option>{people.map(row => <option key={row.id} value={row.id}>{row.persona_label}</option>)}</select></label>{peopleError && <p role="alert" className="text-sm text-destructive">The investigation list could not be verified; another person’s records will not be loaded.</p>}<label className="block text-sm">Purpose and scope<input aria-label="Purpose and scope" maxLength={500} className="mt-1 w-full rounded border border-border bg-secondary px-3 py-2" value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="What claim are you checking, and which sources are permitted?" /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} />I am authorized to use the selected records and sources for this purpose.</label><p className="text-xs text-muted-foreground">Saving appends a snapshot to your existing account’s records. It does not overwrite prior snapshots. Imports from saved investigations include up to 25 investigator-added source records; no new person lookup runs automatically.</p>{!permissions.canSaveInvestigations && <p className="text-sm text-muted-foreground">Cloud saves require your plan’s investigation-saving permission.</p>}{!permissions.canExportReports && <p className="text-sm text-muted-foreground">Report downloads require your plan’s export permission. The public methods research remains downloadable in Methods library.</p>}</section>
      <EvidenceWorkbenchPanel key={`${actor}:${contextKey}`} contextKey={contextKey} contextLabel={person?.persona_label || 'Separate research workspace'} actor={actor} loadLedger={load} {...(permissions.canSaveInvestigations && authorized && purpose.trim() ? { saveLedger: save } : {})} {...(personaId && person && authorized && purpose.trim() ? { importSavedEvidence: importSaved } : {})} lookupOrganization={lookup} canExport={permissions.canExportReports} canImportFiles={permissions.canUploadArtifacts} disabled={blocked || !!peopleError} reason={blocked ? reason : peopleError ? 'The selected investigation context could not be verified.' : undefined} />
    </div>}
  </div>;
}
