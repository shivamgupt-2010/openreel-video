import { makeClientFromSend, withRetry, LLMHttpError, parseRetryAfterMs, type LLMClient } from "@openreel/agent";
import type { AIProvider } from "../../stores/ai-connection-store";

export interface DirectConnection { provider: AIProvider; baseUrl: string; model: string; apiKey: string; signal?: AbortSignal }
export function validateAIEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("Use an HTTPS base URL, or HTTP on localhost, without credentials, query parameters or fragments.");
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|messages)\/?$/, "");
  return url.href.replace(/\/+$/, "");
}
export function makeDirectBYOKClient(options: DirectConnection): LLMClient {
  const baseUrl = validateAIEndpoint(options.baseUrl);
  if (!options.model.trim()) throw new Error("Enter a model ID that supports tools.");
  if (options.apiKey && /[\r\n]/.test(options.apiKey)) throw new Error("Invalid API key.");
  const provider = options.provider === "anthropic" ? "anthropic" : "openai";
  const send = withRetry(async (body: unknown) => {
    options.signal?.throwIfAborted();
    let res: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (options.apiKey) {
        headers["x-api-key"] = options.apiKey;
        if (provider === "anthropic") {
          headers["anthropic-version"] = "2023-06-01";
          headers["anthropic-dangerous-direct-browser-access"] = "true";
        } else if (options.provider === "shivai") {
          if (options.apiKey.startsWith("shiv_sk_") || options.apiKey.includes(".") || options.apiKey.startsWith("Bearer ")) {
            headers["Authorization"] = options.apiKey.startsWith("Bearer ") ? options.apiKey : `Bearer ${options.apiKey}`;
          }
        } else {
          headers["Authorization"] = options.apiKey.startsWith("Bearer ") ? options.apiKey : `Bearer ${options.apiKey}`;
        }
      }
      res = await fetch(`${baseUrl}${provider === "anthropic" ? "/messages" : "/chat/completions"}`, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new Error("The model endpoint could not be reached. Check its URL and browser CORS support. No proxy or security bypass is used.");
    }
    // Never include upstream response bodies: providers can echo credentials.
    if (!res.ok) throw new LLMHttpError(`Model endpoint returned HTTP ${res.status}. Check the key, model ID and provider settings.`, res.status, parseRetryAfterMs(res.headers.get("retry-after")));
    let raw: unknown;
    try { raw = await res.json(); } catch { throw new Error("The endpoint returned invalid JSON. Check the API adapter and endpoint."); }
    if (!raw || typeof raw !== "object" || (provider === "openai" && !("choices" in raw)) || (provider === "anthropic" && !("content" in raw))) throw new Error("The endpoint returned an unsupported response. Choose the correct API adapter and a tool-capable model.");
    return raw;
  }, { signal: options.signal, retries: 2 });
  return makeClientFromSend({ provider, model: options.model.trim(), maxTokens: 4096, send });
}
