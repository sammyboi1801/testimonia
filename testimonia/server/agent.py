"""The study assistant: bring your own key, any provider.

Two wire protocols cover practically every model:

* ``anthropic`` — Claude through Anthropic's official SDK.
* ``openai`` — the OpenAI-compatible Chat Completions protocol, spoken by OpenAI, Google Gemini (its OpenAI
  endpoint), OpenRouter, Groq, DeepSeek, Mistral, Together, xAI, and local servers (Ollama, LM Studio,
  llama.cpp, vLLM).

The browser keeps the conversation as plain text turns and sends them with each question, so the server
stores nothing: no accounts, no history, and the key — sent in the ``X-Api-Key`` header — is used for this one
request and never logged or kept. The same study tools are also served over HTTP so a loop running *in the
browser* can use them with a model on the user's own machine (a hosted server cannot reach their localhost).
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
from collections.abc import AsyncIterator
from contextvars import ContextVar
from typing import Any, Literal
from urllib.parse import urlparse

import anthropic
import httpx
from anthropic.types.beta import BetaMessageParam, BetaToolParam, BetaToolResultBlockParam
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import agent_tools
from .store import Store

router = APIRouter(prefix="/api/agent")

MAX_ROUNDS = 12  # tool round-trips per question (several tools can run in one round)
DEFAULT_CLAUDE = "claude-opus-5-5"
#: Claude models that accept server-side refusal fallbacks in the "default" form (the API picks the fallback).
FALLBACK_DEFAULT = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"}
#: Claude models with the effort control (others ignore it or reject it).
EFFORT_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5", "claude-sonnet-5",
                 "claude-opus-4-8", "claude-opus-4-7", "claude-fable-5-1", "claude-fable-5"}  # fmt: skip

SYSTEM = """You are the research assistant of Testimonia, an open-source Bible study library. You work like a careful
scholar: you read the primary sources before you answer, you cite them, and you separate evidence from inference.

The library you can reach through your tools: 14 Bible translations (with the translators' notes) and the Greek
Septuagint; the Greek New Testament and Hebrew Old Testament word by word, with grammar search and meanings by
semantic domain; where the printed editions differ, and what the early manuscripts themselves read (papyri, codices,
Dead Sea Scrolls); the church fathers and Jewish and Roman writers, readable section by section, with every
quotation of Scripture linked; a timeline of events, writers and rulers; biblical people, places and Paul's journeys;
topics, Gospel parallels and book overviews. A wikipedia tool gives background from outside the library.

You also act inside the app: show_in_app opens a page on the reader's screen beside this chat (a verse, a chapter of
a father, the atlas at a place, a manuscript, the timeline). Use it when seeing helps: "where is Corinth?" opens the
atlas there; "show me 1 Clement 5" opens that chapter. Open at most one page per answer.

The reader's screen: each question tells you what is on their screen right now (page, passage, selected verse, work
and section). Take "this", "here", "this chapter" to mean that, and use its ids directly with your tools.

How to work:
- Read before you answer. To read a work or a long passage, read it in large runs (read_work with `through`), not
  piece by piece. Call several tools at once when they are independent.
- Never invent a quotation, reference, date or reading. Quote briefly and exactly; name the translation when wording
  matters. If the library lacks something, say so plainly; do not repeat a search that found nothing.
- Cite as markdown links using the links the tools return, e.g. [John 1:18](/read/John/1?v=John.1.18),
  [1 Clement 5](/library/<edition>/<section>), [Corinth](/atlas?place=corinth). Cite Wikipedia as Wikipedia,
  kept apart from the primary sources.
- Distinguish what the texts say from interpretation; where scholars or traditions disagree, name the main
  positions fairly and briefly. Dates are approximate unless the sources say otherwise.

How to write:
- Lead with the answer in one or two sentences, then the evidence. Use short sections with headings for longer
  answers, and lists only where items are parallel.
