"""The study assistant: tools over the database, input validation, URL safety, and the provider loop."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_api import FIXTURE

from testimonia import db
from testimonia.ingest import finalize
from testimonia.ingest.base import Context
from testimonia.server import agent, agent_tools
from testimonia.server.app import create_app
from testimonia.server.store import Store
from testimonia.sources import load


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    path = tmp_path_factory.mktemp("agent") / "core.db"
    con = db.create_core(path)
    con.executescript(FIXTURE)
    finalize.run(Context(con=con, manifest=load()))
    con.close()
    return path


@pytest.fixture(scope="module")
def store(built):
    return Store(built)


@pytest.fixture
def client(built):
    with TestClient(create_app(built, dist=built.parent / "no-dist")) as c:
        yield c


def test_tools_answer_from_the_library(store):
    text, err = agent_tools.run(store, "read_passage", {"reference": "John 1:18", "translations": ["kjva"]})
    assert not err
    assert "John 1:18 (kjva) No man hath seen God" in text
    text, _ = agent_tools.run(store, "study_verse", {"reference": "John 1:18"})
    assert "θεὸς" in text
    assert "Irenaeus" in text
    assert "Flavius Josephus" in text  # listed with the Jewish & Roman writers
    text, _ = agent_tools.run(store, "search_texts", {"query": "begotten", "scope": "bible"})
    assert "[John 1:18](/read/John/1?v=John.1.18)" in text
    text, _ = agent_tools.run(store, "word_study", {"word": "G3439"})
    assert "μονογενής" in text
    text, _ = agent_tools.run(store, "lookup_history", {"name": "josephus"})
    assert "Flavius Josephus: born 37, died 100" in text
    text, _ = agent_tools.run(store, "read_work", {"edition": "irenaeus.haer@anf01", "section": 1})
    assert "the only-begotten God" in text


@pytest.mark.parametrize(
    ("name", "args", "error"),
    [
        ("nope", {}, "unknown tool"),
        ("read_passage", {}, "missing argument 'reference'"),
        ("read_passage", {"reference": 3}, "must be a string"),
        ("search_texts", {"query": "x", "scope": "everywhere"}, "must be one of"),
        ("read_work", {"edition": "x", "section": "1"}, "must be a integer"),
        ("study_verse", {"reference": "John 1:1", "extra": 1}, "unexpected argument"),
        ("study_verse", ["John 1:1"], "must be a JSON object"),
    ],
)
def test_tool_inputs_are_validated(store, name, args, error):
    text, is_error = agent_tools.run(store, name, args)
    assert is_error
    assert error in text


def test_tools_over_http(client):
    spec = client.get("/api/agent/tools").json()
    assert {t["name"] for t in spec["tools"]} == set(agent_tools.FUNCTIONS)
    assert "Testimonia" in spec["system"]
    r = client.post("/api/agent/tool", json={"name": "lookup_history", "input": {"name": "Destruction"}}).json()
    assert r["is_error"] is False
    assert "Destruction of the Second Temple" in r["content"]


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:11434/v1",
        "https://localhost/v1",
        "https://10.0.0.5/v1",
        "https://169.254.169.254/latest",
        "https://100.101.102.103/v1",  # Tailscale / carrier-grade NAT
        "https://[::ffff:10.0.0.1]/v1",  # IPv4-mapped private
        "https://[fd7a:115c:a1e0::1]/v1",  # Tailscale IPv6
        "https://user:pw@example.com/v1",
        "ftp://x",
    ],
)
def test_public_server_refuses_private_urls(url):
    with pytest.raises(HTTPException):
        agent.check_base_url(url, allow_private=False)


def test_public_url_is_pinned_to_the_checked_address(monkeypatch):
    monkeypatch.setattr(agent.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.215.14", 443))])
    url, pin = agent.resolve_base_url("https://models.example.com/v1/", allow_private=False)
    assert (url, pin) == ("https://models.example.com/v1", "93.184.215.14")
    target, headers, ext = agent.pinned_request(url + "/chat/completions", pin, {"A": "1"})
    assert target == "https://93.184.215.14/v1/chat/completions"
    assert headers == {"A": "1", "Host": "models.example.com"}
    assert ext == {"sni_hostname": "models.example.com"}


def test_hostname_resolving_to_a_private_address_is_refused(monkeypatch):
    monkeypatch.setattr(agent.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("100.64.0.7", 443))])
    with pytest.raises(HTTPException):
        agent.resolve_base_url("https://innocent.example.com/v1", allow_private=False)


def test_local_server_may_call_local_models():
    assert agent.check_base_url("http://localhost:11434/v1/", allow_private=True) == "http://localhost:11434/v1"


def test_chat_rejects_bad_requests(client):
    q = {"messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/api/agent/chat", json=q).status_code == 401  # Claude needs a key
    assert client.post("/api/agent/chat", json={**q, "provider": "openai"}).status_code == 400  # needs base_url
    private = {**q, "provider": "openai", "base_url": "http://127.0.0.1:11434/v1", "model": "llama3"}
    assert client.post("/api/agent/chat", json=private).status_code == 400  # public server: no private hosts
    last_not_user = {"messages": [{"role": "assistant", "content": "hi"}]}
    assert client.post("/api/agent/chat", json=last_not_user, headers={"X-Api-Key": "k"}).status_code == 400


def _sse(chunks: list[dict]) -> bytes:
    return "".join(f"data: {json.dumps(c)}\n\n" for c in chunks).encode() + b"data: [DONE]\n\n"


async def test_openai_compatible_loop_runs_tools(store, monkeypatch):
    """First reply calls a tool (streamed in pieces); the second answers in text using the tool result."""
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        assert request.headers["Authorization"] == "Bearer secret"
        if len(seen) == 1:
            args = json.dumps({"reference": "John 1:18", "translations": ["kjva"]})
            chunks = [
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "c1",
                                        "function": {"name": "read_passage", "arguments": args[:10]},
                                    }
                                ]
                            }
                        }
                    ]
                },
                {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": args[10:]}}]}}]},
            ]
        else:
            tool_msg = body["messages"][-1]
            assert tool_msg["role"] == "tool"
            assert "No man hath seen God" in tool_msg["content"]
            chunks = [
                {"choices": [{"delta": {"content": "See "}}]},
                {"choices": [{"delta": {"content": "[John 1:18]."}}]},
            ]
        return httpx.Response(200, content=_sse(chunks), headers={"content-type": "text/event-stream"})

    real = httpx.AsyncClient
    monkeypatch.setattr(agent.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    events = [
        e
        async for e in agent._openai(
            store, "secret", "https://example.org/v1", "m", "sys", [{"role": "user", "content": "q"}]
        )
    ]
    kinds = [e["type"] for e in events]
    assert kinds == ["tool", "text", "text", "done"]
    assert events[0]["summary"] == "read passage: John 1:18"
    assert "".join(e["text"] for e in events if e["type"] == "text") == "See [John 1:18]."
    assert seen[0]["tools"][0]["type"] == "function"
    assert seen[0]["messages"][0] == {"role": "system", "content": "sys"}


async def test_openai_compatible_without_tool_support(store, monkeypatch):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if "tools" in json.loads(request.content):
            return httpx.Response(400, json={"error": {"message": "tools not supported"}})
        return httpx.Response(200, content=_sse([{"choices": [{"delta": {"content": "Plain answer"}}]}]))

    real = httpx.AsyncClient
    monkeypatch.setattr(agent.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    events = [
        e
        async for e in agent._openai(
            store, None, "http://localhost:11434/v1", "m", "s", [{"role": "user", "content": "q"}]
        )
    ]
    assert [e["type"] for e in events] == ["notice", "text", "done"]
    assert calls["n"] == 2


def test_cors_only_for_listed_front_ends(built, monkeypatch):
    monkeypatch.setenv("TESTIMONIA_CORS_ORIGINS", "https://testimonia.web.app")
    with TestClient(create_app(built, dist=built.parent / "no-dist")) as c:
        pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-api-key"}
        ok = c.options("/api/agent/chat", headers={"Origin": "https://testimonia.web.app", **pre})
        assert ok.headers["access-control-allow-origin"] == "https://testimonia.web.app"
        bad = c.options("/api/agent/chat", headers={"Origin": "https://evil.example", **pre})
        assert "access-control-allow-origin" not in bad.headers


def test_chat_stream_is_not_gzipped(client):
    """gzip buffered the event stream until the end; the chat must stream uncompressed (other API calls stay gzipped)."""
    r = client.post(
        "/api/agent/chat",
        json={
            "provider": "openai",
            "model": "m",
            "base_url": "http://localhost:1/v1",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers={"Accept-Encoding": "gzip"},
    )
    assert "gzip" not in r.headers.get("content-encoding", "")
    big = client.get("/api/agent/tools", headers={"Accept-Encoding": "gzip"})  # well over the 1 KB threshold
    assert big.headers.get("content-encoding") == "gzip"


def _wiki(monkeypatch, extract: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("list") == "search":
            return httpx.Response(
                200, json={"query": {"search": [{"title": "Sosthenes"}, {"title": "Sosthenes (disambiguation)"}]}}
            )
        assert request.url.params.get("titles") == "Sosthenes"
        return httpx.Response(200, json={"query": {"pages": [{"title": "Sosthenes", "extract": extract}]}})

    monkeypatch.setattr(agent_tools, "_wiki_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))


ARTICLE = (
    "Sosthenes was the chief ruler of the synagogue at Corinth.\n\n"
    "== Biblical accounts ==\nHe is beaten before Gallio (Acts 18:17).\n\n"
    "=== In 1 Corinthians ===\nPaul names him as co-sender.\n\n"
    "== Tradition ==\nEusebius lists a Sosthenes among the Seventy.\n\n"
    "== References ==\n"
)


def test_wikipedia_gives_the_introduction_and_the_sections(monkeypatch):
    _wiki(monkeypatch, ARTICLE)
    text, is_error = agent_tools.run(None, "wikipedia", {"query": "Sosthenes"})  # type: ignore[arg-type]
    assert not is_error
    assert "https://en.wikipedia.org/wiki/Sosthenes" in text
    assert "secondary source" in text
    assert "chief ruler of the synagogue" in text
    assert "Sections (read any of them" in text
    assert "Biblical accounts; In 1 Corinthians; Tradition" in text  # empty "References" is left out
    assert "beaten before Gallio" not in text  # sections are read on request
    assert "Sosthenes (disambiguation)" in text


def test_wikipedia_reads_a_section_in_full(monkeypatch):
    _wiki(monkeypatch, ARTICLE)
    text, _ = agent_tools.run(None, "wikipedia", {"query": "Sosthenes", "section": "biblical"})  # type: ignore[arg-type]
    assert "## Biblical accounts" in text
    assert "beaten before Gallio" in text
    assert "### In 1 Corinthians" in text  # subsections come with their section
    assert "Eusebius" not in text
    text, _ = agent_tools.run(None, "wikipedia", {"query": "Sosthenes", "section": "nope"})  # type: ignore[arg-type]
    assert "No section 'nope'" in text


def test_wikipedia_offline(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no network", request=request)

    monkeypatch.setattr(agent_tools, "_wiki_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    text, is_error = agent_tools.run(None, "wikipedia", {"query": "x"})  # type: ignore[arg-type]
    assert "could not be reached" in text
    assert not is_error


def test_new_study_tools(store):
    text, is_error = agent_tools.run(store, "compare_translations", {"reference": "John 1:1-9"})
    assert "at most three verses" in text
    for name, args in (
        ("book_overview", {"book": "John"}),
        ("timeline", {"from_year": 30, "to_year": 400}),
        ("compare_translations", {"reference": "John 1:1"}),
        ("fathers_on", {"reference": "John 1:1", "before_year": 325}),
    ):
        text, is_error = agent_tools.run(store, name, args)
        assert not is_error, (name, text)
        assert text.strip(), name
    assert agent_tools.validate("timeline", {"from_year": "30", "to_year": 50}) is not None
