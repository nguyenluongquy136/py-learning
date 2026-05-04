"""
Qdrant Schedules database models.
Contains: QdrantSchedule
"""
from sqlalchemy import Column, Integer, Boolean, Text, DateTime, String
from datetime import datetime

from app.db import Base


class QdrantSchedule(Base):
    """Database model for tracking Qdrant chunking schedules"""
    __tablename__ = "qdrant_schedules"
    
    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    scheduled_at = Column(DateTime, nullable=True)
    is_passed_only = Column(Boolean, default=True)
    problem_id = Column(String(255), nullable=True)
    limit_count = Column(Integer, default=100)
    submissions_processed = Column(Integer, default=0)
    points_created = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)