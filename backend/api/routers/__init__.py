"""API routers (preferred import path).

This package intentionally re-exports the existing router objects to avoid
breaking runtime imports while the codebase is being reorganized.
"""

from .problems import router as problems_router
from .ai_tutor import router as ai_tutor_router
from .admin import router as admin_router
from .system import router as system_router
from .submissions import router as submissions_router

__all__ = [
    "problems_router",
    "submissions_router",
    "ai_tutor_router",
    "admin_router",
    "system_router",
]