- Professional and measured: no filler, no flattery, no exclamation marks. Answer in the language of the question."""


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=40_000)


class NoteIn(BaseModel):
    osis: str = Field(max_length=40)
    text: str = Field("", max_length=20_000)
    highlight: str | None = Field(None, max_length=20)


#: the reader's notes for the request being answered (read by the notes tool; changes go back to the browser)
NOTES: ContextVar[list[NoteIn]] = ContextVar("notes")


class ChatRequest(BaseModel):
    provider: Literal["anthropic", "openai"] = "anthropic"
    model: str = Field(DEFAULT_CLAUDE, max_length=120)
    base_url: str | None = Field(None, max_length=300)  # OpenAI-compatible endpoint (…/v1)
    messages: list[Turn] = Field(min_length=1, max_length=60)
    context: str | None = Field(None, max_length=1000)  # what is on the reader's screen (page, passage, verse)
    notes: list[NoteIn] | None = Field(None, max_length=5000)  # the reader's notes (they live in the browser)


class ToolCall(BaseModel):
    name: str
    input: dict[str, Any]
    notes: list[NoteIn] | None = Field(default=None, max_length=5000)


def store(request: Request) -> Store:
    s: Store = request.app.state.store
    return s


# ----------------------------------------------------------------------------- tools over HTTP (browser loops)


@router.get("/tools")
def tools() -> dict[str, Any]:
    """The study tools as JSON schemas, plus the system prompt, for an assistant loop running in the browser."""
    return {"system": SYSTEM, "tools": agent_tools.TOOLS}


@router.post("/tool")
def tool(request: Request, call: ToolCall) -> dict[str, Any]:
    if call.name == "notes":
        error = agent_tools.validate("notes", call.input)
        text, is_error = (f"Error: {error}", True) if error else agent_tools.notes_tool(call.notes or [], call.input)
        osis = agent_tools.note_osis(str(call.input.get("verse", ""))) if not is_error else ""
        return {"content": text, "is_error": is_error, "osis": osis}
    text, is_error = agent_tools.run(store(request), call.name, call.input)
    return {"content": text, "is_error": is_error}


# ----------------------------------------------------------------------------- server-side loop


def _is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Only globally routable unicast addresses: excludes private, loopback, link-local (cloud metadata),
    carrier-grade NAT (100.64.0.0/10, e.g. Tailscale), reserved and multicast ranges."""
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def resolve_base_url(url: str, allow_private: bool) -> tuple[str, str | None]:
    """Check a user-supplied endpoint; returns (url, address to connect to). The address is pinned so the
    host cannot resolve to something else between this check and the request (DNS rebinding)."""
    p = urlparse(url)
    if p.scheme not in ("https", "http") or not p.hostname:
        raise HTTPException(400, "base_url must be an http(s) URL")
    if allow_private:
        return url.rstrip("/"), None
    if p.scheme != "https":
        raise HTTPException(400, "base_url must use https on this server")
    if p.username or p.password:
        raise HTTPException(400, "base_url must not contain credentials")
    try:
        addrs = [ai[4][0] for ai in socket.getaddrinfo(p.hostname, p.port or 443, type=socket.SOCK_STREAM)]
    except OSError as e:
        raise HTTPException(400, f"cannot resolve {p.hostname}") from e
    ips = [ipaddress.ip_address(str(a).split("%")[0]) for a in addrs]
    if not ips or not all(_is_public(ip) for ip in ips):
        raise HTTPException(
            400, "this server does not call private or local addresses — use 'run in my browser' for local models"
        )
    return url.rstrip("/"), str(ips[0])


def check_base_url(url: str, allow_private: bool) -> str:
    """Refuse URLs a public server must not call on a user's behalf (internal hosts, cloud metadata, plain HTTP)."""
    return resolve_base_url(url, allow_private)[0]


