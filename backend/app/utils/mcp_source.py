"""Extract file bytes/text, never MCP download receipts, for challenge generation."""
from __future__ import annotations

import base64
import binascii
import json
import re
from typing import Any


_DOWNLOAD_RECEIPT = re.compile(
    r"successfully downloaded (?:text |binary )?file"
    r"(?:\s*\(SHA:\s*[a-f0-9]+\))?\.?",
    re.IGNORECASE,
)
_WRAPPERS = ("item", "items", "data", "result", "payload", "output")


def is_download_receipt(text: Any, *, annotated: bool = False) -> bool:
    """Recognize legacy receipt-only tasks without matching strings in real code."""
    if not isinstance(text, str):
        return False
    if annotated:
        text = "\n".join(
            line for line in text.splitlines()
            if not re.fullmatch(r"\s*(?:#|//)\s*EXPLAIN_TARGET_(?:START|END):[\w-]+\s*", line)
        )
    return _DOWNLOAD_RECEIPT.fullmatch(text.strip()) is not None


def _source_text(value: Any, encoding: str | None = None) -> str | None:
    if encoding is not None and not isinstance(encoding, str):
        return None
    try:
        if encoding and encoding.lower() == "base64":
            if not isinstance(value, (str, bytes)):
                return None
            compact = b"".join(value.split()) if isinstance(value, bytes) else "".join(value.split())
            value = base64.b64decode(compact, validate=True)
        if isinstance(value, bytes):
            value = value.decode("utf-8")
    except (UnicodeError, ValueError, binascii.Error):
        return None
    if not isinstance(value, str) or "\x00" in value:
        return None
    if is_download_receipt(value):
        return None
    return value


def extract_file_text(payload: Any) -> str | None:
    """Support raw MCP resources AND adapter-flattened text blocks.

    Explicit resources/file bodies take precedence over transport text. A bare
    receipt, link, metadata object or ambiguous text list must fail closed.
    Do not join blocks: they can contain status messages rather than file chunks.
    """
    def candidates(value: Any) -> list[tuple[int, str]]:
        if isinstance(value, (str, bytes)):
            text = _source_text(value)
            return [] if text is None else [(0, text)]
        if isinstance(value, (list, tuple)):
            return [candidate for item in value for candidate in candidates(item)]
        if not isinstance(value, dict) or value.get("isError"):
            return []

        if "resource" in value:
            return [(2, text) for _, text in candidates(value["resource"])]
        if value.get("type") in ("resource_link", "image", "audio"):
            return []
        # Text resources may carry bytes; the adapter turns them into file blocks.
        if "blob" in value or (value.get("type") == "file" and "base64" in value):
            text = _source_text(value.get("blob", value.get("base64")), "base64")
            return [] if text is None else [(2, text)]
        if value.get("type") == "file" and ("url" in value or "uri" in value):
            return []  # A link is not the file body; never fetch arbitrary URLs.

        for key in ("content", "raw"):
            if key in value:
                body = value[key]
                if isinstance(body, (str, bytes)):
                    text = _source_text(body, value.get("encoding"))
                    return [] if text is None else [(2, text)]
                return candidates(body)

        if isinstance(value.get("text"), str):
            text = value["text"]
            # Legacy MCP tools wrap GitHub JSON responses in a text block.
            try:
                structured = json.loads(text)
            except (ValueError, TypeError):
                structured = None
            if isinstance(structured, (dict, list)) and "uri" not in value:
                return candidates(structured)
            text = _source_text(text, value.get("encoding"))
            return [] if text is None else [(2 if "uri" in value else 0, text)]

        return [candidate for key in _WRAPPERS for candidate in candidates(value.get(key))]

    found = candidates(payload)
    if not found:
        return None
    priority = max(rank for rank, _ in found)
    texts = {text for rank, text in found if rank == priority}
    return texts.pop() if len(texts) == 1 else None
