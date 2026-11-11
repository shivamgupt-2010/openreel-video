# Deploying OpenReel Video with SHIV AI Server to Vercel

This repository is preconfigured for 1-click deployment to [Vercel](https://vercel.com) with native integration for the **SHIV AI Sovereign Server** (`https://shiv-aiserver.onrender.com`).

---

## 🚀 Quick Deploy to Vercel

1. Import this repository into your Vercel account:
   - Go to [vercel.com/new](https://vercel.com/new)
   - Select `shivamgupt-2010/openreel-video`
2. **Framework Preset**: Vercel will automatically detect **Vite**.
3. **Root Directory**: Leave as `./` (or select `apps/web`). Both are supported via `vercel.json`.
4. **Environment Variables**:
   Add the following environment variables in Vercel Project Settings:

   | Variable | Value | Description |
   |---|---|---|
   | `SHIV_CLOUD_AI_URL` | `https://shiv-aiserver.onrender.com/v1/chat/completions` | SHIV AI Server endpoint |
   | `SHIV_CLOUD_API_KEY` | `shivai-production-key-2026` | Sovereign server authentication key |
   | `VITE_SHIV_CLOUD_AI_URL` | `https://shiv-aiserver.onrender.com/v1/chat/completions` | Client-accessible endpoint |
   | `VITE_SHIV_CLOUD_API_KEY` | `shivai-production-key-2026` | Client session key default |
   | `WORKFORCE_SECRET_KEY` | `shiv-workforce-secret-key-2026` | Workforce authentication key |
   | `WORKFORCE_AUTH_TOKEN` | `shiv_workforce_node_token_secure_2026` | Secure workforce node token |

5. Click **Deploy**.

---

## ⚡ Features & Architecture

- **SHIV AI Default Provider**: The AI video editor agent automatically connects to `https://shiv-aiserver.onrender.com` using the `shiv-ai-v2` model and `x-api-key` authentication.
- **Serverless API Proxy**: `/api/shivai` and `/api/proxy/*` Vercel Serverless Functions relay browser requests to upstream sovereign endpoints while managing CORS and security headers.
- **COOP / COEP Enabled**: Pre-configured in `vercel.json` (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`) for WebAssembly, WebCodecs, and fast multi-threaded video processing (`@ffmpeg/core-mt`).
- **SPA Routing**: Automatic clean rewrite fallback to `index.html`.
