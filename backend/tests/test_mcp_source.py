"""Exercise the installed adapter, not just hand-written raw MCP responses."""
import base64
import json

import pytest
from langchain_mcp_adapters.tools import _convert_mcp_content_to_lc_block
from mcp.types import BlobResourceContents, EmbeddedResource, TextContent, TextResourceContents

from app.utils.mcp_source import extract_file_text, is_download_receipt


RECEIPT = "successfully downloaded text file (SHA: 5cabdcba70a0d3d9c3f5598eb4dc930607701f37)"
SOURCE = '# 中文说明\nmessage = "successfully downloaded text file"\n\ndef run():\n    return message\n'


@pytest.mark.parametrize("converted", [False, True])
@pytest.mark.parametrize("binary", [False, True])
@pytest.mark.parametrize("reverse", [False, True])
def test_actual_adapter_preserves_source_not_receipt(converted, binary, reverse):
    resource = (BlobResourceContents(uri="file:///main.py", mimeType="text/x-python",
                                     blob=base64.b64encode(SOURCE.encode()).decode())
                if binary else TextResourceContents(uri="file:///main.py", mimeType="text/x-python", text=SOURCE))
    blocks = [TextContent(type="text", text=RECEIPT), EmbeddedResource(type="resource", resource=resource)]
    if reverse:
        blocks.reverse()
    payload = ([_convert_mcp_content_to_lc_block(block) for block in blocks] if converted
               else [block.model_dump() for block in blocks])
    assert extract_file_text(payload) == SOURCE


@pytest.mark.parametrize("payload", [
    RECEIPT,
    [{"type": "text", "text": RECEIPT}],
    {"content": [{"type": "text", "text": "Successfully downloaded file"}]},
    {"result": [{"type": "text", "text": RECEIPT}]},
    {"content": RECEIPT},
    {"content": base64.b64encode(RECEIPT.encode()).decode(), "encoding": "base64"},
    [{"type": "text", "text": RECEIPT}, {"type": "resource_link", "uri": "https://example.com/main.py"}],
    [{"type": "text", "text": RECEIPT}, {"type": "file", "url": "https://example.com/main.py"}],
    {"isError": True, "content": SOURCE},
    {"type": "text", "text": json.dumps({"sha": "abc", "path": "main.py", "size": 120})},
    {"content": "not!base64!", "encoding": "base64"},
    {"content": base64.b64encode(b"\xff\x00").decode(), "encoding": "base64"},
    [{"text": "Download response"}, {"text": SOURCE}],
])
def test_invalid_or_ambiguous_payloads_fail_closed(payload):
    assert extract_file_text(payload) is None


@pytest.mark.parametrize("payload", [
    SOURCE,
    SOURCE.encode(),
    {"content": SOURCE, "encoding": "utf-8"},
    {"result": {"content": SOURCE}},
    {"content": [{"text": RECEIPT}, {"text": SOURCE}]},
    [{"text": RECEIPT}, {"text": json.dumps({"content": base64.b64encode(SOURCE.encode()).decode(), "encoding": "base64"})}],
    [{"text": "Transport metadata"}, {"resource": {"text": SOURCE}}],
])
def test_supported_shapes_preserve_source_verbatim(payload):
    assert extract_file_text(payload) == SOURCE


def test_json_file_body_is_not_treated_as_transport_metadata():
    source = '{"name": "example", "items": [1, 2]}'
    assert extract_file_text({"resource": {"uri": "file:///config.json", "text": source}}) == source
    assert extract_file_text({"content": source}) == source


def test_reported_receipt_and_legacy_annotation():
    receipt = "successfully downloaded text file (SHA: 0b79d09327c11894ad33bcaf10ab6b79c8cfccf2)"
    annotated = f"# EXPLAIN_TARGET_START:focus_1\n{receipt}\n# EXPLAIN_TARGET_END:focus_1"
    assert extract_file_text([{"type": "text", "text": receipt}]) is None
    assert is_download_receipt(annotated, annotated=True)
    assert not is_download_receipt(SOURCE, annotated=True)
    assert not is_download_receipt(f'message = "{receipt}"', annotated=True)
