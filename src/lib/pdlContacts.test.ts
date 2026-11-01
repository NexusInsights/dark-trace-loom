import { describe, expect, it } from "vitest";
import { pdlContacts } from "./pdlContacts";
import { normalizePdlResult } from "./pdlResults";

describe("PDL contact rendering", () => {
  it("preserves actual supplied email, phone and street address values", () => {
    const data = {work_email:"fixture@example.com",emails:[{address:"fixture@example.com"},{address:"personal@example.com"}],phone_numbers:["+15555550100"],street_addresses:[{street_address:"123 Fixture St",locality:"Fixture City",region:"TX",postal_code:"00000",country:"US"}]};
    expect(pdlContacts(normalizePdlResult(data))).toMatchObject({emails:["fixture@example.com","personal@example.com"],phones:["+15555550100"],addresses:["123 Fixture St, Fixture City, TX, 00000, US"]});
  });
  it("never turns flags, possible contacts, or a city into actual contacts", () => {
    const contact = pdlContacts(normalizePdlResult({emails:true,phones:true,street_addresses:true,location_name:"Fixture City",possible_emails:[{address:"uncertain@example.com"}]}));
    expect(contact.emails).toEqual([]);
    expect(contact.phones).toEqual([]);
    expect(contact.addresses).toEqual([]);
    expect(contact.flags).toMatchObject({emails:true,phones:true,street_addresses:true});
  });
  it("supports older saved enrichment records and idempotent normalization", () => {
    const first = normalizePdlResult({work_email:true,raw:{phone_numbers:["+15555550100"],location_street_address:"123 Fixture St"}});
    expect(normalizePdlResult(first)).toEqual(first);
    expect(pdlContacts(first).phones).toEqual(["+15555550100"]);
    expect(pdlContacts(first).addresses).toEqual(["123 Fixture St"]);
  });
});
