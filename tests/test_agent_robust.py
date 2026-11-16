"""The assistant's safeguards: trimmed history, a per-visitor limit, parallel tools with a time limit, keep-alives."""

from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_agent import built  # noqa: F401  (the shared fixture database)

from testimonia.server import agent
from testimonia.server.app import create_app


def _turn(role: str, text: str = "x") -> dict:
    return {"role": role, "content": text}


def test_history_keeps_the_latest_and_starts_with_the_reader(monkeypatch):
    monkeypatch.setattr(agent, "MAX_TURNS", 4)
    turns = [_turn("user"), _turn("assistant"), _turn("user"), _turn("assistant"), _turn("user", "last")]
    out = agent._trim(turns)
    assert out[0]["role"] == "user"
    assert out[-1]["content"] == "last"
    assert len(out) <= 4


def test_history_is_trimmed_to_a_size(monkeypatch):
    monkeypatch.setattr(agent, "MAX_CHARS", 100)
    turns = [_turn("user", "a" * 80), _turn("assistant", "b" * 80), _turn("user", "now")]
    assert agent._trim(turns) == [_turn("user", "now")]


def test_too_many_questions_are_refused(monkeypatch):
    monkeypatch.setattr(agent, "RATE", (2, 60))
    agent._HITS.clear()
    req = SimpleNamespace(headers={"x-forwarded-for": "203.0.113.9"}, client=None)
    agent._rate_limit(req)
    agent._rate_limit(req)
    with pytest.raises(HTTPException) as e:
        agent._rate_limit(req)
    assert e.value.status_code == 429
    other = SimpleNamespace(headers={"x-forwarded-for": "203.0.113.10"}, client=None)
    agent._rate_limit(other)  # someone else is not affected


def test_tools_of_one_round_run_together(monkeypatch):
    def slow(_s, name, _args):
        time.sleep(0.3)
        return f"{name} done", False, None

    monkeypatch.setattr(agent, "_run_with_action", slow)
    t0 = time.monotonic()
    out = asyncio.run(agent._run_tools(None, [("search", {}), ("verse", {}), ("word", {})]))
    assert [o[0] for o in out] == ["search done", "verse done", "word done"]  # in the order asked
    assert time.monotonic() - t0 < 0.8  # not 0.9 s one after another


def test_a_slow_tool_is_cut_off_and_reported(monkeypatch):
    monkeypatch.setattr(agent, "TOOL_TIMEOUT", 0.1)
    monkeypatch.setattr(agent, "_run_with_action", lambda *_: (time.sleep(0.5), ("late", False, None))[1])
    text, failed, nav = asyncio.run(agent._run_tools(None, [("search", {})]))[0]
    assert failed
    assert "too long" in text
    assert nav is None


def test_unreadable_tool_arguments_are_an_error():
    text, failed, _ = asyncio.run(agent._run_tools(None, [("search", None)]))[0]
    assert failed
    assert "JSON" in text


def test_a_quiet_stream_gets_keep_alives(built, monkeypatch):  # noqa: F811
    monkeypatch.setattr(agent, "HEARTBEAT", 0.05)
    agent._HITS.clear()

    async def thinking(*_args, **_kw):
        await asyncio.sleep(0.25)
        yield {"type": "text", "text": "hello"}

    monkeypatch.setattr(agent, "_claude", thinking)
    with TestClient(create_app(built, dist=built.parent / "no-dist")) as client:
        r = client.post("/api/agent/chat", json={"messages": [_turn("user", "hi")]}, headers={"X-Api-Key": "k"})
    body = r.text
    assert ": keep-alive" in body
    assert '"text": "hello"' in body
    assert '"type": "end"' in body
