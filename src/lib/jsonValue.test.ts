import { describe, it, expect } from 'vitest';
import { jsonValue, textRecords } from './jsonValue';

describe('database and analysis JSON boundaries', () => {
  it('preserves actual JSON and refuses nonserializable root/cyclic input', () => {
    const input = { count: 2, findings: ['synthetic'], optional: undefined };
    expect(jsonValue(input)).toEqual({ count: 2, findings: ['synthetic'] });
    expect(() => jsonValue(undefined)).toThrow('Expected a JSON value');
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => jsonValue(cyclic)).toThrow();
  });
  it('retains valid report fields and does not render arbitrary nested objects', () => {
    expect(textRecords([{ finding: 'Synthetic finding', severity: 'low', unexpected: { nested: true } }, null, 'invalid']))
      .toEqual([{ finding: 'Synthetic finding', severity: 'low' }]);
    expect(textRecords('not an array')).toEqual([]);
  });
});
