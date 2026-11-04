import assert from 'node:assert/strict';

// Git may convert repository LF line endings to CRLF on Windows. Permit only
// that checkout transformation: spaces, bare CRs and all source content remain
// significant. Raw installed-upstream hash checks are deliberately separate.
export function assertCheckoutText(actual, expected, message) {
  assert.equal(actual.replace(/\r\n/g, '\n'), expected.replace(/\r\n/g, '\n'), message);
}
