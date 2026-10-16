from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # LLM
    OPENAI_API_KEY: str = "ollama"
    OPENAI_BASE_URL: str = "http://localhost:11434/v1"
    OPENAI_MODEL: str = "qwen2.5:7b"
    LLM_HTTP_MAX_RETRIES: int = 2
    LLM_HTTP_RETRY_BACKOFF_SECONDS: float = 1.0
    # Structured output retry cycles. 0 means retry until valid schema output.
    LLM_STRUCTURED_MAX_RETRY_CYCLES: int = 3

    # GitHub MCP
    GITHUB_MCP_URL: str = "https://api.githubcopilot.com/mcp/"
    GITHUB_MCP_PAT: str = ""
    GITHUB_MCP_TOOLSETS: str = "repos"
    GITHUB_MCP_READONLY: bool = True
    GITHUB_READ_CONCURRENCY: int = Field(default=4, ge=1, le=8)
    GITHUB_READ_TIMEOUT_SECONDS: float = Field(default=15, gt=0, le=120)
    # Set to 1 for model servers that cannot efficiently serve parallel requests.
    CHALLENGE_GENERATION_CONCURRENCY: int = Field(default=2, ge=1, le=3)

    # App
    APP_DB_PATH: str = "data/app.db"
    CORS_ALLOW_ORIGINS: str = "*"

    class Config:
        env_file = ".env"


settings = Settings()
