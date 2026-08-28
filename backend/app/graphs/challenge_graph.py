from __future__ import annotations

import base64
import json
import re
import traceback
from typing import List, Dict, Any
from urllib.parse import urlparse

from langgraph.graph import StateGraph, END

from app.core.llm import build_chat_model
from app.core.mcp import GitHubMCP
from app.graphs.state import ChallengeState
from app.graphs.prompts import ChallengeArtifact, ExplainArtifact


def _parse_github_url(repo_url: str) -> tuple[str, str]:
    """
    支持：
    - https://github.com/OWNER/REPO
    - https://github.com/OWNER/REPO.git
    - github.com/OWNER/REPO
    - git@github.com:OWNER/REPO.git
    - OWNER/REPO
    """
    raw = (repo_url or "").strip()
    if not raw:
        raise ValueError("repo_url is required.")

    # 支持简写：OWNER/REPO
    shorthand = re.fullmatch(r"([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(?:\.git)?/?", raw)
    if shorthand:
        owner, repo = shorthand.group(1), shorthand.group(2)
        return owner, repo.removesuffix(".git")

    # 支持无 schema 的 github.com 链接
    if raw.startswith("github.com/") or raw.startswith("www.github.com/"):
        raw = f"https://{raw}"

    # 支持 SSH clone 格式：git@github.com:OWNER/REPO(.git)
    if raw.startswith("git@github.com:"):
        raw = "ssh://" + raw.replace(":", "/", 1)

    u = urlparse(raw)
    host = u.netloc.lower()
    if host == "git@github.com":
        host = "github.com"
    if host not in ("github.com", "www.github.com"):
        raise ValueError("Only github.com URLs are supported in this MVP.")

    parts = [p for p in u.path.split("/") if p]
    if len(parts) < 2:
        raise ValueError("Invalid GitHub repo URL.")
    owner, repo = parts[0], parts[1]
    repo = repo.removesuffix(".git")
    if not owner or not repo:
        raise ValueError("Invalid GitHub repo URL.")
    return owner, repo


async def node_parse_repo(state: ChallengeState) -> ChallengeState:
    try:
        owner, repo = _parse_github_url(state["repo_url"])
        state["owner"] = owner
        state["repo"] = repo
        state.setdefault("ref", "main")
        state.setdefault("language", "python")
        task_type = (state.get("task_type") or "rewrite").strip().lower()
        if task_type not in ("rewrite", "blank_fill"):
            raise ValueError("task_type must be one of: rewrite, blank_fill")
        state["task_type"] = task_type
        return state
    except Exception as e:
        state["error"] = str(e)
        return state


def _language_extensions(language: str) -> List[str]:
    return {
        "python": [".py"],
        "javascript": [".js", ".ts", ".jsx", ".tsx"],
        "java": [".java"],
        "cpp": [".cpp", ".cc", ".cxx", ".h", ".hpp"],
        "go": [".go"],
    }.get(language.lower(), [".py"])


def _pick_paths_from_tree(tree: Any, language: str, max_files: int = 1) -> List[str]:
    """
    tree 返回结构随 MCP 实现而异，这里做尽量稳健的抽取。
    """
    exts = _language_extensions(language)

    # 常见：{"tree": [{"path":"...","type":"blob"}, ...]}
    candidates: List[str] = []
    if isinstance(tree, dict):
        items = tree.get("tree") or tree.get("items") or tree.get("data") or []
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                p = it.get("path") or it.get("name")
                t = it.get("type") or it.get("kind")
                if not p:
                    continue
                if t and str(t).lower() not in ("blob", "file"):
                    continue
                if any(p.endswith(ext) for ext in exts):
                    # 简单避开虚拟环境/依赖目录
                    if re.search(r"(^|/)(venv|node_modules|dist|build|\.git)/", p):
                        continue
                    candidates.append(p)

    # 兜底：如果没有 tree，返回空
    return candidates[:]


def _extract_json_from_mcp_payload(payload: Any) -> Any | None:
    """Decode JSON embedded in MCP text-content wrapper objects."""
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except Exception:
            return None

    if isinstance(payload, (list, tuple)):
        for item in payload:
            decoded = _extract_json_from_mcp_payload(item)
            if decoded is not None:
                return decoded
        return None

    if not isinstance(payload, dict):
        return None

    text = payload.get("text")
    if isinstance(text, str):
        decoded = _extract_json_from_mcp_payload(text)
        if decoded is not None:
            return decoded

    for key in ("content", "data", "result", "payload", "output"):
        decoded = _extract_json_from_mcp_payload(payload.get(key))
        if decoded is not None:
            return decoded
    return None


