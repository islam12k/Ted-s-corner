// Ted's Corner store server (Cloudflare Worker).
//
// Public:   GET  /api/products         live catalogue (photos and stock from AliExpress)
//           POST /api/checkout         creates a Stripe Checkout page for the cart
//           POST /api/stripe-webhook   Stripe calls this after payment; places the AliExpress order
// Admin (?key=ADMIN_KEY):
//           GET  /auth/start           connect your AliExpress account (one time)
//           GET  /admin/orders         recent orders and whether the AliExpress order went through
//           GET  /admin/product?id=    raw product data: variants (sku_attr), cost, stock
//           GET  /admin/freight?id=    shipping methods to Canada for a product

import { PRODUCTS, FREE_SHIPPING_OVER, SHIPPING_FEE } from "./products.js";
import { authorizeUrl, createToken, getProduct, freightOptions, createOrder } from "./aliexpress.js";
import { createCheckoutSession, verifyWebhook } from "./stripe.js";

const PROVINCES = { AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": env.SITE_URL,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json", ...cors } });
    const isAdmin = env.ADMIN_KEY && url.searchParams.get("key") === env.ADMIN_KEY;

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      // ---------- Public ----------
      if (url.pathname === "/api/products" && request.method === "GET") {
        return json(await catalogue(env, ctx));
      }

      if (url.pathname === "/api/checkout" && request.method === "POST") {
        const { items } = await request.json();
        const list = await catalogue(env, ctx);
        const lines = [];
        for (const it of items || []) {
          const p = list.find(x => x.id === it.id);
          const qty = Math.min(10, Math.max(1, parseInt(it.quantity, 10) || 0));
          if (!p) continue;
          if (!p.available) return json({ error: `${p.name} is out of stock right now.` }, 400);
          lines.push({ id: p.id, name: p.name, image: p.image, price: p.price, quantity: qty });
        }
        if (!lines.length) return json({ error: "Your cart is empty." }, 400);
        const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
        const shippingCents = subtotal >= FREE_SHIPPING_OVER ? 0 : Math.round(SHIPPING_FEE * 100);
        return json({ url: await createCheckoutSession(env, { lines, shippingCents, siteUrl: env.SITE_URL }) });
      }

      if (url.pathname === "/api/stripe-webhook" && request.method === "POST") {
        const payload = await request.text();
        if (!(await verifyWebhook(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) {
          return new Response("Invalid signature", { status: 400 });
        }
        const event = JSON.parse(payload);
        if (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid") {
          ctx.waitUntil(fulfil(env, event.data.object));
        }
        return new Response("ok");
      }

      // ---------- AliExpress connection ----------
      if (url.pathname === "/auth/start") {
        if (!isAdmin) return new Response("Forbidden", { status: 403 });
        return Response.redirect(authorizeUrl(env, `${url.origin}/auth/callback`), 302);
      }
      if (url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code");
        if (!code) return new Response("Missing code from AliExpress.", { status: 400 });
        const t = await createToken(env, code);
        return new Response(`AliExpress connected${t.account ? ` (${t.account})` : ""}. You can close this tab.`);
      }

      // ---------- Admin ----------
      if (url.pathname.startsWith("/admin/")) {
        if (!isAdmin) return new Response("Forbidden", { status: 403 });
        if (url.pathname === "/admin/orders") {
          const keys = await env.STORE.list({ prefix: "order:" });
          const orders = await Promise.all(keys.keys.map(k => env.STORE.get(k.name, "json")));
          return json(orders.sort((a, b) => b.created - a.created));
        }
        const id = url.searchParams.get("id");
        if (url.pathname === "/admin/product") return json(await getProduct(env, id));
        if (url.pathname === "/admin/freight") {
          const prod = await getProduct(env, id);
          return json(await freightOptions(env, id, prod.skus[0]?.sku_id));
        }
      }

      return new Response("Not found", { status: 404, headers: cors });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

// Catalogue merged with live AliExpress data, cached for 6 hours (15 minutes if a lookup failed).
async function catalogue(env, ctx) {
  const cached = await env.STORE.get("catalogue", "json");
  if (cached) return cached;
  let failed = false;
  const list = await Promise.all(PRODUCTS.map(async p => {
    const base = { id: p.id, name: p.name, desc: p.desc, category: p.category, badge: p.badge || "", price: p.price, image: p.image || "", available: false };
    if (!p.aliexpress_id) return base;
    try {
      const ae = await getProduct(env, p.aliexpress_id);
      const sku = ae.skus.find(s => s.sku_attr === p.sku_attr) || ae.skus[0];
      return { ...base, image: p.image || ae.images[0] || "", images: ae.images.slice(0, 5), available: !!sku && sku.stock > 0 };
    } catch (e) {
      failed = true;
      return base;
    }
  }));
  ctx.waitUntil(env.STORE.put("catalogue", JSON.stringify(list), { expirationTtl: failed ? 900 : 6 * 3600 }));
  return list;
}

// Place the AliExpress order for a paid Stripe session. Safe to run twice: it records each session once.
async function fulfil(env, session) {
  const key = `order:${session.id}`;
  if (await env.STORE.get(key)) return;

  const ship = session.collected_information?.shipping_details || session.shipping_details || {};
  const a = ship.address || {};
  const phone = (session.customer_details?.phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const record = {
    created: Date.now(),
    stripe_session: session.id,
    customer: session.customer_details?.email || "",
    total: (session.amount_total || 0) / 100,
    status: "placing",
    aliexpress_orders: [],
    error: ""
  };
  await env.STORE.put(key, JSON.stringify(record));

  try {
    const pairs = JSON.parse(session.metadata?.items || "[]");
    const items = pairs.map(([id, quantity]) => {
      const p = PRODUCTS.find(x => x.id === id);
      if (!p || !p.aliexpress_id) throw new Error(`No AliExpress product set for ${id}`);
      return { ...p, quantity };
    });
    record.aliexpress_orders = await createOrder(env, {
      outOrderId: session.id,
      address: {
        full_name: ship.name || session.customer_details?.name || "",
        contact_person: ship.name || session.customer_details?.name || "",
        address: a.line1 || "",
        address2: a.line2 || "",
        city: a.city || "",
        province: PROVINCES[a.state] || a.state || "",
        zip: a.postal_code || "",
        country: a.country || "CA",
        phone_country: "+1",
        mobile_no: phone
      },
      items
    });
    record.status = "placed";
  } catch (err) {
    record.status = "needs attention";
    record.error = err.message;
  }
  await env.STORE.put(key, JSON.stringify(record));
}
