"""
Submissions Router - Endpoint cho người dùng xem danh sách bài nộp của mình.

Endpoints:
- GET /submissions - Lấy danh sách bài nộp (có phân trang, lọc)
- GET /submissions/{id} - Xem chi tiết bài nộp (code + kết quả)
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional, Any

from app.db import get_db
from app.auth import get_current_user
from domain.models import Submission, Problem, User

router = APIRouter(prefix="/submissions", tags=["submissions"])


class MySubmissionItem(BaseModel):
    id: int
    problem_id: int
    problem_title: Optional[str]
    passed_all: bool
    submitted_at: Optional[str]


class MySubmissionsResponse(BaseModel):
    total: int
    skip: int
    limit: int
    items: List[MySubmissionItem]


class MySubmissionDetail(MySubmissionItem):
    code: str
    results: Optional[Any] = None


@router.get("", response_model=MySubmissionsResponse)
def list_my_submissions(
    skip: int = 0,
    limit: int = 50,
    passed: Optional[bool] = None,
    problem_id: Optional[int] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    skip = max(skip, 0)
    limit = max(min(limit, 200), 1)

    query = (
        db.query(Submission)
        .join(Problem, Submission.problem_id == Problem.id)
        .filter(Submission.user_id == user.id)
    )

    if passed is not None:
        query = query.filter(Submission.passed_all == passed)
    if problem_id is not None:
        query = query.filter(Submission.problem_id == problem_id)
    if q:
        qq = q.strip()
        if qq:
            if qq.isdigit():
                qn = int(qq)
                query = query.filter(or_(Submission.id == qn, Submission.problem_id == qn, Problem.title.ilike(f"%{qq}%")))
            else:
                query = query.filter(Problem.title.ilike(f"%{qq}%"))

    total = query.count()

    rows = (
        query.add_columns(Problem.title)
        .order_by(Submission.submitted_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    items: List[MySubmissionItem] = []
    for (sub, problem_title) in rows:
        items.append(
            MySubmissionItem(
                id=sub.id,
                problem_id=sub.problem_id,
                problem_title=problem_title,
                passed_all=bool(sub.passed_all),
                submitted_at=sub.submitted_at.isoformat() if sub.submitted_at else None,
            )
        )

    return MySubmissionsResponse(total=total, skip=skip, limit=limit, items=items)


@router.get("/{submission_id}", response_model=MySubmissionDetail)
def get_my_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (
        db.query(Submission, Problem.title)
        .join(Problem, Submission.problem_id == Problem.id)
        .filter(Submission.id == submission_id, Submission.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")
    (sub, problem_title) = row

    return MySubmissionDetail(
        id=sub.id,
        problem_id=sub.problem_id,
        problem_title=problem_title,
        passed_all=bool(sub.passed_all),
        submitted_at=sub.submitted_at.isoformat() if sub.submitted_at else None,
        code=sub.code,
        results=sub.results,
    )


__all__ = ["router"]