def _directory_entries(payload: Any) -> List[Dict[str, Any]]:
    decoded = _extract_json_from_mcp_payload(payload)
    if isinstance(decoded, dict):
        decoded = decoded.get("items") or decoded.get("entries") or decoded.get("data") or []
    if not isinstance(decoded, list):
        return []
    return [item for item in decoded if isinstance(item, dict)]


async def _pick_paths_from_directory_listing(
    state: ChallengeState,
    github: GitHubMCP,
    *,
    max_files: int = 1,
    max_directories: int = 24,
    max_depth: int = 4,
) -> List[str]:
    """Breadth-first fallback for MCP servers without get_repository_tree."""
    tool = github.tool("get_file_contents")
    exts = _language_extensions(state.get("language", "python"))
    queue: List[tuple[str, int]] = [("/", 0)]
    candidates: List[str] = []
    scanned = 0

    while queue and scanned < max_directories and len(candidates) < max_files:
        directory, depth = queue.pop(0)
        scanned += 1
        result = await tool.ainvoke(
            {
                "owner": state["owner"],
                "repo": state["repo"],
                "path": directory,
                "ref": state.get("ref", "main"),
                "fields": ["type", "name", "path", "size"],
            }
        )

        child_directories: List[str] = []
        for item in _directory_entries(result):
            path = str(item.get("path") or item.get("name") or "").strip()
            item_type = str(item.get("type") or "").lower()
            if not path:
                continue
            if item_type in ("file", "blob") and any(path.lower().endswith(ext) for ext in exts):
                if not re.search(r"(^|/)(__pycache__|node_modules|dist|build|venv|\.venv|\.git)(/|$)", path):
                    candidates.append(path)
                    if len(candidates) >= max_files:
                        break
            elif item_type in ("dir", "tree") and depth < max_depth:
                if not re.search(r"(^|/)(\.[^/]+|__pycache__|node_modules|dist|build|venv|\.venv|\.git)(/|$)", path):
                    child_directories.append(path)

        queue.extend((path, depth + 1) for path in child_directories)

    return candidates


def _normalize_requested_paths(paths: List[str], *, max_files: int) -> List[str]:
    normalized: List[str] = []
    seen: set[str] = set()
    for raw in paths:
        path = raw.strip()
        if not path or path in seen:
            continue
        seen.add(path)
        normalized.append(path)
        if len(normalized) >= max_files:
            break
    return normalized


def _extract_text_from_file_payload(res: Any) -> str | None:
    def decode_content(value: Any, encoding: Any) -> str | None:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        if not isinstance(value, str):
            return None

        if isinstance(encoding, str) and encoding.lower() == "base64":
            try:
                decoded = base64.b64decode(value, validate=False)
                return decoded.decode("utf-8", errors="replace")
            except Exception:
                return None
        return value

    if isinstance(res, bytes):
        return res.decode("utf-8", errors="replace")

    if isinstance(res, str):
        return res

    if isinstance(res, (list, tuple)):
        for item in res:
            decoded = _extract_text_from_file_payload(item)
            if decoded is not None:
                return decoded
        return None

    if not isinstance(res, dict):
        return None

    for key in ("content", "text", "raw"):
        value = res.get(key)
        decoded = decode_content(value, res.get("encoding"))
        if decoded is not None:
            return decoded
        nested = _extract_text_from_file_payload(value)
        if nested is not None:
            return nested

    for key in ("item", "items", "data", "result", "payload", "output"):
        nested = _extract_text_from_file_payload(res.get(key))
        if nested is not None:
            return nested
    return None


def _payload_shape(res: Any) -> str:
    if isinstance(res, dict):
        keys = list(res.keys())[:8]
        suffix = ", ..." if len(res.keys()) > 8 else ""
        return f"dict(keys={keys}{suffix})"
    if isinstance(res, list):
        return f"list(len={len(res)})"
    if isinstance(res, tuple):
        return f"tuple(len={len(res)})"
    return type(res).__name__


