# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  # TradeGuru

  An Angular chart-analysis dashboard. Uploaded charts are analyzed by Google Gemini through a local Node API; images are sent only after clicking Analyze.

  ## Development

  Install dependencies and start the local server:

  ```sh
  npm install
  npm run dev
  ```

  Set `GEMINI_API_KEY` in a local `.env` file using `.env.example`, then run `npm run dev`. The Angular app is available at `http://localhost:4200/`; the development command starts both the UI and its local analysis API.

  ## Build

  ```sh
  npm run build
  ```
      // other options...

      /*{
    "instrument": "FARTCOINUSD",
    "timeframe": "1D + 1H",
    "bias": "LONG",
    "entry": 0.1805,
    "stopLoss": 0.165,
    "target": 0.195,
    "confidence": 65,
    "rationale": "The 1D chart shows a strong recovery bounce off local lows near 0.1400 with recent bullish momentum testing 0.1800 levels. The 1H chart indicates a sharp rejection and V-shaped rebound from lows near 0.1620, currently forming green continuation candles trading around 0.1805. Entry is set at current price 0.1805, stop loss below the recent swing low support at 0.1650, and target near the local resistance/supply level at 0.1950."
}*/

## Google sign-in

Create a Google OAuth **Web application** client ID in Google Cloud Console. Add `http://localhost:4200` and your production site origin to its authorized JavaScript origins. No redirect URI is needed; Google Identity Services opens its account chooser from the sign-in button in the launch dialog.

Set these environment variables locally in `.env` and in the production server's environment:

- `GOOGLE_CLIENT_ID`: the OAuth client ID (public; also used to validate Google ID tokens).
- `AUTH_SESSION_SECRET`: a private random value of at least 32 bytes used to sign session cookies. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

The server verifies each Google credential and stores the signed session in an HTTP-only cookie. The chart-analysis endpoint requires that session. Keep `AUTH_SESSION_SECRET` private and use the same value for all server instances.

## One-month access

Chart analysis costs ₹99 for one calendar month of access. PhonePe Standard Checkout creates a one-time payment order; there is no recurring mandate or automatic renewal. The server checks PhonePe's order status and records the paid-through date against the signed-in Google account. After expiry, chart analysis is blocked and the dialog shows that the previous month is completed. Users must make a new payment to regain access.

Get PhonePe Payment Gateway sandbox credentials from the PhonePe Business Dashboard's Developer Settings. Set `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`, `PHONEPE_CLIENT_VERSION`, and `PHONEPE_ENV=SANDBOX` in `.env` and in the production server environment. Set `PUBLIC_APP_URL` to the exact origin where the website is hosted; production checkout requires HTTPS.

For order events, configure a PhonePe webhook using SHA username/password authentication. Register `https://your-domain.example/api/subscription/webhook` with the `checkout.order.completed` and `checkout.order.failed` events, then set its webhook username and password as `PHONEPE_WEBHOOK_USERNAME` and `PHONEPE_WEBHOOK_PASSWORD`. The local HTTP app cannot receive public webhooks; use a public HTTPS test URL for sandbox callback testing.

Create a Supabase project, then run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor. This script also adds the one-time payment and expiry columns if the earlier recurring-subscription schema was already installed. Set `SUPABASE_URL` and the project's server-only `SUPABASE_SERVICE_ROLE_KEY` in `.env` and in the production server environment. Never expose the service role key in browser code.

If any recurring Razorpay subscriptions were created with an earlier version, cancel them in Razorpay Dashboard; this app no longer creates or manages Razorpay payments. For live PhonePe payments, set `PHONEPE_ENV=PRODUCTION` and use production credentials only after completing PhonePe's account verification and testing checkout end to end.
