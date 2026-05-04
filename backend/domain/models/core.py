"""
Core database models với PostgreSQL schema.
Contains: User, Problem, ProblemType, TestCase
"""
from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship

from app.db import Base


class User(Base):
    """User model - stores authentication and user information"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(150), unique=True, index=True, nullable=False)
    hashed_password = Column(String(256), nullable=False)
    is_admin = Column(Integer, default=0, nullable=False)  # 0 = regular user, 1 = admin

    # Relationships
    submissions = relationship("Submission", back_populates="user", cascade="all, delete-orphan")


class ProblemType(Base):
    """Problem type classification"""
    __tablename__ = "problem_types"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)

    # Relationships
    problems = relationship("Problem", back_populates="problem_type_obj")


class Problem(Base):
    """Problem model - programming exercises"""
    __tablename__ = "problems"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    difficulty = Column(String(50), nullable=True)
    problem_type_id = Column(Integer, ForeignKey("problem_types.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    problem_type_obj = relationship("ProblemType", back_populates="problems", lazy="joined")
    testcases = relationship("TestCase", back_populates="problem", cascade="all, delete-orphan")
    submissions = relationship("Submission", back_populates="problem", cascade="all, delete-orphan")

    @property
    def problem_type(self) -> str:
        """Get problem type name"""
        return self.problem_type_obj.name if self.problem_type_obj else None


class TestCase(Base):
    """Test case model for problems"""
    __tablename__ = "test_cases"

    id = Column(Integer, primary_key=True, index=True)
    problem_id = Column(Integer, ForeignKey("problems.id", ondelete="CASCADE"), nullable=False)
    input = Column(Text, nullable=True)
    expected_output = Column(Text, nullable=True)

    # Relationships
    problem = relationship("Problem", back_populates="testcases")
