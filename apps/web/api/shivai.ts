import type { IncomingMessage, ServerResponse } from "http";

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-proxy-api-key");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  const apiKey =
    (req.headers["x-api-key"] as string) ||
    (req.headers["x-proxy-api-key"] as string) ||
    process.env.SHIV_CLOUD_API_KEY ||
    "shivai-production-key-2026";

  const targetUrl =
    process.env.SHIV_CLOUD_AI_URL ||
    "https://shiv-aiserver.onrender.com/v1/chat/completions";

  let body = req.body;
  if (!body && req.method === "POST") {
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
    const upstreamHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    };
    if (apiKey.includes(".") || apiKey.startsWith("shiv_sk_") || apiKey.startsWith("Bearer ")) {
      upstreamHeaders["Authorization"] = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
    }

    const upstreamResponse = await fetch(targetUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

    const data = await upstreamResponse.text();
    res.statusCode = upstreamResponse.status;
    res.setHeader("Content-Type", upstreamResponse.headers.get("content-type") || "application/json");
    res.end(data);
  } catch (err: any) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err.message || "Failed to reach SHIV AI Server" }));
  }
}
