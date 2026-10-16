# Ted's Corner

Storefront at **https://tahsin12232334.online**, with products, photos and order fulfilment from AliExpress.

- `index.html` — the website, served by GitHub Pages.
- `worker/` — a small server on Cloudflare Workers (free plan) that pulls product photos and stock from AliExpress, takes payment with Stripe, and places the AliExpress order after each payment.

How an order flows: customer pays on Stripe → Stripe tells the server → the server creates the order in your AliExpress account, shipped to the customer's address → you pay for it in AliExpress (or turn on auto-pay) → the supplier ships.

Until the server is set up, the site shows the product list with a "launching soon" checkout.

## What you need

| Account | Why | Cost |
|---|---|---|
| AliExpress Open Platform developer account (openservice.aliexpress.com) | API access to products and orders | Free; your app needs approval for the **Dropshipping** APIs, which can take a few days |
| AliExpress buyer account | Orders are placed and paid here | Free |
| Stripe (stripe.com) | Takes customer payments | Per-transaction fees |
| Cloudflare (cloudflare.com) | Runs the server | Free plan is enough |

## Setup

### 1. AliExpress app
1. Sign up at openservice.aliexpress.com as a developer and create an app.
2. Apply for the **Dropshipping** API permissions.
3. Set the app's callback URL to `https://teds-corner-api.<your-subdomain>.workers.dev/auth/callback` (you'll know the exact address after step 3).
4. Copy the **App Key** and **App Secret**.

### 2. Stripe
1. Create a Stripe account and finish activation (bank details, business info).
2. Copy the **Secret key** from Developers → API keys. Use the test key (`sk_test_…`) first.

### 3. Deploy the server
On a computer with Node.js installed:

```bash
git clone https://github.com/islam12k/ted-s-corner
cd ted-s-corner/worker
npm install
npx wrangler login
npx wrangler kv namespace create STORE      # paste the printed id into wrangler.toml
npx wrangler secret put AE_APP_KEY
npx wrangler secret put AE_APP_SECRET
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put ADMIN_KEY           # make up a long random password; it protects the admin pages
npx wrangler deploy                         # prints your server address
```

### 4. Stripe webhook
1. In Stripe → Developers → Webhooks, add an endpoint: `https://<your-server>/api/stripe-webhook`
2. Choose the event **checkout.session.completed**.
3. Copy the signing secret (`whsec_…`) and run `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.

### 5. Connect AliExpress (one time)
Open `https://<your-server>/auth/start?key=<ADMIN_KEY>` and log in with your AliExpress buyer account. You'll see "AliExpress connected". The server renews access by itself after that.

### 6. Add your products
Edit `worker/src/products.js`. For each product, paste the AliExpress product ID (the number in the listing link) and set your selling price in CAD. Then:
- `https://<your-server>/admin/product?id=<product id>&key=<ADMIN_KEY>` shows the variants (`sku_attr`), your cost and stock.
- `https://<your-server>/admin/freight?id=<product id>&key=<ADMIN_KEY>` shows shipping methods to Canada; copy the one you want into `logistics`.

Run `npx wrangler deploy` again after editing. Products without an AliExpress ID show as sold out.

### 7. Switch the website on
In `index.html`, set `API_BASE` to your server address, for example `const API_BASE="https://teds-corner-api.yourname.workers.dev";`, and push. The site now loads AliExpress photos and sends shoppers to Stripe checkout.

### 8. Test, then go live
1. With Stripe test keys, buy something using card `4242 4242 4242 4242`.
2. Check `https://<your-server>/admin/orders?key=<ADMIN_KEY>`. Status `placed` means the AliExpress order was created; `needs attention` shows the error.
3. Cancel that test order in AliExpress.
4. Swap in your live Stripe key and live webhook secret.

## Day to day
- **Paying suppliers:** new orders wait in your AliExpress account for payment. Pay them there, or set `AE_AUTO_PAY = "true"` in `wrangler.toml` to have AliExpress try your saved payment method automatically (check this works on your account before relying on it).
- **Failed orders:** anything marked `needs attention` in `/admin/orders` needs placing by hand in AliExpress.
- **Sales tax:** Stripe can add GST/HST. Set up Stripe Tax, then set `STRIPE_AUTOMATIC_TAX = "true"`.
- **Prices:** your selling prices live in `products.js` and never change on their own. Check `/admin/product` now and then so supplier price rises don't eat your margin.

## Notes
- The API details follow AliExpress's Open Platform conventions (HMAC-SHA256 signing, `api-sg.aliexpress.com` gateway). If AliExpress returns a signature or permission error on the first call, compare `worker/src/aliexpress.js` against the current docs in your developer console.
- Keys and secrets are stored as Cloudflare secrets, never in this repository.
