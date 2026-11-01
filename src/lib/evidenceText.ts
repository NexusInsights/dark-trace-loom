/** Extract saved observations without promoting AI interpretation or generated candidates. */
export function evidenceText(raw: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return raw; }
  const excluded = /^(ai_interpretation|intel|interpretation|recommendations?|suggestions?|candidates?|username_candidates|email_candidates|confidence|confidence_score|summary|tags|reason|description)$/i;
  function collect(value: unknown, key = ""): string[] {
    if (excluded.test(key)) return [];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(item => collect(item));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([name,item]) => collect(item,name));
    return [];
  }
  return collect(parsed).join("\n");
}