async def node_select_files(state: ChallengeState, github: GitHubMCP) -> ChallengeState:
    if state.get("error"):
        return state

    requested = _normalize_requested_paths(state.get("requested_paths") or [], max_files=1)
    if requested:
        state["target_paths"] = requested
        return state

    # 1) get_repository_tree
    try:
        tool = github.tool("get_repository_tree")
        tree = await tool.ainvoke(
            {
                "owner": state["owner"],
                "repo": state["repo"],
                "recursive": True,
                "path_filter": "",
                "tree_sha": state.get("ref", "main"),
            }
        )
        picked = _pick_paths_from_tree(tree, state.get("language", "python"), max_files=1)
        if picked:
            state["target_paths"] = picked
            return state
    except Exception:
        pass

    # 2) Some hosted MCP configurations expose directory listing but not tree traversal.
    try:
        picked = await _pick_paths_from_directory_listing(state, github, max_files=1)
        if picked:
            state["target_paths"] = picked
            return state
    except Exception:
        pass

    # 3) search_code 兜底（用 GitHub 代码搜索语法）
    try:
        tool = github.tool("search_code")
        lang = state.get("language", "python").lower()
        query = f"repo:{state['owner']}/{state['repo']} language:{lang}"
        res = await tool.ainvoke({"query": query, "perPage": 5, "page": 1})
        # 常见：{"items":[{"path":"..."}]}
        paths: List[str] = []
        decoded = _extract_json_from_mcp_payload(res)
        if isinstance(decoded, dict):
            items = decoded.get("items") or decoded.get("results") or []
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict) and it.get("path"):
                        paths.append(it["path"])
        if paths:
            state["target_paths"] = paths[:1]
            return state
    except Exception as e:
        state["error"] = f"Failed to select files: {e}"
        return state

    state["error"] = "No suitable code files found in the repository."
    return state


async def node_fetch_files(state: ChallengeState, github: GitHubMCP) -> ChallengeState:
    if state.get("error"):
        return state

    try:
        tool = github.tool("get_file_contents")
    except Exception as e:
        state["error"] = f"Failed to initialize file content tool: {e}"
        return state
    files: Dict[str, str] = {}

    for path in state.get("target_paths", []):
        try:
            res = await tool.ainvoke(
                {
                    "owner": state["owner"],
                    "repo": state["repo"],
                    "path": path,
                    "ref": state.get("ref", "main"),
                }
            )
        except Exception as e:
            state["error"] = f"Failed to fetch file '{path}': {e}"
            return state
        content = _extract_text_from_file_payload(res[1])
        if content is None:
            state["error"] = (
                f"Could not read file: {path}. "
                f"Unexpected get_file_contents payload: {_payload_shape(res)}"
            )
            return state
        files[path] = content

    state["files"] = files
    return state


def _single_target_path(state: ChallengeState) -> str:
    paths = state.get("target_paths") or []
    if paths:
        return paths[0]
    return "challenge_file"


def _state_language(state: ChallengeState) -> str:
    language = str(state.get("language", "python")).strip()
    return language or "python"


def _comment_prefix_for_language(language: str) -> str:
    return "#" if language.lower() == "python" else "//"


def _with_line_numbers(content: str) -> str:
    lines = content.splitlines()
    if not lines:
        return "1| "
    width = len(str(len(lines)))
    return "\n".join(f"{idx:>{width}}| {line}" for idx, line in enumerate(lines, start=1))


def _normalize_line_range(
    *,
    total_lines: int,
    start_line: int,
    end_line: int,
    min_span: int,
    max_span: int,
) -> tuple[int, int]:
    if total_lines <= 0:
        raise ValueError("Target file is empty and cannot be annotated.")

    start = int(start_line)
    end = int(end_line)
    if start > end:
        start, end = end, start

    start = max(1, min(start, total_lines))
    end = max(1, min(end, total_lines))

    effective_min = max(1, min(min_span, total_lines))
    effective_max = max(effective_min, min(max_span, total_lines))

    span = end - start + 1
    if span > effective_max:
        end = start + effective_max - 1
        if end > total_lines:
            end = total_lines
            start = max(1, end - effective_max + 1)

    span = end - start + 1
    if span < effective_min:
        end = min(total_lines, start + effective_min - 1)
        span = end - start + 1
        if span < effective_min:
            start = max(1, end - effective_min + 1)

    return start, end


def _split_lines(content: str) -> tuple[List[str], bool]:
    return content.splitlines(), content.endswith("\n")


def _join_lines(lines: List[str], has_trailing_newline: bool) -> str:
    text = "\n".join(lines)
    if has_trailing_newline:
        text += "\n"
    return text


def _leading_indent(line: str) -> str:
    match = re.match(r"\s*", line)
    return match.group(0) if match else ""