def pinned_request(url: str, pin: str | None, headers: dict[str, str]) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Rewrite a request to go to the checked address while TLS still verifies the original host name."""
    if pin is None:
        return url, headers, {}
    p = urlparse(url)
    host = p.hostname or ""
    ip = f"[{pin}]" if ":" in pin else pin
    port = f":{p.port}" if p.port else ""
    return (
        p._replace(netloc=ip + port).geturl(),
        {**headers, "Host": host + port},
        {"sni_hostname": host},
    )


@router.post("/chat")
async def chat(request: Request, body: ChatRequest, x_api_key: str | None = Header(None)) -> StreamingResponse:
    """Answer one question with the chosen model and the study tools; streams server-sent events."""
    allow_private = bool(getattr(request.app.state, "agent_allow_private", False))
    base = ""
    pin: str | None = None
    if body.provider == "openai":
        if not body.base_url:
            raise HTTPException(400, "base_url is required for OpenAI-compatible providers")
        base, pin = await asyncio.to_thread(resolve_base_url, body.base_url, allow_private)
    elif not x_api_key:
        raise HTTPException(401, "an Anthropic API key is required (X-Api-Key header)")
    s = store(request)
    system = SYSTEM + (f"\n\nOn the reader's screen now: {body.context}." if body.context else "")
    if body.notes is not None:
        system += f"\nThe reader has {len(body.notes)} notes and highlights; the notes tool reads and changes them."
    turns = [t.model_dump() for t in body.messages]
    if turns[-1]["role"] != "user":
        raise HTTPException(400, "the last message must be the user's question")

    async def events() -> AsyncIterator[str]:
        NOTES.set(body.notes or [])  # set inside the streaming task, where the tools run
        try:
            if body.provider == "anthropic":
                gen = _claude(s, x_api_key or "", body.model or DEFAULT_CLAUDE, system, turns)
            else:
                gen = _openai(s, x_api_key, base, body.model, system, turns, pin=pin)
            async for event in gen:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except anthropic.AuthenticationError:
            yield _sse({"type": "error", "message": "The API key was not accepted."})
        except anthropic.PermissionDeniedError:
            yield _sse({"type": "error", "message": "This key may not use that model."})
        except anthropic.NotFoundError:
            yield _sse({"type": "error", "message": f"Unknown model {body.model!r}."})
        except anthropic.RateLimitError:
            yield _sse({"type": "error", "message": "Rate limited by the provider — wait a moment and try again."})
        except anthropic.APIStatusError as e:
            yield _sse({"type": "error", "message": f"Provider error {e.status_code}: {e.message}"})
        except anthropic.APIConnectionError:
            yield _sse({"type": "error", "message": "Could not reach the provider."})
        except httpx.HTTPStatusError as e:
            yield _sse({"type": "error", "message": f"Provider error {e.response.status_code}: {_detail(e.response)}"})
        except httpx.HTTPError as e:
            yield _sse({"type": "error", "message": f"Could not reach the provider: {type(e).__name__}"})
        yield _sse({"type": "end"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # no-transform / X-Accel-Buffering: proxies (nginx, CDNs) must pass each event on at once
        headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"},
    )


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _detail(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        err = data.get("error", data)
        return str(err.get("message", err) if isinstance(err, dict) else err)[:300]
    except ValueError:
        return resp.text[:300]


async def _tool(s: Store, name: str, args: Any) -> tuple[str, bool]:
    if name == "notes":  # the notes live in the browser: read them from the request, send changes back
        error = agent_tools.validate(name, args)
        return (f"Error: {error}", True) if error else agent_tools.notes_tool(NOTES.get([]), args)
    return await asyncio.to_thread(agent_tools.run, s, name, args)


def _summary(name: str, args: Any) -> str:
    if isinstance(args, dict) and name == "read_work":  # say which part was read, not just the edition
        span = f"§{args.get('section')}" + (f"–{args['through']}" if args.get("through") else "")
        return f"read work: {str(args.get('edition', '')).split('@')[0].split('.')[-1].replace('-', ' ')} {span}"[:120]
    if isinstance(args, dict):
        first = next((str(v) for v in args.values() if isinstance(v, (str, int))), "")
        return f"{name.replace('_', ' ')}: {first}"[:120]
    return name


# ----------------------------------------------------------------------------- Claude (official SDK)


async def _claude(
    s: Store, key: str, model: str, system: str, turns: list[dict[str, Any]]
) -> AsyncIterator[dict[str, Any]]:
    client = anthropic.AsyncAnthropic(api_key=key, max_retries=2, timeout=300)
    tool_defs: list[BetaToolParam] = [
        {
            "name": t["name"],
            "description": t["description"],
            "input_schema": t["parameters"],
            "eager_input_streaming": True,
        }
        for t in agent_tools.TOOLS
    ]
    # earlier turns are plain text (no thinking blocks are replayed); this question's turn is append-only
    messages: list[BetaMessageParam] = [{"role": t["role"], "content": t["content"]} for t in turns]
    extra: dict[str, Any] = {}
    if model in FALLBACK_DEFAULT:
        extra.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    if model in EFFORT_MODELS:
        extra["output_config"] = {"effort": "medium"}
    json_retries = 0
    for _ in range(MAX_ROUNDS):
        try:
            async with client.beta.messages.stream(
                model=model,
                max_tokens=16000,
                system=[{"type": "text", "text": system}],
                tools=tool_defs,
                messages=messages,
                cache_control={"type": "ephemeral"},
                **extra,
            ) as stream:
                async for event in stream:
                    if event.type == "text":
                        yield {"type": "text", "text": event.text}
                response = await stream.get_final_message()
            json_retries = 0
        except ValueError:  # tool input the SDK could not parse at all: re-issue this turn (bounded)
            json_retries += 1
            if json_retries > 2:
                yield {"type": "error", "message": "The model produced an unreadable tool call."}
                return
            continue
        if response.stop_reason == "refusal":
            yield {"type": "error", "message": "The model declined to answer this request."}
            return
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        messages.append({"role": "assistant", "content": response.content})
        if not tool_uses:
            yield {"type": "done", "model": response.model, "usage": _usage(response.usage)}
            return
        if response.stop_reason == "max_tokens":
            yield {"type": "error", "message": "The answer ran out of room while calling a tool."}
            return
        results: list[BetaToolResultBlockParam] = []
        for block in tool_uses:
            yield {"type": "tool", "name": block.name, "summary": _summary(block.name, block.input)}
            text, is_error = await _tool(s, block.name, block.input)
            if nav := _navigation(block.name, block.input, is_error):
                yield nav
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": text, "is_error": is_error})
        messages.append({"role": "user", "content": results})  # all results of one turn in a single message
    yield {"type": "error", "message": f"Stopped after {MAX_ROUNDS} tool rounds."}


def _navigation(name: str, args: Any, failed: bool) -> dict[str, Any] | None:
    """Actions the browser carries out: show_in_app opens a page; notes changes are applied to the reader's notes."""
    if failed or not isinstance(args, dict):
        return None
    if name == "show_in_app":
        return {"type": "navigate", "link": str(args.get("link", ""))}
    if name == "notes" and args.get("action") in ("add", "replace", "remove", "highlight"):
        osis = agent_tools.note_osis(str(args.get("verse", "")))
        return {
            "type": "note",
            "action": args["action"],
            "osis": osis,
            "text": str(args.get("text", "")),
            "highlight": args.get("color"),
        }
    return None


