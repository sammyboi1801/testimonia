// Running a question: through the Testimonia server (cloud providers) or directly from the browser (models on
// the user's own machine, which a hosted server cannot reach). Both report the same events.

import type { AiConfig } from "./providers";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; model?: string; usage?: Record<string, number> };

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

const MAX_ROUNDS = 10;

/** Parse a fetch() body of server-sent events, calling onData for each `data:` payload. */
async function readSSE(res: Response, onData: (data: string) => void, signal: AbortSignal): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).replace(/\r$/, "");
      buffer = buffer.slice(cut + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trim());
    }
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown; error?: { message?: string } };
    return String(j.detail ?? j.error?.message ?? res.statusText);
  } catch {
    return res.statusText;
  }
}

/** Cloud providers: the Testimonia server runs the loop with the library tools; the key is used for this call only. */
export async function runOnServer(c: AiConfig, key: string, turns: Turn[], context: string | null, on: (e: AgentEvent) => void, signal: AbortSignal) {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "X-Api-Key": key } : {}) },
    body: JSON.stringify({ provider: c.protocol, model: c.model, base_url: c.protocol === "openai" ? c.baseUrl : null, messages: turns, context }),
    signal,
  });
  if (!res.ok) {
    on({ type: "error", message: await errorText(res) });
    return;
  }
  await readSSE(
    res,
    (data) => {
      try {
        const e = JSON.parse(data) as AgentEvent | { type: "end" };
        if (e.type !== "end") on(e);
      } catch {
        /* ignore malformed lines */
      }
    },
    signal,
  );
}

interface ToolSpec {
  name: string;
  description: string;
  parameters: object;
}

/** Local models: the browser calls the model directly and the Testimonia server only runs the study tools. */
export async function runInBrowser(c: AiConfig, key: string, turns: Turn[], context: string | null, on: (e: AgentEvent) => void, signal: AbortSignal) {
  const spec = (await (await fetch("/api/agent/tools", { signal })).json()) as { system: string; tools: ToolSpec[] };
  const tools = spec.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const system = spec.system + (context ? `\n\nThe reader currently has open: ${context}.` : "");
  const messages: Record<string, unknown>[] = [{ role: "system", content: system }, ...turns];
  const base = c.baseUrl.replace(/\/+$/, "");
  let useTools = true;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: c.model, messages, stream: true, ...(useTools ? { tools } : {}) }),
        signal,
      });
    } catch {
      on({
        type: "error",
        message: `Could not reach ${base}. Is the model server running, and does it allow requests from this site (CORS)?`,
      });
      return;
    }
    if (res.status === 400 && useTools) {
      useTools = false;
      on({ type: "notice", message: "This model does not support tools; answering without the library." });
      continue;
    }
    if (!res.ok) {
      on({ type: "error", message: `Model server error ${res.status}: ${await errorText(res)}` });
      return;
    }
    let text = "";
    const calls: { id: string; name: string; arguments: string }[] = [];
    await readSSE(
      res,
      (data) => {
        if (data === "[DONE]") return;
        let chunk: { choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
        try {
          chunk = JSON.parse(data);
        } catch {
          return;
        }
        for (const choice of chunk.choices ?? []) {
          const d = choice.delta ?? {};
          if (d.content) {
            text += d.content;
            on({ type: "text", text: d.content });
          }
          for (const tc of d.tool_calls ?? []) {
            const slot = (calls[tc.index ?? 0] ??= { id: "", name: "", arguments: "" });
            slot.id = tc.id || slot.id;
            slot.name += tc.function?.name ?? "";
            slot.arguments += tc.function?.arguments ?? "";
          }
        }
      },
      signal,
    );
    const pending = calls.filter(Boolean);
    if (!pending.length) {
      on({ type: "done", model: c.model });
      return;
    }
    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: pending.map((p, i) => ({ id: p.id || `call_${i}`, type: "function", function: { name: p.name, arguments: p.arguments || "{}" } })),
    });
    for (const [i, p] of pending.entries()) {
      let args: unknown = null;
      try {
        args = JSON.parse(p.arguments || "{}");
      } catch {
        /* reported below */
      }
      const first = args && typeof args === "object" ? Object.values(args as Record<string, unknown>).find((v) => typeof v === "string" || typeof v === "number") : "";
      on({ type: "tool", name: p.name, summary: `${p.name.replaceAll("_", " ")}: ${first ?? ""}` });
      let content = "Error: arguments were not valid JSON";
      if (args !== null) {
        const r = await fetch("/api/agent/tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: p.name, input: args }), signal });
        content = r.ok ? ((await r.json()) as { content: string }).content : `Error: ${await errorText(r)}`;
      }
      messages.push({ role: "tool", tool_call_id: p.id || `call_${i}`, content });
    }
  }
  on({ type: "error", message: `Stopped after ${MAX_ROUNDS} tool rounds.` });
}
