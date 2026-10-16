// Stripe Checkout and webhook verification, using Stripe's REST API directly (no SDK needed in Workers).

function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function createCheckoutSession(env, { lines, shippingCents, siteUrl }) {
  const body = {
    mode: "payment",
    success_url: `${siteUrl}/?order=success`,
    cancel_url: `${siteUrl}/?order=cancelled`,
    shipping_address_collection: { allowed_countries: ["CA"] },
    phone_number_collection: { enabled: true },
    line_items: lines.map(l => ({
      quantity: l.quantity,
      price_data: {
        currency: "cad",
        unit_amount: Math.round(l.price * 100),
        product_data: { name: l.name, ...(l.image ? { images: [l.image] } : {}) }
      }
    })),
    shipping_options: [{
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: shippingCents ? "Tracked shipping" : "Free tracked shipping",
        fixed_amount: { amount: shippingCents, currency: "cad" },
        delivery_estimate: { minimum: { unit: "business_day", value: 7 }, maximum: { unit: "business_day", value: 12 } }
      }
    }],
    metadata: { items: JSON.stringify(lines.map(l => [l.id, l.quantity])) }
  };
  if (env.STRIPE_AUTOMATIC_TAX === "true") body.automatic_tax = { enabled: true };

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Stripe checkout failed");
  return data.url;
}

async function hmacHexLower(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyWebhook(payload, header, secret, toleranceSec = 300) {
  if (!header) return false;
  const v1 = [];
  let t = null;
  for (const item of header.split(",")) {
    const [k, v] = item.split("=");
    if (k === "t") t = v;
    if (k === "v1") v1.push(v);
  }
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = await hmacHexLower(secret, `${t}.${payload}`);
  return v1.some(sig => sig.length === expected.length && timingSafeEqual(sig, expected));
}

function timingSafeEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
