// One question to the reader's own assistant (their provider and key, as set up in Ask), its answer streamed back.
// Used by the Bible study's helpers; the chat itself keeps whole conversations.

import { PRESETS, loadConfig, loadKey, runsInBrowser } from "./providers";
import { runInBrowser, runOnServer, type AgentEvent } from "./run";

/** The assistant is set up: a model chosen, and a key where the provider needs one. */
export function assistantReady(): boolean {
  const c = loadConfig();
  const preset = PRESETS.find((p) => p.id === c.preset);
  return !!c.model && (!preset?.needsKey || !!loadKey());
}

/**
 * Ask once. `onText` receives the answer so far (whole, not the latest piece). The assistant may look things up
 * in the library (its tools) but is not let loose on the page: no navigation, no notes changed.
 */
export async function askOnce(question: string, context: string, onText: (text: string) => void, signal: AbortSignal): Promise<string | null> {
  const c = loadConfig();
  const key = loadKey();
  let text = "";
  let error: string | null = null;
  let afterTool = false;
  const on = (e: AgentEvent) => {
    if (e.type === "text") {
      text += afterTool && text && !/\n\s*$/.test(text) ? `\n\n${e.text.replace(/^\s+/, "")}` : e.text;
      afterTool = false;
      onText(text);
    } else if (e.type === "tool") afterTool = true;
    else if (e.type === "error") error = e.message;
  };
  try {
    await (runsInBrowser(c) ? runInBrowser : runOnServer)(c, key, [{ role: "user", content: question }], context, on, signal);
  } catch (e) {
    if (!signal.aborted) error = String(e);
  }
  return error;
}
