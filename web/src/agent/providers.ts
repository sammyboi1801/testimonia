// Providers for the study assistant. Two protocols cover practically every model: Anthropic's (Claude) and the
// OpenAI-compatible Chat Completions protocol (OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral, local servers).

export type Protocol = "anthropic" | "openai";

export interface Preset {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl?: string; // OpenAI-compatible endpoint, ending in /v1 (or the provider's equivalent)
  models?: string[]; // suggestions; any model name may be typed
  modelHint: string;
  local?: boolean; // runs on the user's own machine → the browser talks to it directly
  needsKey: boolean;
  keyUrl?: string;
  note?: string;
}

export const PRESETS: Preset[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    protocol: "anthropic",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    modelHint: "claude-opus-5-5",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  { id: "openai", label: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1", modelHint: "a model name from your OpenAI account", needsKey: true, keyUrl: "https://platform.openai.com/api-keys" },
  {
    id: "gemini",
    label: "Google Gemini",
    protocol: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelHint: "a Gemini model name",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
  },
  { id: "openrouter", label: "OpenRouter (many models)", protocol: "openai", baseUrl: "https://openrouter.ai/api/v1", modelHint: "e.g. provider/model-name", needsKey: true, keyUrl: "https://openrouter.ai/keys" },
  { id: "groq", label: "Groq", protocol: "openai", baseUrl: "https://api.groq.com/openai/v1", modelHint: "a Groq model name", needsKey: true },
  { id: "deepseek", label: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com/v1", modelHint: "a DeepSeek model name", needsKey: true },
  { id: "mistral", label: "Mistral", protocol: "openai", baseUrl: "https://api.mistral.ai/v1", modelHint: "a Mistral model name", needsKey: true },
  {
    id: "ollama",
    label: "Ollama (on this computer)",
    protocol: "openai",
    baseUrl: "http://localhost:11434/v1",
    modelHint: "e.g. llama3.1 — any model you have pulled",
    local: true,
    needsKey: false,
    note: "Start Ollama with OLLAMA_ORIGINS set to this site's address so the browser may call it.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (on this computer)",
    protocol: "openai",
    baseUrl: "http://localhost:1234/v1",
    modelHint: "the model loaded in LM Studio",
    local: true,
    needsKey: false,
    note: "Turn on the local server and CORS in LM Studio's Developer tab.",
  },
  { id: "custom", label: "Other (OpenAI-compatible)", protocol: "openai", baseUrl: "", modelHint: "model name", needsKey: false },
];

export interface AiConfig {
  preset: string;
  protocol: Protocol;
  model: string;
  baseUrl: string;
  remember: boolean;
}

export const CONFIG_KEY = "testimonia.ai.config";
const KEY_KEY = "testimonia.ai.key";

export function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...defaultConfig(), ...(JSON.parse(raw) as Partial<AiConfig>) };
  } catch {
    /* storage unavailable */
  }
  return defaultConfig();
}

export function defaultConfig(): AiConfig {
  return { preset: "anthropic", protocol: "anthropic", model: "claude-opus-5-5", baseUrl: "", remember: false };
}

export function saveConfig(c: AiConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
  changed();
}

/**
 * The key lives in this browser only: for the session, or on this device if the user chose "remember". Each
 * provider keeps its own key. The provider choice syncs between devices but keys never do, so one shared key would
 * be sent to whichever provider another device picked: rejected, and handed to a company it was not meant for.
 */
const keyName = (preset: string) => `${KEY_KEY}.${preset}`;

export function loadKey(preset = loadConfig().preset): string {
  try {
    adoptOldKey();
    return localStorage.getItem(keyName(preset)) ?? sessionStorage.getItem(keyName(preset)) ?? "";
  } catch {
    return "";
  }
}

export function saveKey(key: string, remember: boolean, preset = loadConfig().preset): void {
  try {
    localStorage.removeItem(keyName(preset));
    sessionStorage.removeItem(keyName(preset));
    if (key) (remember ? localStorage : sessionStorage).setItem(keyName(preset), key);
  } catch {
    /* storage unavailable */
  }
  // a session key is lent to this browser's other open tabs, so a study opened in a new tab can use it too
  channel?.postMessage(key && !remember ? { type: "keys", keys: { [preset]: key } } : { type: "clear", preset });
  changed();
}

/** Any provider's key, kept in this browser. */
export function hasAnyKey(): boolean {
  try {
    return [localStorage, sessionStorage].some((s) => Object.keys(s).some(isKeyName));
  } catch {
    return false;
  }
}

/** Forget every provider's key in this browser (signing out, when asked to). */
export function forgetKeys(): void {
  try {
    for (const s of [localStorage, sessionStorage]) Object.keys(s).filter(isKeyName).forEach((k) => s.removeItem(k));
  } catch {
    /* storage unavailable */
  }
  channel?.postMessage({ type: "clear" });
  changed();
}

const isKeyName = (k: string) => k === KEY_KEY || k.startsWith(`${KEY_KEY}.`);

/** Keys saved before they were kept per provider: given to the provider chosen now, once. */
function adoptOldKey() {
  for (const s of [localStorage, sessionStorage]) {
    const old = s.getItem(KEY_KEY);
    if (old === null) continue;
    s.removeItem(KEY_KEY);
    const name = keyName(loadConfig().preset);
    if (old && s.getItem(name) === null) s.setItem(name, old);
  }
}

/** This tab's session keys, by provider. */
function sessionKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(sessionStorage)) if (k.startsWith(`${KEY_KEY}.`)) out[k.slice(KEY_KEY.length + 1)] = sessionStorage.getItem(k) ?? "";
  return out;
}

// The assistant's setup changed (in this tab, another tab, or the key arrived from another tab).
const EVENT = "testimonia-ai";
function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
export function onAiChange(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CONFIG_KEY || isKeyName(e.key)) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

// A key kept "for this session" sits in one tab's sessionStorage, which a new tab cannot see. Open tabs of this
// site (same origin only) answer a new tab's request for it, so "this session" means the browser's, not the tab's.
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("testimonia.ai");
if (channel) {
  channel.onmessage = (e: MessageEvent) => {
    const m = e.data as { type?: string; keys?: unknown; preset?: unknown };
    try {
      if (m?.type === "need-keys") {
        const keys = sessionKeys();
        if (Object.keys(keys).length) channel.postMessage({ type: "keys", keys });
      } else if (m?.type === "keys" && m.keys && typeof m.keys === "object") {
        let got = false;
        for (const [preset, key] of Object.entries(m.keys as Record<string, unknown>)) {
          const name = keyName(preset);
          if (typeof key !== "string" || !key || localStorage.getItem(name) !== null || sessionStorage.getItem(name) === key) continue;
          sessionStorage.setItem(name, key);
          got = true;
        }
        if (got) changed();
      } else if (m?.type === "clear") {
        const names = typeof m.preset === "string" ? [keyName(m.preset)] : Object.keys(sessionStorage).filter(isKeyName);
        if (names.some((n) => sessionStorage.getItem(n) !== null)) {
          names.forEach((n) => sessionStorage.removeItem(n));
          changed();
        }
      }
    } catch {
      /* storage unavailable */
    }
  };
  channel.postMessage({ type: "need-keys" });
}

/** A model on the user's own machine can only be reached from the browser, never from a hosted server. */
export function runsInBrowser(c: AiConfig): boolean {
  if (c.protocol !== "openai") return false;
  try {
    const host = new URL(c.baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".local");
  } catch {
    return false;
  }
}
