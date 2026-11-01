import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmailAuthenticityPanel } from "./EmailAuthenticityPanel";
import type { EmailVerificationResult, EmailVerifier } from "./email-client";

const result: EmailVerificationResult = {
  status: "aligned_signature", dkim: { cryptographicPass: true, dnsUnavailable: false, dnsQueries: 1, signatures: [{ signingDomain: "example.com", selector: "fixture", algorithm: "rsa-sha256", result: "pass", fullBodyCovered: true, bodyLengthLimited: false, unsignedBodyTail: false, strictFromAligned: true, testingKey: false }] },
  fromAlignment: { mode: "strict", fromDomain: "example.com", status: "aligned" }, uploadedReceiverClaims: { trust: "untrusted", authenticationResultsPresent: true, receivedSpfPresent: true, arcHeadersPresent: false }, spf: "not_verified", dmarc: "not_verified", arc: "not_verified", checkedAt: "2026-11-01T12:00:00Z", limitations: [],
};
function choose() {
  const file = new File(["Subject: PRIVATE_SUBJECT\r\nTo: PRIVATE_RECIPIENT\r\n\r\nPRIVATE_BODY"], "fixture.eml", { type: "message/rfc822" });
  fireEvent.change(screen.getByLabelText("Original EML file"), { target: { files: [file] } });
  return file;
}
describe("portable EML authenticity panel", () => {
  it("requires a file and explicit consent, sends only on action, and renders no private message content", async () => {
    const verifyMessage = vi.fn<EmailVerifier>().mockResolvedValue(result);
    render(<EmailAuthenticityPanel verifyMessage={verifyMessage} />);
    expect(screen.getByRole("button", { name: "Verify DKIM" })).toBeDisabled();
    const file = choose();
    expect(verifyMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Verify DKIM" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Verify DKIM" }));
    await screen.findByText("A full-body DKIM signature aligns with the From domain");
    expect(verifyMessage).toHaveBeenCalledWith(file, { signal: expect.any(AbortSignal) });
    expect(document.body.textContent).not.toMatch(/PRIVATE_SUBJECT|PRIVATE_RECIPIENT|PRIVATE_BODY/);
    expect(screen.getByText(/SPF, DMARC and ARC: not independently verified/)).toBeInTheDocument();
    expect(screen.getByText(/are untrusted receiver assertions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear email and result" }));
    expect(screen.queryByText("A full-body DKIM signature aligns with the From domain")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("does not accept an oversized file or disclose raw errors", async () => {
    const verifyMessage = vi.fn<EmailVerifier>().mockRejectedValue(new Error("private-token@example.com PRIVATE_BODY"));
    render(<EmailAuthenticityPanel verifyMessage={verifyMessage} />);
    fireEvent.change(screen.getByLabelText("Original EML file"), { target: { files: [new File([new Uint8Array(262145)], "large.eml")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("256 KiB"); expect(verifyMessage).not.toHaveBeenCalled();
    choose(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Verify DKIM" }));
    await screen.findByRole("alert");
    expect(document.body.textContent).not.toMatch(/private-token|PRIVATE_BODY/);
  });
  it("cancel and unmount abort the request and discard late results", async () => {
    let resolve!: (value: EmailVerificationResult) => void;
    const verifyMessage = vi.fn<EmailVerifier>(() => new Promise(done => { resolve = done; }));
    const view = render(<EmailAuthenticityPanel verifyMessage={verifyMessage} />);
    choose(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Verify DKIM" }));
    await waitFor(() => expect(verifyMessage).toHaveBeenCalledTimes(1));
    const signal = verifyMessage.mock.calls[0][1]!.signal!;
    fireEvent.click(screen.getByRole("button", { name: "Cancel verification" }));
    expect(signal.aborted).toBe(true); resolve(result);
    await waitFor(() => expect(screen.getByRole("button", { name: "Verify DKIM" })).toBeEnabled());
    expect(screen.queryByText("A full-body DKIM signature aligns with the From domain")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify DKIM" }));
    await waitFor(() => expect(verifyMessage).toHaveBeenCalledTimes(2));
    const unmountSignal = verifyMessage.mock.calls[1][1]!.signal!; view.unmount(); expect(unmountSignal.aborted).toBe(true); resolve(result);
  });
  it("disables collection and execution for policy while keeping clear and active cancellation accessible", async () => {
    const verifyMessage = vi.fn<EmailVerifier>(() => new Promise(() => {}));
    const view = render(<EmailAuthenticityPanel verifyMessage={verifyMessage} disabled reason="Disabled by the current tool policy." />);
    expect(screen.getByLabelText("Original EML file")).toBeDisabled(); expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify DKIM" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Clear email and result" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Disabled by the current tool policy.");
    view.rerender(<EmailAuthenticityPanel verifyMessage={verifyMessage} />);
    choose(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Verify DKIM" }));
    await waitFor(() => expect(verifyMessage).toHaveBeenCalledTimes(1));
    view.rerender(<EmailAuthenticityPanel verifyMessage={verifyMessage} disabled />);
    expect(screen.getByRole("button", { name: "Cancel verification" })).toBeEnabled(); expect(screen.getByRole("button", { name: "Clear email and result" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear email and result" }));
    expect(verifyMessage.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it.each([
    ["DAILY_LIMIT", "daily tool allowance"], ["FORBIDDEN", "administrator has disabled"],
    ["ACCOUNTING_FAILED", "usage accounting could not be confirmed"], ["ACCOUNTING_RELEASE_FAILED", "reservation release could not be confirmed"],
  ])("explains %s as an account/execution condition rather than invalid email", async (code, phrase) => {
    render(<EmailAuthenticityPanel verifyMessage={vi.fn<EmailVerifier>().mockRejectedValue({ code, message: "PRIVATE_SERVER_ERROR" })} />);
    choose(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Verify DKIM" }));
    const alert = await screen.findByRole("alert"); expect(alert).toHaveTextContent(phrase); expect(alert).not.toHaveTextContent("PRIVATE_SERVER_ERROR");
  });
});
