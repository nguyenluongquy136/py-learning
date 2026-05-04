"""Problems Router - Problem management and submission endpoints.

Endpoints:
- GET /problems - Danh sách bài tập (có search/filter/pagination)
- GET /problems/{id} - Chi tiết bài tập
- POST /problems/{id}/submit - Nộp lời giải để chấm test
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
import json

from app.auth import get_current_user, get_user_id_from_authorization_header
from app.db import get_db
from app.settings import EXEC_MEMORY_LIMIT_MB
from domain.ai import get_hybrid_tutor
from domain.models import Problem, ProblemType, Submission
from infra.services.docker_manager import DockerManager

router = APIRouter(prefix="/problems", tags=["problems"])

logger = logging.getLogger(__name__)


class ProblemTypeOut(BaseModel):
	"""Schema cho loại bài tập"""
	id: int
	name: str
	description: Optional[str] = None


@router.get("/types", response_model=List[ProblemTypeOut])
def list_problem_types(db: Session = Depends(get_db)):
	"""Lấy danh sách tất cả loại bài tập từ database.
	
	Dùng để populate bộ lọc problem_type ở frontend.
	Sắp xếp theo display_order (nếu có) để hiển thị theo thứ tự học tập.
	"""
	try:
		# Thử query với display_order
		rows = db.execute(text("""
			SELECT id, name, COALESCE(description, '') AS description
			FROM problem_types
			ORDER BY COALESCE(display_order, id) ASC, name ASC
		""")).fetchall()
		return [ProblemTypeOut(id=r[0], name=r[1], description=r[2]) for r in rows]
	except Exception:
		# Fallback nếu chưa có cột display_order
		types = db.query(ProblemType).order_by(ProblemType.name).all()
		return [ProblemTypeOut(id=t.id, name=t.name, description=t.description) for t in types]


class ProblemOut(BaseModel):
	id: int
	title: str
	description: str
	difficulty: Optional[str]
	problem_type: Optional[str]
	completed: bool = False


class PaginatedProblems(BaseModel):
	total: int
	limit: int
	offset: int
	items: List[ProblemOut]


class SubmitRequest(BaseModel):
	code: str
	timeout: Optional[int] = 10
	stdin_input: Optional[str] = None
	hint_level: Optional[int] = 1
	session_id: Optional[int] = None  # Liên kết với learning session


class TestCaseResult(BaseModel):
	testcase_id: int
	passed: bool
	output: str
	expected_output: str
	error: Optional[str] = None


class HintResponse(BaseModel):
	"""Gợi ý tự động khi test thất bại"""
	hint: str
	error_type: str
	error_message: str
	concepts_to_review: List[str] = []
	confidence: float
	interaction_id: Optional[int] = None


@router.get("", response_model=PaginatedProblems)
def list_problems(
	db: Session = Depends(get_db),
	authorization: Optional[str] = Header(None),
	search: Optional[str] = None,
	difficulty: Optional[str] = None,
	problem_type: Optional[str] = None,
	limit: int = 50,
	offset: int = 0,
):
	q = db.query(Problem)

	if search:
		like = f"%{search.strip()}%"
		q = q.filter((Problem.title.ilike(like)) | (Problem.description.ilike(like)))

	if difficulty:
		q = q.filter(Problem.difficulty == difficulty.lower())

	if problem_type:
		q = q.join(Problem.problem_type_obj).filter(ProblemType.name.ilike(problem_type))

	total = q.count()
	problems = q.offset(offset).limit(limit).all()

	user_id = get_user_id_from_authorization_header(authorization)

	completed_set = set()
	if user_id:
		rows = (
			db.query(Submission.problem_id)
			.filter(Submission.user_id == user_id, Submission.passed_all.is_(True))
			.distinct()
			.all()
		)
		completed_set = set(r[0] for r in rows)

	out = []
	for p in problems:
		out.append(ProblemOut(
			id=p.id,
			title=p.title,
			description=p.description,
			difficulty=p.difficulty,
			problem_type=getattr(p, 'problem_type', None),
			completed=(p.id in completed_set)
		))

	return {"total": total, "limit": limit, "offset": offset, "items": out}


@router.get("/{problem_id}", response_model=ProblemOut)
def get_problem(
	problem_id: int,
	db: Session = Depends(get_db),
	authorization: Optional[str] = Header(None),
):
	"""Lấy thông tin một bài tập theo ID.
	
	Auth là tùy chọn; nếu được cung cấp, `completed` sẽ được tính toán cho user đó.
	"""
	problem = db.query(Problem).filter(Problem.id == problem_id).first()
	if not problem:
		raise HTTPException(status_code=404, detail="Problem not found")

	user_id = get_user_id_from_authorization_header(authorization)

	completed = False
	if user_id:
		row = (
			db.query(Submission.id)
			.filter(
				Submission.user_id == user_id,
				Submission.problem_id == problem_id,
				Submission.passed_all.is_(True),
			)
			.first()
		)
		completed = row is not None

	return ProblemOut(
		id=problem.id,
		title=problem.title,
		description=problem.description,
		difficulty=problem.difficulty,
		problem_type=getattr(problem, "problem_type", None),
		completed=completed,
	)


@router.post("/{problem_id}/submit", response_model=Dict[str, Any])
async def submit_solution(problem_id: int, req: SubmitRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
	problem = db.query(Problem).filter(Problem.id == problem_id).first()
	if not problem:
		raise HTTPException(status_code=404, detail="Problem not found")

	results: List[TestCaseResult] = []

	try:
		docker = DockerManager()
	except Exception:
		docker = None

	# Nếu Docker không chạy/khởi tạo lỗi, trả 503
	if docker is None:
		raise HTTPException(status_code=503, detail="Docker sandbox is unavailable")

	for tc in problem.testcases:
		try:
			memory_limit_bytes = int(EXEC_MEMORY_LIMIT_MB) * 1024 * 1024
			exec_res = docker.run_code(
				req.code,
				timeout=req.timeout,
				memory_limit=memory_limit_bytes,
				stdin_input=(tc.input or req.stdin_input or None),
			)

			output = (exec_res.get("output") or "").strip()
			expected_raw = tc.expected_output or ""
			expected = expected_raw.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r').strip()
			passed = output == expected
			results.append(TestCaseResult(testcase_id=tc.id, passed=passed, output=output, expected_output=expected, error=exec_res.get("error")))
		except Exception as e:
			results.append(TestCaseResult(testcase_id=tc.id, passed=False, output="", expected_output=(tc.expected_output or ""), error=str(e)))

	passed_all = all(r.passed for r in results)

	# Tạo gợi ý tự động nếu test thất bại
	hint = None
	if not passed_all:
		try:
			tutor = get_hybrid_tutor()
			feedback = await tutor.generate_feedback(
				student_code=req.code,
				problem_id=str(problem_id),
				problem_description=problem.description,
				hint_level=req.hint_level,
				language="vi"
			)

			interaction_id: Optional[int] = None
			try:
				row = db.execute(text("""
					INSERT INTO student_hint_interactions(
						user_id,
						problem_id,
						session_id,
						code_snapshot,
						hint_level,
						hint_text,
						strategy,
						reference_similarity,
						reference_used,
						concepts_involved
					) VALUES (
						:user_id,
						:problem_id,
						:session_id,
						:code_snapshot,
						:hint_level,
						:hint_text,
						:strategy,
						:reference_similarity,
						:reference_used,
						CAST(:concepts_involved AS JSONB)
					)
					RETURNING id
				"""), {
					"user_id": int(user.id),
					"problem_id": int(problem_id),
					"session_id": int(req.session_id) if req.session_id else None,
					"code_snapshot": req.code,
					"hint_level": int(req.hint_level or 1),
					"hint_text": feedback.hint,
					"strategy": getattr(feedback, "strategy", "unknown"),
					"reference_similarity": float(getattr(feedback, "reference_similarity", 0.0) or 0.0),
					"reference_used": bool(getattr(feedback, "reference_code", None) is not None),
					"concepts_involved": json.dumps(list(getattr(feedback, "concepts_to_review", []) or []), ensure_ascii=False),
				}).fetchone()
				if row and row[0]:
					interaction_id = int(row[0])
			except Exception:
				interaction_id = None

			hint = HintResponse(
				hint=feedback.hint,
				error_type=feedback.error_type,
				error_message=feedback.error_message,
				concepts_to_review=feedback.concepts_to_review,
				confidence=feedback.confidence,
				interaction_id=interaction_id,
			).dict()
		except Exception as e:
			logger.error(f"Failed to generate hint: {e}")

	# Lưu submission vào database
	submission = Submission(
		user_id=user.id,
		problem_id=problem_id,
		code=req.code,
		passed_all=passed_all,
		results=[r.dict() for r in results]
	)
	db.add(submission)
	db.commit()

	return {"success": True, "passed_all": passed_all, "results": [r.dict() for r in results], "submission_id": submission.id, "hint": hint}


__all__ = ["router"]