def _target_file_content(state: ChallengeState) -> tuple[str, str]:
    path = _single_target_path(state)
    files = state.get("files", {})
    content = files.get(path)
    if not isinstance(content, str):
        raise ValueError(f"Target file '{path}' is missing from fetched source files.")
    return path, content


def _build_transform_prompt(state: ChallengeState) -> str:
    lang = _state_language(state)
    task_type = state.get("task_type", "rewrite")
    files = state.get("files", {})

    parts = [
        "You are a senior, research-level software engineering mentor.",
        "Pick one key range from the ORIGINAL source file using 1-based inclusive line numbers.",
        "Line numbers must reference the original code shown below.",
    ]

    if task_type == "rewrite":
        parts += [
            "",
            "Task type: rewrite (code comprehension)",
            "Goals:",
            "1) Select exactly one key code snippet (3-8 lines).",
            "2) Rewrite only that snippet with equivalent semantics.",
            "3) Return start_line/end_line for the selected original range and rewritten_snippet.",
            "",
            "Output format:",
            "- Return one JSON object matching ExplainArtifact.",
            '- Keys: {"start_line": int, "end_line": int, "rewritten_snippet": str}',
        ]
    else:
        parts += [
            "",
            "Task type: blank_fill (logic completion)",
            "Goals:",
            "1) Select exactly one key code snippet (1-5 lines) to blank out.",
            "2) Return start_line/end_line for that range.",
            "",
            "Output format:",
            "- Return one JSON object matching ChallengeArtifact.",
            '- Keys: {"start_line": int, "end_line": int}',
        ]

    parts += [
        "",
        f"Language: {lang}",
        f"Repository: {state['owner']}/{state['repo']} @ {state.get('ref', 'main')}",
        "",
        "Original code (with line numbers):",
    ]

    for path, content in files.items():
        numbered = _with_line_numbers(content)
        parts += [f"\n---\nFILE: {path}\n```{lang}\n{numbered}\n```\n"]

    return "\n".join(parts)


def _annotate_rewrite_file(
    *,
    original_content: str,
    start_line: int,
    end_line: int,
    rewritten_snippet: str,
    comment_prefix: str,
    focus_id: str,
) -> str:
    lines, has_trailing_newline = _split_lines(original_content)
    indent = _leading_indent(lines[start_line - 1])

    rewritten = (rewritten_snippet or "").strip("\n")
    

    lines_slice = (
        rewritten.splitlines() if rewritten else lines[start_line - 1 : end_line])
    
    replacement_lines = [f"{indent}{line}" for line in lines_slice]
    block = [
        f"{indent}{comment_prefix} EXPLAIN_TARGET_START:{focus_id}",
        *replacement_lines,
        f"{indent}{comment_prefix} EXPLAIN_TARGET_END:{focus_id}",
    ]


    new_lines = lines[: start_line - 1] + block + lines[end_line:]
    return _join_lines(new_lines, has_trailing_newline)


def _annotate_blank_fill_file(
    *,
    original_content: str,
    start_line: int,
    end_line: int,
    comment_prefix: str,
    blank_id: str,
) -> str:
    lines, has_trailing_newline = _split_lines(original_content)
    indent = _leading_indent(lines[start_line - 1])

    block = [
        f"{indent}{comment_prefix} BLANK_START:{blank_id}",
        f"{indent}{comment_prefix} BLANK:{blank_id}",
        f"{indent}{comment_prefix} BLANK_END:{blank_id}",
    ]

    new_lines = lines[: start_line - 1] + block + lines[end_line:]
    return _join_lines(new_lines, has_trailing_newline)


def _default_student_instructions(task_type: str) -> str:
    if task_type == "blank_fill":
        return (
            "Complete the core logic in the `BLANK`-marked region and remove placeholder markers. "
            "After completion, ensure correct semantics, sound edge-case handling, and coding style consistent with context."
        )
    return (
        "Read the code snippet marked with `EXPLAIN_TARGET_START/END` and explain its semantics, key control flow, "
        "and the design intent behind this implementation."
    )


