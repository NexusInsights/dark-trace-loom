// Pinned Stripe Basil removed subscription-level period fields. Older saved
// events can still carry them; use an item period whenever it is present.
export const PLAN_MAP: Readonly<Record<string, string>> = Object.freeze({
  prod_U7cQdUjRIZLpaD: "professional",
  prod_U7cSMflIeLynmi: "team",
  prod_U7cSZe7C3SrSuh: "enterprise",
});

type SubscriptionShape = {
  current_period_end?: unknown;
  items?: { data?: Array<{ current_period_end?: unknown; price?: { product?: unknown } }> };
};

export function subscriptionState(sub: SubscriptionShape): { plan: string; periodEnd: string } {
  const items = sub.items?.data;
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new Error("Subscription items are invalid");
  const matched = items.flatMap((item) => {
    const reference = item?.price?.product;
    const productId = typeof reference === "string" ? reference : reference && typeof reference === "object" ? (reference as { id?: unknown }).id : null;
    if (typeof productId !== "string" || !Object.prototype.hasOwnProperty.call(PLAN_MAP, productId)) return [];
    const period = item.current_period_end ?? sub.current_period_end;
    if (!Number.isSafeInteger(period) || (period as number) <= 0 || (period as number) > 100_000_000_000) throw new Error("Subscription period is invalid");
    return [{ plan: PLAN_MAP[productId], period: period as number }];
  });
  if (matched.length < 1 || new Set(matched.map((item) => item.plan)).size !== 1) throw new Error("Subscription product mapping is not configured or is ambiguous");
  return { plan: matched[0].plan, periodEnd: new Date(Math.min(...matched.map((item) => item.period)) * 1000).toISOString() };
}

export function invoiceSubscriptionId(invoice: { parent?: { subscription_details?: { subscription?: unknown } | null } | null; subscription?: unknown }): string | null {
  const reference = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
  if (!reference) return null;
  const id = typeof reference === "string" ? reference : typeof reference === "object" ? (reference as { id?: unknown }).id : null;
  if (typeof id !== "string" || !/^sub_[A-Za-z0-9_]{1,150}$/.test(id)) throw new Error("Invoice subscription reference is invalid");
  return id;
}