def _usage(u: Any) -> dict[str, int]:
    return {k: int(getattr(u, k, 0) or 0) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens")}


# ----------------------------------------------------------------------------- OpenAI-compatible (any provider)


async def _openai(
    s: Store,
    key: str | None,
    base: str,
    model: str,
    system: str,
    turns: list[dict[str, Any]],
    pin: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    tool_defs = [
        {
            "type": "function",
            "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]},
        }
        for t in agent_tools.TOOLS
    ]
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *turns]
    use_tools = True
    async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=15)) as http:
        for _ in range(MAX_ROUNDS):
            payload: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
            if use_tools:
                payload["tools"] = tool_defs
            text_parts: list[str] = []
            calls: dict[int, dict[str, str]] = {}
            url, req_headers, ext = pinned_request(f"{base}/chat/completions", pin, headers)
            async with http.stream("POST", url, headers=req_headers, json=payload, extensions=ext) as resp:
                if resp.status_code == 400 and use_tools:
                    # some local models don't support tools: answer from the model alone
                    await resp.aread()
                    use_tools = False
                    yield {
                        "type": "notice",
                        "message": "This model does not support tools; answering without the library.",
                    }
                    continue
                if resp.status_code >= 400:
                    await resp.aread()
                    resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    for choice in chunk.get("choices", []):
                        delta = choice.get("delta") or {}
                        if delta.get("content"):
                            text_parts.append(delta["content"])
                            yield {"type": "text", "text": delta["content"]}
                        for tc in delta.get("tool_calls") or []:
                            slot = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "arguments": ""})
                            slot["id"] = tc.get("id") or slot["id"]
                            fn = tc.get("function") or {}
                            slot["name"] += fn.get("name") or ""
                            slot["arguments"] += fn.get("arguments") or ""
            if not calls:
                yield {"type": "done", "model": model}
                return
            ordered = [calls[i] for i in sorted(calls)]
            messages.append(
                {
                    "role": "assistant",
                    "content": "".join(text_parts) or None,
                    "tool_calls": [
                        {
                            "id": c["id"] or f"call_{i}",
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"] or "{}"},
                        }
                        for i, c in enumerate(ordered)
                    ],
                }
            )
            for i, c in enumerate(ordered):
                try:
                    args = json.loads(c["arguments"] or "{}")
                except ValueError:
                    args = None
                yield {"type": "tool", "name": c["name"], "summary": _summary(c["name"], args)}
                text, failed = (
                    await _tool(s, c["name"], args)
                    if args is not None
                    else ("Error: arguments were not valid JSON", True)
                )
                if nav := _navigation(c["name"], args, failed):
                    yield nav
                messages.append({"role": "tool", "tool_call_id": c["id"] or f"call_{i}", "content": text})
    yield {"type": "error", "message": f"Stopped after {MAX_ROUNDS} tool rounds."}
