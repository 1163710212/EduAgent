from __future__ import annotations

from pathlib import Path

from sqlmodel import SQLModel, create_engine

from app.core.config import settings


def _resolve_db_path(raw_path: str) -> Path:
    path = Path(raw_path.strip()).expanduser()
    if not path.is_absolute():
        # backend/ 作为默认相对路径基准
        base_dir = Path(__file__).resolve().parents[2]
        path = (base_dir / path).resolve()
    return path


def _pick_db_path(raw_path: str) -> Path:
    preferred = _resolve_db_path(raw_path)
    try:
        preferred.parent.mkdir(parents=True, exist_ok=True)
        return preferred
    except OSError:
        fallback = (Path(__file__).resolve().parents[2] / "data" / "app.db").resolve()
        fallback.parent.mkdir(parents=True, exist_ok=True)
        return fallback


_raw_db_path = settings.APP_DB_PATH.strip()
if _raw_db_path == ":memory:":
    _db_url = "sqlite:///:memory:"
else:
    _db_url = f"sqlite:///{_pick_db_path(_raw_db_path)}"

engine = create_engine(_db_url, connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
