import { create } from "zustand";

import { create } from "zustand";

export type AIProvider = "shivai" | "openai" | "anthropic" | "compatible";
export const AI_PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
  shivai: {
    baseUrl: (typeof import.meta !== "undefined" && import.meta.env?.VITE_SHIV_CLOUD_AI_URL?.replace(/\/chat\/completions\/?$/, "")) || "https://shiv-aiserver.onrender.com/v1",
    model: "shiv-ai-v2"
  },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  compatible: { baseUrl: "http://localhost:1234/v1", model: "local-model" },
};
interface AIConnectionState {
  provider: AIProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  configure: (options: Partial<Pick<AIConnectionState, "provider" | "baseUrl" | "model" | "apiKey">>) => void;
  forgetKey: () => void;
}
/** Preconfigured to SHIV AI Sovereign Server with session API key */
export const useAIConnectionStore = create<AIConnectionState>((set) => ({
  provider: "shivai",
  ...AI_PROVIDER_DEFAULTS.shivai,
  apiKey: (typeof import.meta !== "undefined" && import.meta.env?.VITE_SHIV_CLOUD_API_KEY) || "shivai-production-key-2026",
  configure: (options) => set(options),
  forgetKey: () => set({ apiKey: "" }),
}));
