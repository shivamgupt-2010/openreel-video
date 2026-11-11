import type { IncomingMessage, ServerResponse } from "http";

export default async function handler(req: IncomingMessage & { query?: Record<string, any>; body?: any }, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-proxy-api-key");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  // Extract path after /api/proxy/
  const match = url.pathname.match(/^\/api\/proxy\/([^\/]+)(.*)$/);
  const service = match ? match[1] : "";
  const subpath = match ? match[2] : "";

  const apiKey =
    (req.headers["x-proxy-api-key"] as string) ||
    (req.headers["x-api-key"] as string) ||
    process.env.SHIV_CLOUD_API_KEY ||
    "shivai-production-key-2026";

  let targetUrl = "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (service === "shivai") {
    targetUrl = `https://shiv-aiserver.onrender.com/v1${subpath || "/chat/completions"}`;
    headers["x-api-key"] = apiKey;
    if (apiKey.includes(".") || apiKey.startsWith("shiv_sk_") || apiKey.startsWith("Bearer ")) {
      headers["Authorization"] = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
    }
  } else if (service === "openai") {
    targetUrl = `https://api.openai.com/v1${subpath}`;
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (service === "anthropic") {
    targetUrl = `https://api.anthropic.com/v1${subpath}`;
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (service === "elevenlabs") {
    targetUrl = `https://api.elevenlabs.io/v1${subpath}`;
    headers["xi-api-key"] = apiKey;
  } else {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: `Unsupported proxy service: ${service}` }));
    return;
  }

  let body = req.body;
  if (!body && (req.method === "POST" || req.method === "PUT")) {
    const buffers: Buffer[] = [];
    for await (const chunk of req) {
      buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(buffers).toString("utf-8");
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: req.method || "POST",
      headers,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const data = await upstreamRes.text();
    res.statusCode = upstreamRes.status;
    res.setHeader("Content-Type", upstreamRes.headers.get("content-type") || "application/json");
    res.end(data);
  } catch (err: any) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err.message || "Proxy request failed" }));
  }
}
