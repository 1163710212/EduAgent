from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Generic, TypeVar

import requests
from pydantic import BaseModel

from app.core.config import settings

SchemaT = TypeVar("SchemaT", bound=BaseModel)
DEFAULT_LOCAL_LLM_URL = "http://127.0.0.1:6011/api/generate"
LOCAL_LLM_TIMEOUT_SECONDS = 180


def _iter_balanced_json_objects(text: str) -> list[dict[str, Any]]:
    trimmed = text.strip()
    candidates: list[dict[str, Any]] = []
    for start_idx, ch in enumerate(trimmed):
        if ch != "{":
            continue

        depth = 0
        in_string = False
        escaped = False
        for i in range(start_idx, len(trimmed)):
            c = trimmed[i]
            if in_string:
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == '"':
                    in_string = False
                continue

            if c == '"':
                in_string = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    candidate = trimmed[start_idx : i + 1]
                    try:
                        data = json.loads(candidate)
                    except Exception:
                        break
                    if isinstance(data, dict):
                        candidates.append(data)
                    break
    return candidates


def _extract_json_candidates(text: str) -> list[dict[str, Any]]:
    """
    Try to parse model output into multiple JSON objects.
    Accepts plain JSON, fenced JSON, and JSON wrapped by extra text.
    """
    trimmed = text.strip()
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add_raw_candidate(data: dict[str, Any]) -> None:
        try:
            key = json.dumps(data, ensure_ascii=False, sort_keys=True)
        except Exception:
            key = repr(data)
        if key in seen:
            return
        seen.add(key)
        candidates.append(data)

    def add_candidate(data: dict[str, Any]) -> None:
        changed_file = data.get("changed_file")
        if isinstance(changed_file, str):
            unwrapped = _unwrap_single_payload_object_wrapper(changed_file)
            if unwrapped != changed_file:
                normalized = dict(data)
                normalized["changed_file"] = unwrapped
                _add_raw_candidate(normalized)
        _add_raw_candidate(data)

    # 1) Direct JSON object
    try:
        data = json.loads(trimmed)
        if isinstance(data, dict):
            add_candidate(data)
    except Exception:
        pass

    # 2) Fenced blocks: ```json ... ```
    for block in re.findall(r"```(?:json)?\s*(.*?)```", trimmed, flags=re.DOTALL | re.IGNORECASE):
        try:
            data = json.loads(block.strip())
            if isinstance(data, dict):
                add_candidate(data)
        except Exception:
            continue

    # 3) All balanced {...} blocks in text
    for data in _iter_balanced_json_objects(trimmed):
        add_candidate(data)

    # 4) Relaxed fallback for malformed single-field ChallengeArtifact outputs.
    # Typical bad output examples:
    # {"changed_file": """ ...code... """}
    # {"changed_file": "...\n..."}  (with malformed escaping/newlines)
    relaxed_changed_file = _extract_relaxed_changed_file_candidate(trimmed)
    if relaxed_changed_file is not None:
        add_candidate(relaxed_changed_file)

    return candidates


def _extract_relaxed_changed_file_candidate(text: str) -> dict[str, Any] | None:
    match = re.search(r'["\']changed_file["\']\s*:\s*', text, flags=re.IGNORECASE)
    if not match:
        return None

    value = text[match.end() :].lstrip()
    if not value:
        return None

    # Python-style triple-quoted string: """...""" or '''...'''
    if value.startswith('"""') or value.startswith("'''"):
        quote = value[:3]
        end = value.find(quote, 3)
        if end != -1:
            return {"changed_file": value[3:end]}

    # Quoted string value (possibly with malformed escaping/newlines).
    if value[0] in ('"', "'"):
        quote = value[0]
        i = 1
        escaped = False
        buf: list[str] = []
        while i < len(value):
            c = value[i]
            if escaped:
                buf.append(c)
                escaped = False
                i += 1
                continue
            if c == "\\":
                buf.append(c)
                escaped = True
                i += 1
                continue
            if c == quote:
                raw_inner = "".join(buf)
                if quote == '"':
                    # Best effort: decode JSON escapes if possible.
                    try:
                        parsed = json.loads(f'"{raw_inner}"')
                    except Exception:
                        parsed = raw_inner
                else:
                    parsed = raw_inner.replace("\\'", "'").replace("\\\\", "\\")
                return {"changed_file": _unwrap_single_payload_object_wrapper(parsed)}
            buf.append(c)
            i += 1

        # Unclosed quoted string: still return best effort payload.
        return {"changed_file": _unwrap_single_payload_object_wrapper("".join(buf).strip())}

    # Bare value fallback: capture until trailing object close if present.
    end = value.rfind("}")
    candidate = value[:end] if end != -1 else value
    candidate = candidate.rstrip().rstrip(",").strip()
    if not candidate:
        return None
    return {"changed_file": candidate}


