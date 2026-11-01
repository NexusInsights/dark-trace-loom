import { describe, expect, it } from 'vitest';
import { buildPersonDossier, dossierMarkdown } from './personDossier';
const record = (tool_name: string, details: unknown) => ({ id: 'record', tool_name, created_at: '2026-10-18T14:00:00Z', result_data: { details } });
describe('court and property findings in dossiers', () => {
  it('exports docket sources and uses filing time without calling termination a conviction', () => {
    const dossier = buildPersonDossier([], [record('public-records', { results: [{ title: 'United States v. Public Fixture', kind: 'criminal_docket', source_url: 'https://www.courtlistener.com/docket/123/fixture/', dateFiled: '2009-03-10', dateTerminated: '2009-06-29', disposition: 'Not supplied by this search', docketNumber: '1:09-cr-123' }] })]);
    expect(dossier.events).toHaveLength(1); expect(dossier.events[0].occurredAt).toBe('2009-03-10'); expect(dossier.events[0].title).toContain('Court case filed');
    const report = dossierMarkdown('Public fixtures', dossier); expect(report).toContain('courtlistener.com/docket/123/fixture/'); expect(report).toContain('Not supplied by this search'); expect(report).not.toContain('convicted');
  });
  it('exports actual owner and value fields but does not turn county updates into life events', () => {
    const dossier = buildPersonDossier([], [record('property-records', { results: [{ title: 'PUBLIC PROPERTY', kind: 'property', owner: 'CITY OF GEORGETOWN', property_id: '148839', county: 'Williamson County, Texas', assessed_value: 0, source_updated_at: '2026-10-18T04:00:00Z', source_url: 'https://services1.arcgis.com/example/query?objectIds=544' }] })]);
    expect(dossier.events).toHaveLength(0); const report = dossierMarkdown('Public fixtures', dossier); expect(report).toContain('CITY OF GEORGETOWN'); expect(report).toContain('assessed value: 0'); expect(report).toContain('person association unverified');
  });
});
