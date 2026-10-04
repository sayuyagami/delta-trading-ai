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

Chart analysis costs ₹99 for one calendar month of access. Customers pay manually by UPI and submit the transaction reference. The site stays locked while payment is pending review; access starts only after you confirm the payment and approve the row in Supabase. There is no automatic renewal.

The payment dialog displays the QR image at `src/assets/payment-qr.jpg` and the configured payee name; it does not display a UPI ID. Replace that asset with the QR for the receiving account and set `MANUAL_PAYMENT_PAYEE_NAME` in `.env` and in the production environment. Use a UPI account your bank/payment provider permits for receiving these payments. Create a Supabase project, then run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor. Set `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`; never expose the service-role key in browser code.

To review submitted payments, run this in Supabase SQL Editor and verify each reference against your bank/UPI transaction history:

```sql
select google_sub, email, manual_payment_reference, manual_payment_submitted_at
from public.user_subscriptions
where status = 'pending_review';
```

After confirming a ₹99 payment, approve that exact account and reference:

```sql
update public.user_subscriptions
set manual_payment_status = 'approved',
    status = 'active',
    manual_payment_reviewed_at = now(),
    access_expires_at = now() + interval '1 month',
    updated_at = now()
where google_sub = 'GOOGLE_SUB_FROM_REVIEW_QUERY'
  and manual_payment_reference = 'CONFIRMED_UPI_REFERENCE'
  and status = 'pending_review';
```

Access starts when you approve the payment and ends one calendar month later. Never approve based solely on the reference entered by a user; verify the payment arrived first.

If the payment cannot be found, reject that reference so the user can submit a new request:

```sql
update public.user_subscriptions
set manual_payment_status = 'rejected',
    status = 'rejected',
    manual_payment_reviewed_at = now(),
    updated_at = now()
where google_sub = 'GOOGLE_SUB_FROM_REVIEW_QUERY'
  and manual_payment_reference = 'UNCONFIRMED_UPI_REFERENCE'
  and status = 'pending_review';
```
