import { describe, expect, it } from "vitest";
import { normalizePdlResult } from "./pdlResults";

describe("PDL availability flags", () => {
  it("does not present boolean flags as actual emails or locations", () => {
    const result = normalizePdlResult({matches:[{full_name:"fixture",work_email:true,location_name:true}]});
    expect(result.matches[0].work_email).toBeNull();
    expect(result.matches[0].location_name).toBeNull();
    expect(result.matches[0]).toHaveProperty("provider_field_availability.work_email",true);
    expect(result.matches[0]).toHaveProperty("provider_notice");
  });
  it("preserves real values, pagination booleans and original raw evidence", () => {
    const original = {work_email:"fixture@example.com",mobile_phone:false,has_more:true,raw:{mobile_phone:false}};
    const result = normalizePdlResult(original);
    expect(result.work_email).toBe("fixture@example.com");
    expect(result.has_more).toBe(true);
    expect(result.raw).toBe(original.raw);
    expect(original.mobile_phone).toBe(false);
    expect(result.mobile_phone).toBeNull();
  });
});
