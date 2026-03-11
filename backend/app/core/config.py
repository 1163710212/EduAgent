from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM
    OPENAI_API_KEY: str = "ollama"
    OPENAI_BASE_URL: str = "http://localhost:11434/v1"
    OPENAI_MODEL: str = "llama3.1"
    # Structured output retry cycles. 0 means retry until valid schema output.
    LLM_STRUCTURED_MAX_RETRY_CYCLES: int = 0

    # GitHub MCP
    GITHUB_MCP_URL: str = "https://api.githubcopilot.com/mcp/"
    GITHUB_MCP_PAT: str = ""
    GITHUB_MCP_TOOLSETS: str = "repos"
    GITHUB_MCP_READONLY: bool = True

    # App
    APP_DB_PATH: str = "data/app.db"
    CORS_ALLOW_ORIGINS: str = "*"

    class Config:
        env_file = ".env"


settings = Settings()
