// Polyfills for Create.xyz environment
if (typeof globalThis.process === 'undefined') {
  (globalThis as any).process = { env: {} };
}
