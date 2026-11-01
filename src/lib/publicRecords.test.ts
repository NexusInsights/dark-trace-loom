import { describe, expect, it, vi } from 'vitest';
import { lookupPublicRecords } from './publicRecords';

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('credential-free public records', () => {
  it('queries actual criminal dockets without an API credential and preserves dates and source links', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ count: 2, next: null, results: [{ caseName: 'United States v. Madoff', docketNumber: '1:09-cr-00213', docket_absolute_url: '/docket/4346206/united-states-v-madoff/', dateFiled: '2009-03-10', dateTerminated: '2009-06-29', court: 'District Court, S.D. New York' }] }));
    const result = await lookupPublicRecords('public-records', { q: 'Madoff', mode: 'criminal' }, fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).searchParams.get('q')).toContain('docketNumber:cr');
    expect(new URL(url).searchParams.get('type')).toBe('d');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(init.redirect).toBe('manual');
    expect(result.results[0]).toMatchObject({ title: 'United States v. Madoff', source_url: 'https://www.courtlistener.com/docket/4346206/united-states-v-madoff/', dateFiled: '2009-03-10', disposition: 'Not supplied by this search' });
    expect(result.coverage).toContain('not a conviction');
  });
  it('queries official owner data with escaped literals, scoped fields and no geometry', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ exceededTransferLimit: true, features: [{ attributes: { OBJECTID: 544, PropertyID: '148839', OWNERNME1: 'CITY OF GEORGETOWN', SITEADDRESS: '101 RAINTREE DR', CNTASSDVAL: 0, LASTUPDATE: 1792302965000 } }] }));
    const result = await lookupPublicRecords('property-records', { q: "O'NEIL", county: 'williamson', field: 'owner' }, fetcher);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.hostname).toBe('services1.arcgis.com');
    expect(url.searchParams.get('where')).toContain("O''NEIL");
    expect(url.searchParams.get('returnGeometry')).toBe('false');
    expect(result.results[0]).toMatchObject({ property_id: '148839', owner: 'CITY OF GEORGETOWN', assessed_value: 0 });
    expect(result.has_more).toBe(true);
  });
  it('maps Travis county fields without using retrieval time as a deed date', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ features: [{ attributes: { OBJECTID: 12, PROP_ID: 99, py_owner_name: 'CITY OF AUSTIN', situs_address: 'PUBLIC PROPERTY', assessed_val: 12000, deed_date: null } }] }));
    const result = await lookupPublicRecords('property-records', { q: 'CITY OF AUSTIN', county: 'travis', field: 'owner' }, fetcher);
    expect(result.results[0]).toMatchObject({ property_id: '99', owner: 'CITY OF AUSTIN', assessed_value: 12000, deed_date: null });
  });
  it.each([{ q: '%' }, { q: 'abc', field: 'OWNERNME1); DROP TABLE' }, { q: 'abc', county: 'https://localhost' }, { q: 'abc', page: '99999' }])('rejects unscoped property input before any network call: %j', async inputs => {
    const fetcher = vi.fn();
    await expect(lookupPublicRecords('property-records', inputs, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('distinguishes upstream failure and schema changes from no records', async () => {
    await expect(lookupPublicRecords('public-records', { q: 'Madoff' }, vi.fn().mockResolvedValue(reply({ detail: 'throttled' }, 429)))).rejects.toThrow('429');
    await expect(lookupPublicRecords('property-records', { q: 'Madoff' }, vi.fn().mockResolvedValue(reply({ error: { message: 'Query not supported' } })))).rejects.toThrow('Query not supported');
    await expect(lookupPublicRecords('public-records', { q: 'Madoff' }, vi.fn().mockResolvedValue(reply({ count: 0 })))).rejects.toThrow('schema');
  });
  it('returns an explicit empty result without asserting a clean history', async () => {
    const result = await lookupPublicRecords('public-records', { q: 'Unmatched Fixture' }, vi.fn().mockResolvedValue(reply({ count: 0, next: null, results: [] })));
    expect(result.results).toEqual([]); expect(result.coverage).toContain('No match');
  });
  it('uses the Workers-supported redirect policy and refuses redirects instead of following them', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      if (init?.redirect !== 'manual') throw new TypeError('Workers supports only follow or manual');
      return new Response('', { status: 302, headers: { Location: 'https://other.test/' } });
    });
    await expect(lookupPublicRecords('public-records', { q: 'Madoff' }, fetcher)).rejects.toThrow('HTTP 302');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects unsafe or unexpected court record paths and strips source HTML from snippets', async () => {
    const result = await lookupPublicRecords('public-records', { q: 'Madoff', mode: 'opinions' }, vi.fn().mockResolvedValue(reply({ count: 2, results: [{ caseName: 'Bad', absolute_url: '//evil.test/opinion/1/' }, { caseName: 'Case', absolute_url: '/opinion/123/case/', dateFiled: '2009-03-10', opinions: [{ snippet: '<mark>Source text</mark>' }] }] })));
    expect(result.results).toHaveLength(1); expect(result.results[0].snippet).toBe('Source text');
  });
});
