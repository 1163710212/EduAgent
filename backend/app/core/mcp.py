from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx

from langchain_mcp_adapters.client import MultiServerMCPClient

from app.core.config import settings
from app.services.repository_language import validate_language_bytes


@dataclass
class GitHubMCP:
    """
    简单封装：加载 MCP tools，并按 name 取用。
    默认走 GitHub 远程 MCP（HTTP），使用 PAT。
    """
    client: Optional[MultiServerMCPClient] = None
    tools_by_name: Optional[Dict[str, Any]] = None

    async def repository_languages(self, owner: str, repo: str) -> dict[str, int]:
        """GitHub's repository language statistics, measured in source bytes.

        This endpoint has no ref parameter: statistics describe the default
        branch. Authentication is server-side and credentials never follow redirects.
        """
        headers = {"Accept": "application/vnd.github+json"}
        if settings.GITHUB_MCP_PAT:
            headers["Authorization"] = f"Bearer {settings.GITHUB_MCP_PAT}"
        url = "https://api.github.com/repos/{}/{}/languages".format(
            quote(owner, safe=""), quote(repo, safe="")
        )
        async with httpx.AsyncClient(
            timeout=settings.GITHUB_READ_TIMEOUT_SECONDS, follow_redirects=False
        ) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return validate_language_bytes(response.json())

    async def repository_tree(self, owner: str, repo: str, ref: str) -> dict:
        """Read-only fast path when the MCP server does not expose Git trees.

        The existing GitHub credential is sent only to api.github.com. Never
        follow redirects with it, or cache mutable branch names across requests.
        """
        headers = {"Accept": "application/vnd.github+json"}
        if settings.GITHUB_MCP_PAT:
            headers["Authorization"] = f"Bearer {settings.GITHUB_MCP_PAT}"
        url = "https://api.github.com/repos/{}/{}/git/trees/{}".format(
            quote(owner, safe=""), quote(repo, safe=""), quote(ref, safe="")
        )
        async with httpx.AsyncClient(
            timeout=settings.GITHUB_READ_TIMEOUT_SECONDS, follow_redirects=False
        ) as client:
            response = await client.get(url, params={"recursive": "1"}, headers=headers)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict) or not isinstance(data.get("tree"), list):
            raise ValueError("Invalid GitHub tree response")
        return data

    async def init(self) -> None:
        headers = {}
        if settings.GITHUB_MCP_PAT:
            headers["Authorization"] = f"Bearer {settings.GITHUB_MCP_PAT}"

        # GitHub MCP Server 支持用 header 配置 toolsets / readonly（我们只读）
        if settings.GITHUB_MCP_TOOLSETS:
            headers["X-MCP-Toolsets"] = settings.GITHUB_MCP_TOOLSETS
        if settings.GITHUB_MCP_READONLY:
            headers["X-MCP-Readonly"] = "true"

        self.client = MultiServerMCPClient(
            {
                "github": {
                    "transport": "http",
                    "url": settings.GITHUB_MCP_URL,
                    "headers": headers,
                }
            }
        )
        tools = await self.client.get_tools()
        self.tools_by_name = {t.name: t for t in tools}

    def tool(self, name: str):
        if not self.tools_by_name:
            raise RuntimeError("GitHubMCP not initialized")
        if name not in self.tools_by_name:
            available = ", ".join(sorted(self.tools_by_name.keys()))
            raise KeyError(f"MCP tool '{name}' not found. Available: {available}")
        return self.tools_by_name[name]
