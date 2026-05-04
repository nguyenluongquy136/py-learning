"""
Submission database models.
Contains: Submission
"""
from sqlalchemy import Column, Integer, Boolean, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime

from app.db import Base


class Submission(Base):
    """Database model for storing student code submissions"""
    __tablename__ = "submissions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    problem_id = Column(Integer, ForeignKey("problems.id", ondelete="CASCADE"), nullable=False)
    
    # Code submitted
    code = Column(Text, nullable=False)
    
    # Results
    passed_all = Column(Boolean, default=False)
    results = Column(JSON, nullable=True)  # Store test case results as JSON
    
    # Metadata
    submitted_at = Column(DateTime, default=datetime.utcnow)
    is_chunked = Column(Boolean, default=False)  # Track if submission has been chunked into Qdrant
    
    # Relationships
    user = relationship("User", back_populates="submissions")
    problem = relationship("Problem", back_populates="submissions")
