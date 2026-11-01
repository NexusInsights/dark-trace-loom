import { describe, expect, it } from "vitest";
import { marketplaceImplementation, marketplaceUnavailableReason } from "./marketplaceTools";

describe("marketplace execution resolution", () => {
  it("resolves explicit aliases and exact implementation IDs", () => {
    expect(marketplaceImplementation({slug:"email-header"})?.id).toBe("email-header-analysis");
    expect(marketplaceImplementation({slug:"subdomain-enum"})?.id).toBe("subdomain-enum");
    expect(marketplaceImplementation({slug:"phone-intel"})?.id).toBe("phone-lookup");
  });
  it("does not substitute a weaker tool for an unsupported advertised capability", () => {
    expect(marketplaceImplementation({slug:"port-scanner-pro"})?.integration?.provider).toBe("Cloudflare TCP sockets");
    expect(marketplaceImplementation({slug:"port-scanner-pro"})?.fields.some(field => field.key === "authorization_confirmed")).toBe(true);
    expect(marketplaceImplementation({slug:"facial-recognition"})).toBeUndefined();
    expect(marketplaceImplementation({slug:"geofence-alert"})?.fields.some(field=>field.key==='authorization_confirmed')).toBe(true);
    expect(marketplaceUnavailableReason("facial-recognition")).toContain("No face-to-person");
    expect(marketplaceUnavailableReason("geofence-alert")).toContain("persistent event worker");
  });
  it("resolves actual new provider adapters and supplied-input analyzers", () => {
    expect(marketplaceImplementation({slug:"public-records"})?.integration?.provider).toBe("CourtListener");
    expect(marketplaceImplementation({slug:"document-forensics"})?.fields.some(field => field.type === "file")).toBe(true);
    expect(marketplaceImplementation({slug:"network-forensics"})?.id).toBe("network-forensics");
    expect(marketplaceImplementation({slug:"geolocation-analyzer"})?.name).toBe("Image EXIF Geolocation");
  });
});
