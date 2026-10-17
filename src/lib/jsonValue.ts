import type { Json } from '@/integrations/supabase/types';

/** Use the same JSON boundary as the database transport, with an explicit result type. */
export function jsonValue(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Expected a JSON value');
  return JSON.parse(serialized) as Json;
}

/** Analysis reports are JSON; malformed nested objects must not become React children. */
export function textRecords(value: Json): Record<string, string>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is { [key: string]: Json } =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  ).map(entry => Object.fromEntries(Object.entries(entry)
    .filter(([, item]) => typeof item === 'string')
    .map(([key, item]) => [key, item as string])));
}
