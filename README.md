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
