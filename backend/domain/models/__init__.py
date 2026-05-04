"""Models package - contains database models and Pydantic schemas.

Note: Tutor-related models, schemas, embedder và error classifier:
- Embedding được xử lý bởi core/qdrant_rag.py (SentenceTransformer + Qdrant Cloud)
- Error classification được xử lý bởi analysis/ modules
- Hint generation được xử lý bởi core/tutor.py với Qdrant RAG
"""

# Database Models (SQLAlchemy ORM)
from .core import (
    User,
    Problem,
    ProblemType,
    TestCase,
)
from .submission import Submission
from .qdrant_schedule import QdrantSchedule

__all__ = [
    "User",
    "Problem",
    "ProblemType",
    "TestCase",
    "Submission",
    "QdrantSchedule",
]
