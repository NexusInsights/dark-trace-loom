type RecordData = Record<string, unknown>;
const record = (value: unknown): RecordData => value && typeof value === "object" && !Array.isArray(value) ? value as RecordData : {};
const strings = (value: unknown): string[] => typeof value === "string" && value.trim() ? [value.trim()] : Array.isArray(value) ? value.flatMap(strings) : [];
const unique = (values: string[]) => [...new Set(values)];

/** Extract supplied values only. Availability flags and possible matches are not contacts. */
export function pdlContacts(data: RecordData) {
  const raw = record(data.raw);
  const d = {...raw, ...data};
  const emails = unique([
    ...strings(d.work_email), ...strings(d.personal_emails), ...strings(d.recommended_personal_email),
    ...(Array.isArray(d.emails) ? d.emails.flatMap(value => strings(record(value).address)) : []),
  ]);
  const phones = unique([
    ...strings(d.mobile_phone), ...strings(d.phone_numbers),
    ...(Array.isArray(d.phones) ? d.phones.flatMap(value => strings(record(value).number)) : []),
  ]);
  const address = (value: RecordData, prefix = "") => {
    const street = strings(value[`${prefix}street_address`]);
    // A city/region alone is a location, not a supplied street address.
    if (!street.length) return [];
    return [[...street, ...strings(value[`${prefix}address_line_2`]), ...strings(value[`${prefix}locality`]),
      ...strings(value[`${prefix}region`]), ...strings(value[`${prefix}postal_code`]), ...strings(value[`${prefix}country`])].join(", ")];
  };
  const addresses = unique([...address(d, "location_"), ...(Array.isArray(d.street_addresses) ? d.street_addresses.flatMap(value => address(record(value))) : [])]);
  const flags = {...record(raw.provider_field_availability), ...record(data.provider_field_availability)};
  for (const [field, value] of Object.entries(raw)) if (typeof value === "boolean") flags[field] = value;
  return {emails, phones, addresses, flags};
}

export function pdlPersonRecords(data: RecordData): RecordData[] {
  return Array.isArray(data.matches) ? data.matches.map(record) : [data];
}