def _unwrap_single_payload_object_wrapper(value: str) -> str:
    """
    Recover payload from malformed wrapper like:
    {"<actual code payload>"}
    """
    stripped = value.strip()
    m = re.fullmatch(r'\{\s*"(?P<body>(?:[^"\\]|\\.)*)"\s*\}', stripped, flags=re.DOTALL)
    if not m:
        return value

    body = m.group("body")
    try:
        return json.loads(f'"{body}"')
    except Exception:
        return body


def _extract_json_object(text: str) -> dict[str, Any]:
    candidates = _extract_json_candidates(text)
    if candidates:
        return candidates[0]

    raise ValueError("Model output is not a valid JSON object.")


class LocalLlama3Model:
    """
    Minimal local llama3 client compatible with current graph usage:
    build_chat_model(...).with_structured_output(Schema).ainvoke(prompt)
    """

    def __init__(self, *, temperature: float):
        self.temperature = temperature

    def with_structured_output(self, schema: type[SchemaT]) -> "LocalLlama3StructuredModel[SchemaT]":
        return LocalLlama3StructuredModel(base=self, schema=schema)

    @staticmethod
    def _resolve_base_url() -> str:
        # configured = (settings.OPENAI_BASE_URL or "").strip()
        # if not configured:
        #     return DEFAULT_LOCAL_LLM_URL
        # return configured.rstrip("/")
        return DEFAULT_LOCAL_LLM_URL

    @staticmethod
    def _extract_chat_completion_text(data: dict[str, Any]) -> str:
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("Invalid chat completion response: missing choices.")

        first = choices[0]
        if not isinstance(first, dict):
            raise ValueError("Invalid chat completion response: malformed choice.")

        message = first.get("message")
        if not isinstance(message, dict):
            raise ValueError("Invalid chat completion response: missing message.")

        content = message.get("content")
        if isinstance(content, str):
            return content

        # Some OpenAI-compatible providers return content chunks.
        if isinstance(content, list):
            parts: list[str] = []
            for chunk in content:
                if isinstance(chunk, str):
                    parts.append(chunk)
                    continue
                if isinstance(chunk, dict) and isinstance(chunk.get("text"), str):
                    parts.append(chunk["text"])
            text = "".join(parts).strip()
            if text:
                return text

        raise ValueError("Invalid chat completion response: missing content text.")

    @staticmethod
    def _chat_completions_url(base_url: str) -> str:
        if base_url.endswith("/chat/completions"):
            return base_url
        if base_url.endswith("/v1"):
            return f"{base_url}/chat/completions"
        return f"{base_url}/v1/chat/completions"

    def invoke(self, prompt: str) -> str:
        model = "llama3.1"
        base_url = self._resolve_base_url()

        if base_url.endswith("/api/generate"):
            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False,
            }
            response = requests.post(base_url, json=payload)
            # response.raise_for_status()
            data = response.json()
            text = data.get("response")
            print(f"mushxx{text}")
            if not isinstance(text, str):
                raise ValueError("Invalid generate response: missing 'response' string field.")
            return text

        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature,
            "stream": False,
        }
        headers = {"Content-Type": "application/json"}
        if settings.OPENAI_API_KEY:
            headers["Authorization"] = f"Bearer {settings.OPENAI_API_KEY}"

        response = requests.post(
            self._chat_completions_url(base_url),
            json=payload,
            headers=headers,
            timeout=LOCAL_LLM_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
        return self._extract_chat_completion_text(data)

    async def ainvoke(self, prompt: str) -> str:
        return await asyncio.to_thread(self.invoke, prompt)


class LocalLlama3StructuredModel(Generic[SchemaT]):
    def __init__(self, *, base: LocalLlama3Model, schema: type[SchemaT]):
        self.base = base
        self.schema = schema

    def _build_prompt(self, prompt: str) -> str:
        schema_json = json.dumps(self.schema.model_json_schema(), ensure_ascii=False)
        return (
            f"{prompt}\n\n"
            "Return exactly one JSON object that satisfies the given JSON Schema. "
            "Do not output markdown code fences or any extra explanation. "
            "Do not repeat the input content or the JSON Schema. "
            "The output must start with { and end with }.\n"
            f"JSON Schema:\n{schema_json}"
        )

    def _build_repair_prompt(self, raw_text: str) -> str:
        schema_json = json.dumps(self.schema.model_json_schema(), ensure_ascii=False)
        clipped = raw_text.strip()
        if len(clipped) > 24000:
            clipped = clipped[:24000]
        return (
            "You are a JSON repair assistant. Below is prior model output text that may not be valid JSON.\n"
            "Repair it into one valid JSON object that satisfies the given JSON Schema.\n"
            "Output only the JSON object itself, with no explanation, code fences, or extra prefixes/suffixes.\n"
            "Preserve the original meaning as much as possible and do not invent unrelated information.\n\n"
            f"JSON Schema:\n{schema_json}\n\n"
            "Text to repair:\n"
            f"{clipped}"
        )

    @staticmethod
    def _preview(text: str, limit: int = 2400) -> str:
        cleaned = " ".join((text or "").split())
        if len(cleaned) <= limit:
            return cleaned
        return f"{cleaned[:limit]}..."

    @staticmethod
    def _retry_cycle_limit() -> int:
        # 0 means no cap (retry until model returns valid structured output).
        value = int(getattr(settings, "LLM_STRUCTURED_MAX_RETRY_CYCLES", 0) or 0)
        return max(0, value)

    def _parse_structured(self, raw_text: str) -> SchemaT:
        candidates = _extract_json_candidates(raw_text)
        if not candidates:
            raise ValueError("Model output is not a valid JSON object.")

        first_error: Exception | None = None
        for candidate in candidates:
            try:
                return self.schema.model_validate(candidate)
            except Exception as e:
                if first_error is None:
                    first_error = e
                continue

        # 没有任何候选可通过 schema 校验，抛首个错误便于定位字段缺失
        assert first_error is not None
        raise first_error

    def invoke(self, prompt: str) -> SchemaT:
        request_prompt = self._build_prompt(prompt)
        cycle_limit = self._retry_cycle_limit()
        cycle = 0
        first_error: Exception | None = None
        second_error: Exception | None = None
        first_preview = ""
        second_preview = ""

        while True:
            cycle += 1
            raw_text = self.base.invoke(request_prompt)
            try:
                return self._parse_structured(raw_text)
            except Exception as e:
                first_error = e
                first_preview = self._preview(raw_text)

            repaired_text = self.base.invoke(self._build_repair_prompt(raw_text))
            try:
                return self._parse_structured(repaired_text)
            except Exception as e:
                second_error = e
                second_preview = self._preview(repaired_text)

            if cycle_limit > 0 and cycle >= cycle_limit:
                raise ValueError(
                    "Model output is not a valid JSON object after retry cycles. "
                    f"cycles={cycle}; first_error={first_error}; second_error={second_error}; "
                    f"first_preview='{first_preview}'; second_preview='{second_preview}'"
                ) from second_error

    async def ainvoke(self, prompt: str) -> SchemaT:
        request_prompt = self._build_prompt(prompt)
        cycle_limit = self._retry_cycle_limit()
        cycle = 0
        first_error: Exception | None = None
        second_error: Exception | None = None
        first_preview = ""
        second_preview = ""

        while True:
            cycle += 1
            raw_text = await self.base.ainvoke(request_prompt)
            try:
                return self._parse_structured(raw_text)
            except Exception as e:
                first_error = e
                first_preview = self._preview(raw_text)

            repaired_text = await self.base.ainvoke(self._build_repair_prompt(raw_text))
            try:
                return self._parse_structured(repaired_text)
            except Exception as e:
                second_error = e
                second_preview = self._preview(repaired_text)

            if cycle_limit > 0 and cycle >= cycle_limit:
                raise ValueError(
                    "Model output is not a valid JSON object after retry cycles. "
                    f"cycles={cycle}; first_error={first_error}; second_error={second_error}; "
                    f"first_preview='{first_preview}'; second_preview='{second_preview}'"
                ) from second_error


def build_chat_model(*, temperature: float) -> LocalLlama3Model:
    """
    Build a model client backed by:
    - <OPENAI_BASE_URL>/api/generate, or
    - <OPENAI_BASE_URL>/v1/chat/completions
    """
    return LocalLlama3Model(temperature=temperature)
