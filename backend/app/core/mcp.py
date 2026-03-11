from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from langchain_mcp_adapters.client import MultiServerMCPClient

from app.core.config import settings


@dataclass
class GitHubMCP:
    """
    简单封装：加载 MCP tools，并按 name 取用。
    默认走 GitHub 远程 MCP（HTTP），使用 PAT。
    """
    client: Optional[MultiServerMCPClient] = None
    tools_by_name: Optional[Dict[str, Any]] = None

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