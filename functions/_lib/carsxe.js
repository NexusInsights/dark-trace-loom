const SOURCE = 'https://api.carsxe.com/v2/platedecoder';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

export async function lookupPlate(inputs, key, fetcher = fetch) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('CarsXE deployment credential is not configured.');
  const plate = text(inputs.plate).toUpperCase().replace(/\s+/g, ' ');
  const state = text(inputs.state).toUpperCase(); const country = text(inputs.country).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{0,14}$/.test(plate) || !/^[A-Z0-9-]{2,5}$/.test(state) || !/^[A-Z]{2}$/.test(country)) throw new Error('Provide a valid plate, state/region and two-letter country code. A state is required to prevent multi-jurisdiction billing.');
  const url = new URL(SOURCE); url.searchParams.set('key', key); url.searchParams.set('plate', plate); url.searchParams.set('state', state); url.searchParams.set('country', country);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000);
  try {
    let response;
    try { response = await fetcher(url.href, { headers: { Accept: 'application/json', 'Idempotency-Key': crypto.randomUUID() }, signal: controller.signal, redirect: 'manual' }); }
    catch { throw new Error('CarsXE request failed before a response was received. It was not retried; check provider usage before retrying.'); }
    if (Number(response.headers.get('Content-Length') || 0) > 500000) throw new Error('CarsXE returned an unexpectedly large response. No automatic retry was made.');
    let data;
    try { data = await response.json(); } catch { throw new Error(`CarsXE returned invalid JSON (HTTP ${response.status}); no automatic retry was made.`); }
    const safeMessage = text(data?.message || data?.error).split(key).join('[REDACTED]').replace(/https?:\/\/\S+/g, '[provider URL]').slice(0, 300);
    if (!response.ok || data?.success === false || data?.error || data?.errors) throw new Error(`CarsXE HTTP ${response.status}: ${safeMessage || 'lookup rejected; check account entitlement, credits and plate coverage'}. No automatic retry was made.`);
    const body = object(data); const nested = object(body.data || body.vehicle || body.result); const record = Object.keys(nested).length ? nested : body;
    const attributes = object(record.attributes);
    const pick = names => names.map(name => text(record[name] || attributes[name])).find(Boolean) || '';
    const vehicle = {
      plate, state, country,
      vin: pick(['vin','VIN','Vin','VehicleIdentificationNumber']),
      make: pick(['make','Make','CarMake','carMake']), model: pick(['model','Model','CarModel','carModel']),
      year: pick(['year','Year','registration_year','ModelYear','model_year','RegistrationYear']),
      description: pick(['description','Description']), body_style: pick(['body_style','body_type','BodyStyle']),
      fuel_type: pick(['fuel_type','fuel','FuelType']), color: pick(['color','colour','Colour']),
    };
    if (![vehicle.vin,vehicle.make,vehicle.model,vehicle.year,vehicle.description].some(Boolean)) throw new Error('CarsXE returned no recognizable vehicle fields. No vehicle association was inferred.');
    function scrub(value, depth = 0) {
      if (depth > 8) return '[depth limit]';
      if (typeof value === 'string') return value.split(key).join('[REDACTED]');
      if (Array.isArray(value)) return value.slice(0, 100).map(item => scrub(item, depth + 1));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([name]) => !/api.?key|secret|token|authorization|^key$/i.test(name)).map(([name,item]) => [name,scrub(item,depth+1)]));
      return value;
    }
    return { source: SOURCE, provider: 'CarsXE Plate Decoder v2', retrieved_at: new Date().toISOString(), coverage: 'Provider-reported vehicle fields for the supplied plate, state and country. This does not retrieve private owner identity or prove the investigated person owns the vehicle. Provider coverage varies. One request; no automatic retry or extra VIN specification call.', vehicle, result: scrub(data) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('CarsXE timed out; no automatic retry was made. Check provider usage before retrying.');
    throw error;
  } finally { clearTimeout(timer); }
}
