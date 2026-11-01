import { useEffect, useRef, useState } from "react";
import type { EmailVerificationResult, EmailVerifier } from "./email-client";

const labels: Record<string, string> = {
  aligned_signature: "A full-body DKIM signature aligns with the From domain",
  signature_valid_unaligned: "A signature verifies, but strict From alignment is not established",
  partial_signature: "A signature verifies only a body-length-limited message",
  verification_failed: "DKIM verification failed",
  unsigned: "No DKIM signature was found",
  inconclusive: "An authentication conclusion could not be established",
};
const errors: Record<string, string> = {
  UNAUTHORIZED: "Sign in again before verifying an EML file.", EMAIL_TOO_LARGE: "Choose a nonempty EML file no larger than 256 KiB.",
  CONSENT_REQUIRED: "Confirm permission for server processing and DKIM DNS queries.", INVALID_EMAIL: "Choose an original, complete EML file with headers and body.",
  VERIFICATION_TIMEOUT: "Verification timed out. No authentication conclusion is available.", TOO_MANY_SIGNATURES: "This message exceeds the bounded signature limit.",
  DAILY_LIMIT: "The daily tool allowance has been reached. Email verification did not run; wait for the allowance to reset.",
  FORBIDDEN: "An administrator has disabled email verification for this account. No email verification ran.",
  ACCOUNTING_FAILED: "Verification completed, but its usage accounting could not be confirmed. No result is shown and no automatic retry was made.",
  ACCOUNTING_RELEASE_FAILED: "Verification failed and its reservation release could not be confirmed. The pending reservation expires after two minutes; no automatic retry was made.",
  ADMISSION_FAILED: "Account permission and tool allowance could not be confirmed. Email verification did not run.",
  BACKEND_UNAVAILABLE: "Account access or usage accounting is unavailable. No successful verification result can be confirmed.",
  AUTH_CONFIGURATION: "Email verification is unavailable because account authentication is not configured.",
  ACCOUNT_TIMEOUT: "Session verification timed out before the email request was sent. No automatic retry was made.",
  RESEARCH_CANCELLED: "Verification was cancelled or timed out. The server may already have completed the operation; no automatic retry was made.",
};
const safeDomain = (value: unknown) => typeof value === "string" && value.length <= 253 && /^[a-z0-9.-]+$/i.test(value) ? value : "unavailable";

export function EmailAuthenticityPanel({ verifyMessage, disabled = false, reason }: { verifyMessage?: EmailVerifier; disabled?: boolean; reason?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EmailVerificationResult | null>(null);
  const active = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => active.current?.abort(), []);
  const cancel = () => { active.current?.abort(); active.current = null; setBusy(false); };
  const clear = () => { cancel(); setFile(null); setConsent(false); setError(""); setResult(null); if (input.current) input.current.value = ""; };
  const check = async () => {
    if (!file || !consent || busy || disabled) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      // The override lets another app use its own authentication without copying
      // session tokens or coupling this component to a particular auth provider.
      const verify = verifyMessage ?? (await import("./email-client")).verifyEmailMessage;
      if (controller.signal.aborted) return;
      const checked = await verify(file, { signal: controller.signal });
      if (!controller.signal.aborted) setResult(checked);
    } catch (failure) {
      if (!controller.signal.aborted) {
        const code = failure && typeof failure === "object" && "code" in failure ? String(failure.code) : "";
        setError(errors[code] || "The EML could not be verified. No authentication conclusion is available.");
      }
    } finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };
  return <section aria-labelledby="email-auth-title" className="rounded-lg border border-border bg-card p-4 space-y-4">
    <div><h2 id="email-auth-title" className="text-lg font-semibold">Email authenticity</h2>
      <p className="text-sm text-muted-foreground">Verify DKIM signatures over an original EML file and compare its signing domain with the From domain. This does not identify a person or show that a message is safe.</p></div>
    {disabled && <p role="status" className="text-sm text-muted-foreground">{reason || "Email verification is disabled by the current account policy."}</p>}
    <label className="block text-sm">Original EML file (maximum 256 KiB)
      <input ref={input} aria-label="Original EML file" type="file" accept=".eml,message/rfc822" disabled={disabled || busy} className="mt-2 block max-w-full text-sm" onChange={event => {
        cancel(); setResult(null); setError(""); setConsent(false);
        const selected = event.target.files?.[0] || null;
        if (selected && (!selected.size || selected.size > 262144)) { setFile(null); setError(errors.EMAIL_TOO_LARGE); } else setFile(selected);
      }} /></label>
    {file && <p className="text-xs text-muted-foreground">Selected: {file.size.toLocaleString()} bytes. Message content is not previewed.</p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy || disabled} onChange={event => setConsent(event.target.checked)} />
      <span>I have permission to send this email to the server for processing and query its DKIM DNS records. This tool does not save the uploaded message.</span></label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!file || !consent || busy || disabled} onClick={() => void check()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{busy ? "Verifying…" : "Verify DKIM"}</button>
      {busy && <button type="button" onClick={cancel} className="rounded border px-3 py-2 text-sm">Cancel verification</button>}
      <button type="button" onClick={clear} className="rounded border px-3 py-2 text-sm">Clear email and result</button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <div aria-live="polite" className="space-y-3 text-sm">
      <p className="font-medium">{labels[result.status] || labels.inconclusive}</p>
      <p>From domain: <span className="break-all font-mono">{safeDomain(result.fromAlignment.fromDomain)}</span>. Strict alignment: {result.fromAlignment.status === "aligned" ? "established for a full-body signature" : result.fromAlignment.status === "ambiguous_or_invalid" ? "ambiguous or invalid From header" : "not established"}.</p>
      {result.dkim.dnsUnavailable && <p>DNS was unavailable for part of this check. This is not evidence that the message was forged.</p>}
      <ul className="space-y-2">{result.dkim.signatures.slice(0, 20).map((signature, index) => <li key={index} className="rounded border p-3 space-y-1">
        <p className="break-all">Signing domain: <span className="font-mono">{safeDomain(signature.signingDomain)}</span></p>
        <p>Cryptographic result: {['pass', 'fail', 'neutral', 'policy', 'temperror', 'none'].includes(signature.result) ? signature.result : 'unknown'}. Full body coverage: {signature.fullBodyCovered ? "yes" : "not established"}.</p>
        <p>Strict signing-domain match: {signature.strictFromAligned ? "yes (separate from validity)" : "no"}.</p>
        {signature.bodyLengthLimited && <p>Warning: this signature uses a body-length limit; {signature.unsignedBodyTail ? "an unsigned body tail is present." : "full-message authenticity is not established."}</p>}
        {signature.testingKey && <p>The signing domain marks this key as a testing key.</p>}
      </li>)}</ul>
      <p>Uploaded Authentication-Results, Received-SPF and ARC claims are untrusted receiver assertions. They are never promoted to a verified pass.</p>
      <p>SPF, DMARC and ARC: not independently verified. Trusted SMTP envelope and receiver evidence were not supplied.</p>
      <p className="text-xs text-muted-foreground">Current DNS keys are used. Historical key removal or rotation can make an older message unverifiable. No message body, subject or recipients are included in this result.</p>
    </div>}
  </section>;
}
export default EmailAuthenticityPanel;
