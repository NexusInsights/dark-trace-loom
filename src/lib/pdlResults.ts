const valueFields = new Set([
  "full_name", "job_title", "job_company_name", "job_company_website", "location_name",
  "linkedin_url", "twitter_url", "facebook_url", "github_url", "work_email",
  "emails", "personal_emails", "recommended_personal_email", "mobile_phone", "phone_numbers", "phones", "industry", "skills",
  "street_addresses", "location_street_address", "location_address_line_2", "location_postal_code",
  "location_locality", "location_region", "location_country", "location_geo", "location_names",
  "possible_emails", "possible_phones", "possible_street_addresses", "possible_location_names", "profiles",
  "experience", "education", "name", "display_name", "website", "summary", "location",
]);

/** PDL can return boolean availability flags instead of the underlying field values. */
export function normalizePdlResult<T extends Record<string, unknown>>(result: T): T {
  const normalize = (record: Record<string, unknown>): Record<string, unknown> => {
    const copy = { ...record };
    const availability: Record<string, boolean> = typeof copy.provider_field_availability === "object" && copy.provider_field_availability !== null
      ? {...copy.provider_field_availability as Record<string, boolean>} : {};
    for (const [field,value] of Object.entries(copy)) {
      if (valueFields.has(field) && typeof value === "boolean") {
        availability[field] = value;
        copy[field] = null;
      }
    }
    if (Object.keys(availability).length) {
      copy.provider_field_availability = availability;
      copy.provider_notice = "PDL returned preview/redacted fields rather than their values. The API key controls Preview Search access; full contact data requires a PDL key entitled to those fields. No request parameter can reconstruct withheld values.";
    }
    return copy;
  };
  const normalized = normalize(result);
  if (Array.isArray(result.matches)) {
    normalized.matches = result.matches.map(record => record && typeof record === "object" ? normalize(record) : record);
  }
  // Preserve raw provider evidence without interpreting its flags as contact data.
  return normalized as T;
}
