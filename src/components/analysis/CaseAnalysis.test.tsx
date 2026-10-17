import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ report: {
  id: 'synthetic-report', analysis_type: 'full', created_at: '2026-10-16T12:00:00Z',
  generated_summary: 'Synthetic summary', narrative_draft: null,
  key_findings: [{ finding: 'Synthetic finding', evidence: 'Local fixture', severity: 'low' }],
  suspicious_patterns: [{ pattern: 'Synthetic pattern', indicators: 'Fixture only', risk_level: 'low' }],
  key_relationships: [{ from_entity: 'A', to_entity: 'B', relationship: 'fixture', significance: 'Synthetic relationship' }],
} }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [fixture.report], isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'synthetic-user' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { CaseAnalysis } from './CaseAnalysis';

describe('typed report rendering', () => {
  it('opens a stored report and renders its findings, patterns and relationships', () => {
    render(<CaseAnalysis caseId="synthetic-case" />);
    fireEvent.click(screen.getByRole('button', { name: /Full Analysis/ }));
    expect(screen.getByText('Synthetic finding')).toBeInTheDocument();
    expect(screen.getByText('Synthetic pattern')).toBeInTheDocument();
    expect(screen.getByText('Synthetic relationship')).toBeInTheDocument();
    expect(screen.getByText('Synthetic summary')).toBeInTheDocument();
  });
});
