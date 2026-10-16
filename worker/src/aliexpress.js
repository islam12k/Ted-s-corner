// AliExpress Open Platform client (dropshipping APIs).
// Business methods go to /sync with a `method` param; system calls (tokens) go to /rest/<path>.
// Signature: HMAC-SHA256 with the app secret over (api path for /rest calls) + sorted key+value pairs, uppercase hex.

const GATEWAY = "https://api-sg.aliexpress.com";

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function signParams(params, secret, apiPath = "") {
  const base = apiPath + Object.keys(params).filter(k => k !== "sign").sort().map(k => k + params[k]).join("");
  return hmacHex(secret, base);
}

async function call(env, { method, path, params = {}, token }) {
  const p = { app_key: env.AE_APP_KEY, timestamp: String(Date.now()), sign_method: "sha256" };
  if (method) p.method = method;
  if (token) p.access_token = token;
  for (const [k, v] of Object.entries(params)) p[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  p.sign = await signParams(p, env.AE_APP_SECRET, path || "");

  const url = path ? `${GATEWAY}/rest${path}` : `${GATEWAY}/sync`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(p)
  });
  const data = await res.json();
  if (data.error_response) throw new Error(`AliExpress: ${data.error_response.msg || JSON.stringify(data.error_response)}`);
  if (data.code && data.code !== "0") throw new Error(`AliExpress: ${data.message || data.code}`);
  return data;
}

// ---------- OAuth tokens (stored in KV) ----------

export function authorizeUrl(env, redirectUri) {
  const q = new URLSearchParams({ response_type: "code", force_auth: "true", redirect_uri: redirectUri, client_id: env.AE_APP_KEY });
  return `${GATEWAY}/oauth/authorize?${q}`;
}

async function saveToken(env, t) {
  const record = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expire_time: Number(t.expire_time) || Date.now() + Number(t.expires_in || 0) * 1000,
    refresh_expire_time: Number(t.refresh_token_valid_time) || 0,
    account: t.account || t.user_nick || ""
  };
  await env.STORE.put("ae_token", JSON.stringify(record));
  return record;
}

export async function createToken(env, code) {
  return saveToken(env, await call(env, { path: "/auth/token/create", params: { code } }));
}

export async function getToken(env) {
  const raw = await env.STORE.get("ae_token");
  if (!raw) throw new Error("AliExpress is not connected yet. Visit /auth/start?key=YOUR_ADMIN_KEY on the server.");
  let t = JSON.parse(raw);
  if (t.expire_time - Date.now() < 24 * 3600 * 1000) {
    t = await saveToken(env, await call(env, { path: "/auth/token/refresh", params: { refresh_token: t.refresh_token } }));
  }
  return t.access_token;
}

// ---------- Dropshipping methods ----------

export async function getProduct(env, productId) {
  const token = await getToken(env);
  const data = await call(env, {
    method: "aliexpress.ds.product.get", token,
    params: { product_id: productId, ship_to_country: "CA", target_currency: "CAD", target_language: "en" }
  });
  const r = data.aliexpress_ds_product_get_response?.result || {};
  const images = (r.ae_multimedia_info_dto?.image_urls || "").split(";").filter(Boolean);
  const skus = r.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o || [];
  return {
    title: r.ae_item_base_info_dto?.subject || "",
    images,
    skus: skus.map(s => ({
      sku_attr: s.sku_attr || "",
      sku_id: s.sku_id,
      cost: Number(s.offer_sale_price || s.sku_price || 0),
      stock: Number(s.sku_available_stock ?? s.ipm_sku_stock ?? 0)
    }))
  };
}

export async function freightOptions(env, productId, skuId, quantity = 1) {
  const token = await getToken(env);
  const data = await call(env, {
    method: "aliexpress.ds.freight.query", token,
    params: { queryDeliveryReq: { quantity, shipToCountry: "CA", productId, selectedSkuId: skuId, language: "en_US", currency: "CAD", locale: "en_US" } }
  });
  return data.aliexpress_ds_freight_query_response?.result || data;
}

export async function createOrder(env, { outOrderId, address, items }) {
  const token = await getToken(env);
  const params = {
    param_place_order_request4_open_api_d_t_o: {
      out_order_id: outOrderId,
      logistics_address: address,
      product_items: items.map(i => ({
        product_id: i.aliexpress_id,
        product_count: i.quantity,
        sku_attr: i.sku_attr || "",
        logistics_service_name: i.logistics || "",
        order_memo: "Please do not include invoices or prices in the package."
      }))
    }
  };
  if (env.AE_AUTO_PAY === "true") params.ds_extend_request = { payment: { try_to_pay: "true", pay_currency: "USD" } };
  const data = await call(env, { method: "aliexpress.ds.order.create", token, params });
  const r = data.aliexpress_ds_order_create_response?.result || {};
  if (!r.is_success) throw new Error(`Order not placed: ${r.error_msg || r.error_code || JSON.stringify(r)}`);
  return r.order_list?.number || [];
}
