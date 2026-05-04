"""Backend settings (single source of truth).

This module loads `backend/.env` (if present) and exposes typed-ish constants.
Keep it lightweight to avoid circular imports.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)


APP_TITLE = "PyTutor AI Backend"
APP_VERSION = "3.0.0"
APP_DESCRIPTION = "Intelligent Python Tutoring System with Qdrant RAG"


def _split_csv(value: str) -> List[str]:
    parts = [p.strip() for p in value.split(",")]
    return [p for p in parts if p]


# CORS
_CORS_RAW = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()
CORS_ALLOW_ORIGINS: List[str] = ["*"] if _CORS_RAW == "*" else _split_csv(_CORS_RAW)


# External services
QDRANT_URL: str = os.getenv("QDRANT_URL", "")


# Auth/JWT
JWT_ALGORITHM = "HS256"

# Nếu không set, giữ default để tránh crash.
# QUAN TRỌNG: set SECRET_KEY trong production.
SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-change-me")


# Database
DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/pytutor",
)


# Sandbox / execution limits (Sử dụng bởi /api/config)
EXEC_CPU_LIMIT_PERCENT: int = 10
EXEC_MEMORY_LIMIT_MB: int = 512
EXEC_TIMEOUT_SECONDS: int = 10
EXEC_NETWORK_ACCESS: bool = False
EXEC_ALLOWED_LIBRARIES: List[str] = ["numpy", "pandas", "matplotlib", "scipy", "sklearn"]
SANDBOX_IMAGE: str = "python-sandbox"

# Admin / uploads
ADMIN_UPLOAD_MAX_MB: int = 10
# Giới hạn số record import vào Qdrant cho mỗi lần chạy (tránh import nhầm file quá lớn).
QDRANT_IMPORT_MAX_RECORDS: int = 5000


# WebSocket interactive terminal
# Endpoint này cho phép chạy code tương tác trong Docker sandbox.
ENABLE_WS_TERMINAL: bool = os.getenv("ENABLE_WS_TERMINAL", "true").lower() in ("1", "true", "yes", "y")

# AI warm-up
# Embedding model (SentenceTransformer) khá nặng, lần đầu load sẽ chậm
# Warm-up giúp giảm độ trễ lần đầu khi vào Admin/hint/chat (nhưng sẽ tốn CPU/RAM sớm).
# Mặc định False
WARMUP_AI_ON_STARTUP: bool = os.getenv("WARMUP_AI_ON_STARTUP", "false").lower() in ("1", "true", "yes", "y")