def _build_rewrite_payload(state: ChallengeState, artifact: ExplainArtifact) -> Dict[str, Any]:
    path, original_content = _target_file_content(state)
    start_line, end_line = _normalize_line_range(
        total_lines=len(original_content.splitlines()),
        start_line=artifact.start_line,
        end_line=artifact.end_line,
        min_span=2,
        max_span=8,
    )
    language = _state_language(state)
    comment_prefix = _comment_prefix_for_language(language)
    focus_id = "focus_1"
    changed_file = _annotate_rewrite_file(
        original_content=original_content,
        start_line=start_line,
        end_line=end_line,
        rewritten_snippet=artifact.rewritten_snippet,
        comment_prefix=comment_prefix,
        focus_id=focus_id,
    )
    location_hint = f"{path}:{start_line}-{end_line}"

    return {
        "task_type": "rewrite",
        "title": f"Code Comprehension Challenge: {path}",
        "language": language,
        "student_instructions_md": _default_student_instructions("rewrite"),
        "files": {path: changed_file},
        "edits": [
            {
                "type": "comment_rewrite",
                "description": "Explain the semantics and design intent of the snippet marked with EXPLAIN_TARGET.",
                "location_hint": location_hint,
                "start_line": start_line,
                "end_line": end_line,
            }
        ],
        "blanks": [],
        "answer_key": {
            "focus_id": focus_id,
            "start_line": start_line,
            "end_line": end_line,
        },
    }


def _build_blank_fill_payload(state: ChallengeState, artifact: ChallengeArtifact) -> Dict[str, Any]:
    path, original_content = _target_file_content(state)
    start_line, end_line = _normalize_line_range(
        total_lines=len(original_content.splitlines()),
        start_line=artifact.start_line,
        end_line=artifact.end_line,
        min_span=1,
        max_span=5,
    )
    language = _state_language(state)
    blank_id = "blank_1"
    comment_prefix = _comment_prefix_for_language(language)
    changed_file = _annotate_blank_fill_file(
        original_content=original_content,
        start_line=start_line,
        end_line=end_line,
        comment_prefix=comment_prefix,
        blank_id=blank_id,
    )
    location_hint = f"{path}:{start_line}-{end_line}"

    return {
        "task_type": "blank_fill",
        "title": f"Logic Completion Challenge: {path}",
        "language": language,
        "student_instructions_md": _default_student_instructions("blank_fill"),
        "files": {path: changed_file},
        "edits": [
            {
                "type": "blank_logic",
                "description": "Complete the core logic for the snippet marked with BLANK.",
                "location_hint": location_hint,
                "start_line": start_line,
                "end_line": end_line,
            }
        ],
        "blanks": [
            {
                "blank_id": blank_id,
                "file_path": path,
                "hint": "Complete the BLANK-marked region and remove placeholder markers.",
                "expected_behavior": "After completion, the code should express the full intended business logic.",
                "start_line": start_line,
                "end_line": end_line,
            }
        ],
        "answer_key": {
            "blank_id": blank_id,
            "start_line": start_line,
            "end_line": end_line,
        },
    }


async def node_generate_challenge(state: ChallengeState) -> ChallengeState:
    if state.get("error"):
        return state

    try:
        prompt = _build_transform_prompt(state)
        task_type = state.get("task_type", "rewrite")
        if task_type == "rewrite":
            llm = build_chat_model(temperature=0.2).with_structured_output(ExplainArtifact)
            artifact: ExplainArtifact = await llm.ainvoke(prompt)
            state["challenge"] = _build_rewrite_payload(state, artifact)
        elif task_type == "blank_fill":
            llm = build_chat_model(temperature=0.2).with_structured_output(ChallengeArtifact)
            artifact: ChallengeArtifact = await llm.ainvoke(prompt)
            state["challenge"] = _build_blank_fill_payload(state, artifact)
        else:
            state["error"] = "task_type must be one of: rewrite, blank_fill"
            return state
    except ValueError as e:
        state["error"] = str(e)
    except Exception as e:
        err_type = type(e).__name__
        tail = traceback.format_exc(limit=2).strip().replace("\n", " | ")
        state["error"] = f"Failed to generate challenge artifact: [{err_type}] {e}; trace={tail}"
    return state


def build_challenge_graph(github: GitHubMCP):
    g = StateGraph(ChallengeState)

    async def select_files_node(state: ChallengeState) -> ChallengeState:
        return await node_select_files(state, github)

    async def fetch_files_node(state: ChallengeState) -> ChallengeState:
        return await node_fetch_files(state, github)

    g.add_node("parse_repo", node_parse_repo)
    g.add_node("select_files", select_files_node)
    g.add_node("fetch_files", fetch_files_node)
    g.add_node("generate_challenge", node_generate_challenge)

    g.set_entry_point("parse_repo")
    g.add_edge("parse_repo", "select_files")
    g.add_edge("select_files", "fetch_files")
    g.add_edge("fetch_files", "generate_challenge")
    g.add_edge("generate_challenge", END)

    return g.compile()
