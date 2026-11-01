import { FileSearch, Landmark } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { ToolDefinition } from './types';
import type { PublicRecordResult, PublicRecordTool } from '@/lib/publicRecords';
interface PlateRecordResult { source: string; provider: string; retrieved_at: string; coverage: string; vehicle: Record<string,string>; result: Record<string,unknown>; }

export async function requestPublicRecords<T extends PublicRecordTool | 'vehicle-lookup'>(tool: T, inputs: Record<string, string>): Promise<T extends 'vehicle-lookup' ? PlateRecordResult : PublicRecordResult> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Session could not be checked: ${error.message}`);
  if (!data.session) throw new Error('Sign in to search public records.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch('/api/person-records', { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, inputs }), signal: controller.signal, credentials: 'same-origin' });
    let result;
    try { result = await response.json(); } catch { throw new Error(`Public records returned an invalid response (HTTP ${response.status}).`); }
    if (!response.ok || result?.error) throw new Error(result?.error || `Public-record source returned HTTP ${response.status}.`);
    if (!result || (tool === 'vehicle-lookup' ? !result.vehicle || typeof result.vehicle !== 'object' : !Array.isArray(result.results)) || typeof result.coverage !== 'string' || typeof result.retrieved_at !== 'string') throw new Error('Record response was incomplete. No findings were inferred.');
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Public-record request timed out; no automatic retry was made.');
    throw error;
  } finally { clearTimeout(timer); }
}

export const publicRecordTools: ToolDefinition[] = [
  { id: 'vehicle-lookup', name: 'License Plate to Vehicle — CarsXE', category: 'Vehicle', icon: FileSearch,
    description: 'Use the connected CarsXE account to retrieve the vehicle and VIN where supplied. Each execution uses one plate, state and country. No automatic retries or extra specification charge.',
    integration: { provider: 'CarsXE', scope: 'Provider vehicle fields for a supplied plate. This does not identify a private owner. Uses the existing connected account allowance.' },
    fields: [{ key: 'plate', label: 'License plate', required: true }, { key: 'state', label: 'State / region code', required: true, placeholder: 'TX' }, { key: 'country', label: 'Country code', required: true, placeholder: 'US' }],
    process: async inputs => {
      const details = await requestPublicRecords('vehicle-lookup', inputs);
      return { summary: 'CarsXE vehicle record returned for the supplied plate. Review the vehicle fields and save the source record.', details: { ...details }, tags: ['carsxe', 'vehicle-record'] };
    } },
  { id: 'public-records', name: 'Criminal Dockets & Court Records', category: 'Records', icon: Landmark,
    description: 'Search the existing CourtListener public index directly, without an API key. Federal criminal dockets, other federal cases, and opinions are separate searches.',
    integration: { provider: 'CourtListener', scope: 'Credential-free public federal docket and court opinion searches. Coverage and source availability are checked on execution.', requiredSecrets: [] },
    fields: [
      { key: 'q', label: 'Name or court search query', required: true, placeholder: 'Madoff or docketNumber:"1:09-cr-00213"' },
      { key: 'mode', label: 'Records to search', type: 'select', options: [{ value: 'criminal', label: 'Federal criminal dockets' }, { value: 'dockets', label: 'All federal dockets' }, { value: 'opinions', label: 'Court opinions (federal and state coverage)' }] },
    ], process: async inputs => {
      const details = await requestPublicRecords('public-records', inputs);
      return { summary: `${details.returned} court candidate${details.returned === 1 ? '' : 's'} returned${details.total !== null ? ` from ${details.total} indexed matches` : ''}. Review identity and the original record.`, details: { ...details }, tags: ['public-source', 'court-candidates'] };
    } },
  { id: 'property-records', name: 'Property Owner & Parcel Search', category: 'Vehicle', icon: FileSearch,
    description: 'Retrieve actual owner, property, tax value and source records from official Travis or Williamson County public parcel services. No subscription or API key.',
    fields: [
      { key: 'q', label: 'Owner name, property address or property ID', required: true, placeholder: 'Owner name or street address' },
      { key: 'county', label: 'County coverage', type: 'select', options: [{ value: 'williamson', label: 'Williamson County, Texas' }, { value: 'travis', label: 'Travis County, Texas' }] },
      { key: 'field', label: 'Search by', type: 'select', options: [{ value: 'owner', label: 'Owner name (all supplied words)' }, { value: 'address', label: 'Property address (all supplied words)' }, { value: 'property_id', label: 'Exact property ID' }] },
      { key: 'page', label: 'Result page (1–40; 25 properties per page)', placeholder: '1' },
    ], process: async inputs => {
      const details = await requestPublicRecords('property-records', inputs);
      return { summary: `${details.returned} property record${details.returned === 1 ? '' : 's'} returned on page ${details.page}${details.has_more ? '; more source records are available on the next page' : ''}. Owner-name associations require review.`, details: { ...details }, tags: ['official-county-source', 'property-candidates'] };
    } },
];
