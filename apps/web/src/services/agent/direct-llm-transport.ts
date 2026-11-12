import { makeClientFromSend, withRetry, LLMHttpError, parseRetryAfterMs, type LLMClient } from "@openreel/agent";
import type { AIProvider } from "../../stores/ai-connection-store";

export interface DirectConnection {
  provider: AIProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  signal?: AbortSignal;
}

export function validateAIEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  ) {
    throw new Error(
      "Use an HTTPS base URL, or HTTP on localhost, without credentials, query parameters or fragments.",
    );
  }
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|messages)\/?$/, "");
  return url.href.replace(/\/+$/, "");
}

function transformShivAiResponse(raw: any, userPrompt = ""): any {
  if (!raw || typeof raw !== "object") return raw;
  const choice = raw.choices?.[0];
  if (!choice?.message) return raw;
  const msg = choice.message;
  let content = typeof msg.content === "string" ? msg.content.trim() : "";
  const toolCalls: any[] = Array.isArray(msg.tool_calls) ? [...msg.tool_calls] : [];

  // 1. Extract JSON commands from markdown codeblock or raw json
  let parsedCommands: any[] = [];
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      parsedCommands = Array.isArray(parsed) ? parsed : [parsed];
      content = content.replace(/```(?:json)?\s*[\s\S]*?```/g, "").trim();
    } catch (_) {}
  } else if (content.startsWith("[") || (content.startsWith("{") && content.includes('"command"'))) {
    try {
      const parsed = JSON.parse(content);
      parsedCommands = Array.isArray(parsed) ? parsed : [parsed];
      content = "";
    } catch (_) {}
  }

  // 2. Map parsed commands into OpenReel tool calls
  for (const cmd of parsedCommands) {
    if (!cmd || typeof cmd !== "object") continue;
    const commandName = cmd.command || cmd.name || cmd.tool;
    const params = cmd.parameters || cmd.params || cmd.arguments || cmd.args || {};

    if (commandName === "add_title" || commandName === "create_text_clip" || commandName === "add_text") {
      const text = params.text || params.content || "Title";
      const startTime = Number(params.startTime ?? 0);
      const duration = Number(params.duration ?? 5);

      toolCalls.push({
        id: `shiv-call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: "create_text_clip",
          arguments: JSON.stringify({
            clip: {
              text,
              startTime,
              duration,
              style: {
                fontSize: Number(params.fontSize ?? 64),
                fill: params.color || "#ffffff",
              },
            },
          }),
        },
      });

      if (!content) {
        content = `🎬 **Title Added!**\n\nI have created a text overlay with the text: **"${text}"** (0:00 to 0:05). You can adjust its style and timing in the timeline.`;
      }
    } else if (commandName === "add_track" || commandName === "create_track") {
      const trackType = ["video", "audio", "image", "text"].includes(params.type || params.trackType)
        ? (params.type || params.trackType)
        : "video";

      toolCalls.push({
        id: `shiv-call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: "add_track",
          arguments: JSON.stringify({
            trackType,
            position: Number(params.position ?? 0),
          }),
        },
      });

      if (!content) {
        content = `🎬 **Track Added!**\n\nI have added a new ${trackType} track to your timeline.`;
      }
    } else if (commandName === "split_clip") {
      const time = Number(params.time ?? 0);
      toolCalls.push({
        id: `shiv-call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: "split_clip",
          arguments: JSON.stringify({ time }),
        },
      });

      if (!content) {
        content = `✂️ **Clip Split!**\n\nI have split the clip at ${time} seconds.`;
      }
    } else if (commandName === "add_transition") {
      const transitionType = params.type || params.transitionType || "crossfade";
      const duration = Number(params.duration ?? 1);
      toolCalls.push({
        id: `shiv-call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: "add_transition",
          arguments: JSON.stringify({ transitionType, duration }),
        },
      });

      if (!content) {
        content = `✨ **Transition Added!**\n\nI have added a ${transitionType} transition (duration: ${duration}s).`;
      }
    }
  }

  // 3. Fallback: If no tool calls in JSON, check user prompt for explicit intent
  if (toolCalls.length === 0 && userPrompt) {
    const titleMatch = userPrompt.match(/(?:add|create|insert|make)\s+(?:a\s+)?(?:title|text|caption)\s*(?:that\s+says|saying|named|with)?\s*[:"']?([^"'\n\r]+)["']?/i);
    if (titleMatch) {
      const text = titleMatch[1].trim().replace(/^['"]|['"]$/g, "");
      if (text) {
        toolCalls.push({
          id: `shiv-call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: "function",
          function: {
            name: "create_text_clip",
            arguments: JSON.stringify({
              clip: {
                text,
                startTime: 0,
                duration: 5,
                style: {
                  fontSize: 64,
                  fill: "#ffffff",
                },
              },
            }),
          },
        });
        if (!content) {
          content = `🎬 **Title Added!**\n\nI have placed a title saying **"${text}"** on your timeline.`;
        }
      }
    }
  }

  // 4. Guarantee non-empty content
  if (!content) {
    content = toolCalls.length > 0
      ? "🎬 I have applied the requested edits to your timeline."
      : "✨ SHIV AI is ready. You can ask me to add titles, trim clips, split clips, or add tracks to your timeline.";
  }

  msg.content = content;
  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls;
  }

  return raw;
}

export function makeDirectBYOKClient(options: DirectConnection): LLMClient {
  const baseUrl = validateAIEndpoint(options.baseUrl);
  if (!options.model.trim()) throw new Error("Enter a model ID that supports tools.");
  if (options.apiKey && /[\r\n]/.test(options.apiKey)) throw new Error("Invalid API key.");
  const provider = options.provider === "anthropic" ? "anthropic" : "openai";

  const send = withRetry(async (body: unknown) => {
    options.signal?.throwIfAborted();
    let res: Response;
    let bodyToSend = body as any;
    let latestUserPrompt = "";

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
          if (
            options.apiKey.startsWith("shiv_sk_") ||
            options.apiKey.includes(".") ||
            options.apiKey.startsWith("Bearer ")
          ) {
            headers["Authorization"] = options.apiKey.startsWith("Bearer ")
              ? options.apiKey
              : `Bearer ${options.apiKey}`;
          }
        } else {
          headers["Authorization"] = options.apiKey.startsWith("Bearer ")
            ? options.apiKey
            : `Bearer ${options.apiKey}`;
        }
      }

      if (options.provider === "shivai" && bodyToSend && typeof bodyToSend === "object") {
        const messages = Array.isArray(bodyToSend.messages) ? [...bodyToSend.messages] : [];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]?.role === "user" && typeof messages[i]?.content === "string") {
            latestUserPrompt = messages[i].content;
            break;
          }
        }

        const shivSystemPrompt = `You are the SHIV AI Video Editing Assistant for OpenReel.
When the user asks to add titles, text, clips, tracks, cuts, or transitions, output a JSON command block using commands: add_title, add_track, split_clip, trim_clip, or add_transition:
\`\`\`json
[
  { "command": "add_title", "parameters": { "text": "Title Text", "startTime": 0, "duration": 5 } }
]
\`\`\`
Supported commands:
- add_title: { text: string, startTime: number, duration: number }
- add_track: { type: "video" | "audio" | "image" | "text" }
- split_clip: { time: number }
- trim_clip: { inPoint: number, outPoint: number }
- add_transition: { type: "crossfade" | "fade", duration: number }

Always accompany your command with a polite, professional explanation of the edit performed. If the user asks a question or greeting, reply helpfully.`;

        const sysIdx = messages.findIndex((m: any) => m.role === "system");
        if (sysIdx >= 0) {
          messages[sysIdx] = { role: "system", content: shivSystemPrompt };
        } else {
          messages.unshift({ role: "system", content: shivSystemPrompt });
        }

        bodyToSend = {
          ...bodyToSend,
          messages,
          tools: undefined, // Drop bulky schemas for 4s response time on Render
        };
      }

      res = await fetch(`${baseUrl}${provider === "anthropic" ? "/messages" : "/chat/completions"}`, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        headers,
        body: JSON.stringify(bodyToSend),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new Error(
        "The model endpoint could not be reached. Check its URL and browser CORS support. No proxy or security bypass is used.",
      );
    }

    if (!res.ok) {
      throw new LLMHttpError(
        `Model endpoint returned HTTP ${res.status}. Check the key, model ID and provider settings.`,
        res.status,
        parseRetryAfterMs(res.headers.get("retry-after")),
      );
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new Error("The endpoint returned invalid JSON. Check the API adapter and endpoint.");
    }

    if (
      !raw ||
      typeof raw !== "object" ||
      (provider === "openai" && !("choices" in raw)) ||
      (provider === "anthropic" && !("content" in raw))
    ) {
      throw new Error(
        "The endpoint returned an unsupported response. Choose the correct API adapter and a tool-capable model.",
      );
    }

    if (options.provider === "shivai") {
      raw = transformShivAiResponse(raw, latestUserPrompt);
    }

    return raw;
  }, { signal: options.signal, retries: 2 });

  return makeClientFromSend({ provider, model: options.model.trim(), maxTokens: 4096, send });
}
