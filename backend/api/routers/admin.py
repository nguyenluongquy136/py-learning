"""Admin Router - Admin-only endpoints cho quản lý hệ thống.

Features:
- Quản lý user (list, promote/demote admin)
- CRUD problem (create, update, delete problems và test cases)
- Quản lý thống kê (users, problems, submissions, Qdrant)
- Quản lý Qdrant knowledge base
"""

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
import logging
from datetime import datetime
import csv
import json
import io
import uuid
import re

from app.db import get_db
from app.auth import get_current_admin_user
from app.settings import ADMIN_UPLOAD_MAX_MB, QDRANT_IMPORT_MAX_RECORDS
from domain.models import User, Problem, ProblemType, TestCase, Submission
from domain.ai import get_qdrant_tutor
from infra.services.scheduler import get_scheduler
from infra.utils.normalize_code import normalize_code
from sqlalchemy import func, or_

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

import_progress = {}


def _enforce_upload_limit(file_bytes_len: int) -> None:
	"""Giới hạn dung lượng upload cho các endpoint import (tránh OOM/DoS)."""
	max_bytes = int(ADMIN_UPLOAD_MAX_MB) * 1024 * 1024
	if file_bytes_len > max_bytes:
		raise HTTPException(
			status_code=413,
			detail=f"File too large. Max allowed: {ADMIN_UPLOAD_MAX_MB}MB",
		)


# Request/Response Models

class UserResponse(BaseModel):
	id: int
	username: str
	is_admin: int
	submission_count: int = 0


class AdminUsersResponse(BaseModel):
	total: int
	skip: int
	limit: int
	items: List[UserResponse]


class UserUpdateRequest(BaseModel):
	is_admin: int = Field(ge=0, le=1, description="0=user, 1=admin")


class TestCaseCreate(BaseModel):
	input: str
	expected_output: str


class ProblemCreateRequest(BaseModel):
	title: str
	description: str
	difficulty: str = "easy"
	problem_type_id: Optional[int] = None
	test_cases: List[TestCaseCreate] = []


class ProblemUpdateRequest(BaseModel):
	title: Optional[str] = None
	description: Optional[str] = None
	difficulty: Optional[str] = None
	problem_type_id: Optional[int] = None
	test_cases: Optional[List[TestCaseCreate]] = None

class ProblemResponse(BaseModel):
	id: int
	title: str
	description: str
	difficulty: str
	problem_type_id: Optional[int]
	problem_type: Optional[str]
	test_case_count: int = 0


class ProblemOption(BaseModel):
	id: int
	title: Optional[str] = None



class AdminProblemsResponse(BaseModel):
	total: int
	skip: int
	limit: int
	items: List[ProblemResponse]


class SystemStatsResponse(BaseModel):
	users_total: int
	users_admin: int
	problems_total: int
	submissions_total: int
	submissions_passed: int
	qdrant_points: int
	qdrant_collections: Dict[str, Any]


class AdminSubmissionItem(BaseModel):
	id: int
	user_id: Optional[int]
	username: Optional[str]
	problem_id: Optional[int]
	problem_title: Optional[str]
	passed_all: bool
	submitted_at: Optional[str]


class AdminSubmissionsResponse(BaseModel):
	total: int
	skip: int
	limit: int
	items: List[AdminSubmissionItem]


class AdminSubmissionDetail(AdminSubmissionItem):
	code: str
	results: Optional[Any] = None


class QdrantChunkRequest(BaseModel):
	problem_id: Optional[str] = None
	user_id: Optional[int] = None
	is_passed_only: bool = True
	limit: int = 100


class ChunkScheduleRequest(BaseModel):
	name: str
	is_passed_only: bool = True
	problem_id: Optional[str] = None
	limit: int = 100
	scheduled_at: Optional[str] = None


# User Management

@router.get("/users", response_model=AdminUsersResponse)
def list_users(
	skip: int = 0,
	limit: int = 100,
	q: Optional[str] = None,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""List all users with submission counts"""
	skip = max(skip, 0)
	limit = max(min(limit, 200), 1)

	query = db.query(User)

	# Tìm kiếm (id hoặc username)
	if q:
		qq = q.strip()
		if qq:
			if qq.isdigit():
				query = query.filter(or_(User.id == int(qq), User.username.ilike(f"%{qq}%")))
			else:
				query = query.filter(User.username.ilike(f"%{qq}%"))

	total = query.count()

	# Đếm số submission trong một query
	subq = (
		db.query(Submission.user_id.label("user_id"), func.count(Submission.id).label("cnt"))
		.group_by(Submission.user_id)
		.subquery()
	)
	rows = (
		query.outerjoin(subq, User.id == subq.c.user_id)
		.add_columns(subq.c.cnt)
		.order_by(User.id.desc())
		.offset(skip)
		.limit(limit)
		.all()
	)

	items: List[UserResponse] = []
	for (user, cnt) in rows:
		items.append(UserResponse(
			id=user.id,
			username=user.username,
			is_admin=user.is_admin,
			submission_count=int(cnt or 0)
		))

	return AdminUsersResponse(total=total, skip=skip, limit=limit, items=items)


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
	user_id: int,
	request: UserUpdateRequest,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Promote or demote user admin status"""
	user = db.query(User).filter(User.id == user_id).first()
	if not user:
		raise HTTPException(status_code=404, detail="User not found")

	# Không cho demote chính mình
	if user.id == current_admin.id and request.is_admin == 0:
		raise HTTPException(status_code=400, detail="Cannot demote yourself")

	user.is_admin = request.is_admin
	db.commit()
	db.refresh(user)

	submission_count = db.query(Submission).filter(Submission.user_id == user.id).count()
	return UserResponse(
		id=user.id,
		username=user.username,
		is_admin=user.is_admin,
		submission_count=submission_count
	)


@router.delete("/users/{user_id}")
def delete_user(
	user_id: int,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Xóa user và tất cả các submission của user"""
	if user_id == current_admin.id:
		raise HTTPException(status_code=400, detail="Cannot delete yourself")

	user = db.query(User).filter(User.id == user_id).first()
	if not user:
		raise HTTPException(status_code=404, detail="User not found")

	db.delete(user)
	db.commit()

	return {"message": f"User {user.username} deleted successfully"}


# Problem Management

@router.get("/problems", response_model=AdminProblemsResponse)
def list_problems_admin(
	skip: int = 0,
	limit: int = 100,
	q: Optional[str] = None,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""List all problems with test case counts"""
	skip = max(skip, 0)
	limit = max(min(limit, 200), 1)

	query = db.query(Problem)
	if q:
		qq = q.strip()
		if qq:
			if qq.isdigit():
				query = query.filter(or_(Problem.id == int(qq), Problem.title.ilike(f"%{qq}%"), Problem.description.ilike(f"%{qq}%")))
			else:
				query = query.filter(or_(Problem.title.ilike(f"%{qq}%"), Problem.description.ilike(f"%{qq}%")))

	total = query.count()

	# Đếm số test case trong một query
	tc_subq = (
		db.query(TestCase.problem_id.label("problem_id"), func.count(TestCase.id).label("cnt"))
		.group_by(TestCase.problem_id)
		.subquery()
	)
	rows = (
		query.outerjoin(tc_subq, Problem.id == tc_subq.c.problem_id)
		.add_columns(tc_subq.c.cnt)
		.order_by(Problem.id.desc())
		.offset(skip)
		.limit(limit)
		.all()
	)

	items: List[ProblemResponse] = []
	for (problem, cnt) in rows:
		items.append(ProblemResponse(
			id=problem.id,
			title=problem.title,
			description=problem.description,
			difficulty=problem.difficulty or "beginner",
			problem_type_id=problem.problem_type_id,
			problem_type=problem.problem_type,
			test_case_count=int(cnt or 0)
		))

	return AdminProblemsResponse(total=total, skip=skip, limit=limit, items=items)


@router.get("/problems/options", response_model=List[ProblemOption])
def get_problem_options(
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Lấy list problems đơn giản cho dropdowns (ID + Title only)"""
	problems = db.query(Problem.id, Problem.title).order_by(Problem.id.desc()).all()
	return [ProblemOption(id=p.id, title=p.title) for p in problems]


@router.get('/problems/{problem_id}')
def get_problem_admin(
	problem_id: int,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	problem = db.query(Problem).filter(Problem.id == problem_id).first()
	if not problem:
		raise HTTPException(status_code=404, detail='Problem not found')

	test_cases = [ { 'id': tc.id, 'input': tc.input, 'expected_output': tc.expected_output } for tc in problem.testcases ]

	return {
		'id': problem.id,
		'title': problem.title,
		'description': problem.description,
		'difficulty': problem.difficulty,
		'problem_type_id': problem.problem_type_id,
		'problem_type': problem.problem_type,
		'test_cases': test_cases
	}


@router.post("/problems", response_model=ProblemResponse, status_code=status.HTTP_201_CREATED)
def create_problem(
	request: ProblemCreateRequest,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Tạo một problem mới với test cases"""

	# Kiểm tra problem_type_id nếu có
	if request.problem_type_id:
		problem_type = db.query(ProblemType).filter(ProblemType.id == request.problem_type_id).first()
		if not problem_type:
			raise HTTPException(status_code=400, detail="Invalid problem_type_id")

	# Tạo problem (convert difficulty to lowercase cho ENUM)
	new_problem = Problem(
		title=request.title,
		description=request.description,
		difficulty=request.difficulty.lower() if request.difficulty else "easy",
		problem_type_id=request.problem_type_id
	)
	db.add(new_problem)
	db.commit()
	db.refresh(new_problem)

	# Add test cases
	for tc in request.test_cases:
		test_case = TestCase(
			problem_id=new_problem.id,
			input=tc.input,
			expected_output=tc.expected_output
		)
		db.add(test_case)

	db.commit()
	db.refresh(new_problem)

	return ProblemResponse(
		id=new_problem.id,
		title=new_problem.title,
		description=new_problem.description,
		difficulty=new_problem.difficulty or "beginner",
		problem_type_id=new_problem.problem_type_id,
		problem_type=new_problem.problem_type,
		test_case_count=len(new_problem.testcases)
	)


@router.patch("/problems/{problem_id}", response_model=ProblemResponse)
def update_problem(
	problem_id: int,
	request: ProblemUpdateRequest,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Update an existing problem"""
	problem = db.query(Problem).filter(Problem.id == problem_id).first()
	if not problem:
		raise HTTPException(status_code=404, detail="Problem not found")

	if request.title is not None:
		problem.title = request.title
	if request.description is not None:
		problem.description = request.description
	if request.difficulty is not None:
		problem.difficulty = request.difficulty.lower()
	if request.problem_type_id is not None:
		# Kiểm tra problem_type_id
		problem_type = db.query(ProblemType).filter(ProblemType.id == request.problem_type_id).first()
		if not problem_type:
			raise HTTPException(status_code=400, detail="Invalid problem_type_id")
		problem.problem_type_id = request.problem_type_id

	db.commit()
	db.refresh(problem)

	# Nếu có test_cases, thay thế các test case cũ
	if request.test_cases is not None:
		# delete existing
		db.query(TestCase).filter(TestCase.problem_id == problem.id).delete()
		db.commit()
		# add new
		for tc in request.test_cases:
			new_tc = TestCase(problem_id=problem.id, input=tc.input, expected_output=tc.expected_output)
			db.add(new_tc)
		db.commit()
		db.refresh(problem)

	return ProblemResponse(
		id=problem.id,
		title=problem.title,
		description=problem.description,
		difficulty=problem.difficulty or "beginner",
		problem_type_id=problem.problem_type_id,
		problem_type=problem.problem_type,
		test_case_count=len(problem.testcases)
	)


@router.delete("/problems/{problem_id}")
def delete_problem(
	problem_id: int,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Xóa một problem và tất cả các data liên quan"""
	problem = db.query(Problem).filter(Problem.id == problem_id).first()
	if not problem:
		raise HTTPException(status_code=404, detail="Problem not found")

	db.delete(problem)
	db.commit()

	return {"message": f"Problem '{problem.title}' deleted successfully"}


# Problem Type Models
class ProblemTypeBase(BaseModel):
	name: str
	description: Optional[str] = None

class ProblemTypeCreate(ProblemTypeBase):
	pass

class ProblemTypeUpdate(BaseModel):
	name: Optional[str] = None
	description: Optional[str] = None

class ProblemTypeResponse(ProblemTypeBase):
	id: int

	class Config:
		from_attributes = True


# Problem Type management
@router.get('/problem-types', response_model=List[ProblemTypeResponse])
def list_problem_types(
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Danh sách tất cả các loại bài tập"""
	pts = db.query(ProblemType).order_by(ProblemType.id).all()
	return pts


@router.post('/problem-types', response_model=ProblemTypeResponse, status_code=status.HTTP_201_CREATED)
def create_problem_type(
	request: ProblemTypeCreate,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Tạo mới một loại bài tập"""
	existing = db.query(ProblemType).filter(ProblemType.name == request.name).first()
	if existing:
		raise HTTPException(status_code=400, detail="Problem type already exists")
	
	pt = ProblemType(name=request.name.strip(), description=request.description)
	db.add(pt)
	db.commit()
	db.refresh(pt)
	return pt


@router.patch('/problem-types/{pt_id}', response_model=ProblemTypeResponse)
def update_problem_type(
	pt_id: int,
	request: ProblemTypeUpdate,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Cập nhật thông tin loại bài tập"""
	pt = db.query(ProblemType).filter(ProblemType.id == pt_id).first()
	if not pt:
		raise HTTPException(status_code=404, detail="Problem type not found")
	
	if request.name:
		check_exist = db.query(ProblemType).filter(ProblemType.name == request.name, ProblemType.id != pt_id).first()
		if check_exist:
			raise HTTPException(status_code=400, detail="Problem type name already exists")
		pt.name = request.name.strip()
	
	if request.description is not None:
		pt.description = request.description
		
	db.commit()
	db.refresh(pt)
	return pt


@router.delete('/problem-types/{pt_id}')
def delete_problem_type(
	pt_id: int,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Xóa loại bài tập (chỉ xóa được khi không có bài tập nào thuộc loại này)"""
	pt = db.query(ProblemType).filter(ProblemType.id == pt_id).first()
	if not pt:
		raise HTTPException(status_code=404, detail="Problem type not found")
	
	# Check usage
	if pt.problems:
		raise HTTPException(status_code=400, detail=f"Cannot delete problem type '{pt.name}' because it is used by {len(pt.problems)} problems")

	db.delete(pt)
	db.commit()
	return {"success": True, "message": f"Problem type '{pt.name}' deleted successfully"}


@router.post("/problems/{problem_id}/testcases", status_code=status.HTTP_201_CREATED)
def add_test_case(
	problem_id: int,
	test_case: TestCaseCreate,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Add a test case to a problem"""
	problem = db.query(Problem).filter(Problem.id == problem_id).first()
	if not problem:
		raise HTTPException(status_code=404, detail="Problem not found")

	new_tc = TestCase(
		problem_id=problem_id,
		input=test_case.input,
		expected_output=test_case.expected_output
	)
	db.add(new_tc)
	db.commit()
	db.refresh(new_tc)

	return {"id": new_tc.id, "problem_id": new_tc.problem_id, "input": new_tc.input, "expected_output": new_tc.expected_output}

@router.post('/problems/{problem_id}/import-submissions')
def import_submissions_to_qdrant(
	problem_id: str,
	file: UploadFile = File(...),
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Import crawled student submissions vào Qdrant cho một problem cụ thể."""
	try:
		tutor = get_qdrant_tutor()
	except Exception as e:
		raise HTTPException(status_code=500, detail=f"Qdrant not available: {e}")

	added = 0

	try:
		contents = file.file.read()
		_enforce_upload_limit(len(contents))
		try:
			text = contents.decode("utf-8")
		except Exception:
			text = contents.decode("latin-1", errors="ignore")

		lines = [l.strip() for l in text.splitlines() if l.strip()]
		if len(lines) == 1 and file.filename.endswith('.py'):
			code = normalize_code(text)
			tutor.add_submission(problem_id=str(problem_id), code_content=code, is_passed=False, user_uuid="imported")
			added = 1
		elif file.filename.endswith('.csv'):
			# Parse CSV
			csv_reader = csv.DictReader(io.StringIO(text))
			for row in csv_reader:
				code = row.get('code') or row.get('source_code')
				if not code:
					continue
				# Chuyển đổi escaped newlines (\n, \t, \r) thành newline thực
				code = code.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r')
				is_passed = row.get('is_passed', 'False').lower() in ('true', '1', 'yes')
				user_uuid = row.get('user_uuid') or row.get('user') or row.get('username') or 'imported'
				tutor.add_submission(
					problem_id=str(problem_id),
					code_content=normalize_code(code),
					is_passed=is_passed,
					user_uuid=str(user_uuid),
				)
				added += 1
		else:
			# JSONL
			for ln in lines:
				try:
					obj = json.loads(ln)
					code = obj.get('code') or obj.get('source') or obj.get('text')
					if not code:
						continue
					# Chuyển đổi escaped newlines (\n, \t, \r) thành newline thực
					code = code.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r')
					is_passed = obj.get('is_passed', False)
					user_uuid = obj.get('user_uuid') or obj.get('user') or obj.get('username') or 'imported'
					tutor.add_submission(
						problem_id=str(problem_id),
						code_content=normalize_code(code),
						is_passed=bool(is_passed),
						user_uuid=str(user_uuid),
					)
					added += 1
				except Exception:
					continue

	except Exception as e:
		raise HTTPException(status_code=500, detail=f"Failed to process file: {e}")
	finally:
		try:
			file.file.close()
		except Exception:
			pass

	return {"success": True, "imported_count": added}


@router.delete("/testcases/{testcase_id}")
def delete_test_case(
	testcase_id: int,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Delete a test case"""
	test_case = db.query(TestCase).filter(TestCase.id == testcase_id).first()
	if not test_case:
		raise HTTPException(status_code=404, detail="Test case not found")

	db.delete(test_case)
	db.commit()

	return {"message": "Test case deleted successfully"}


# System Statistics

@router.get("/stats", response_model=SystemStatsResponse)
def get_system_stats(
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Get system-wide statistics"""

	users_total = db.query(User).count()
	users_admin = db.query(User).filter(User.is_admin == 1).count()
	problems_total = db.query(Problem).count()
	submissions_total = db.query(Submission).count()

	submissions_passed = db.query(Submission).filter(Submission.passed_all.is_(True)).count()

	# Get Qdrant stats
	try:
		qdrant = get_qdrant_tutor()
		qdrant_stats = qdrant.get_collection_stats()
		qdrant_points = qdrant_stats.get("student_submissions", {}).get("points_count", 0)
	except Exception as e:
		logger.error(f"Failed to get Qdrant stats: {e}")
		qdrant_stats = {}
		qdrant_points = 0

	return SystemStatsResponse(
		users_total=users_total,
		users_admin=users_admin,
		problems_total=problems_total,
		submissions_total=submissions_total,
		submissions_passed=submissions_passed,
		qdrant_points=qdrant_points,
		qdrant_collections=qdrant_stats
	)


# Submissions (Admin)

@router.get("/submissions", response_model=AdminSubmissionsResponse)
def list_submissions_admin(
	skip: int = 0,
	limit: int = 50,
	user_id: Optional[int] = None,
	problem_id: Optional[int] = None,
	passed: Optional[bool] = None,
	q: Optional[str] = None,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""List submissions với basic filters + pagination cho admin UI."""
	skip = max(skip, 0)
	limit = max(min(limit, 200), 1)

	query = db.query(Submission).join(User, Submission.user_id == User.id).join(Problem, Submission.problem_id == Problem.id)
	if user_id is not None:
		query = query.filter(Submission.user_id == user_id)
	if problem_id is not None:
		query = query.filter(Submission.problem_id == problem_id)
	if passed is not None:
		query = query.filter(Submission.passed_all.is_(passed))
	if q:
		qq = q.strip()
		if qq:
			if qq.isdigit():
				qn = int(qq)
				query = query.filter(or_(Submission.id == qn, Submission.user_id == qn, Submission.problem_id == qn, User.username.ilike(f"%{qq}%"), Problem.title.ilike(f"%{qq}%")))
			else:
				query = query.filter(or_(User.username.ilike(f"%{qq}%"), Problem.title.ilike(f"%{qq}%")))

	total = query.count()
	rows = (
		query
		.add_columns(User.username, Problem.title)
		.order_by(Submission.submitted_at.desc())
		.offset(skip)
		.limit(limit)
		.all()
	)

	items: List[AdminSubmissionItem] = []
	for (sub, username, problem_title) in rows:
		items.append(AdminSubmissionItem(
			id=sub.id,
			user_id=sub.user_id,
			username=username,
			problem_id=sub.problem_id,
			problem_title=problem_title,
			passed_all=bool(getattr(sub, "passed_all", False)),
			submitted_at=sub.submitted_at.isoformat() if getattr(sub, "submitted_at", None) else None
		))

	return AdminSubmissionsResponse(
		total=total,
		skip=skip,
		limit=limit,
		items=items
	)


@router.get("/submissions/{submission_id}", response_model=AdminSubmissionDetail)
def get_submission_admin(
	submission_id: int,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Get submission detail (code + results) cho admin UI."""
	sub = (
		db.query(Submission, User.username, Problem.title)
		.join(User, Submission.user_id == User.id)
		.join(Problem, Submission.problem_id == Problem.id)
		.filter(Submission.id == submission_id)
		.first()
	)
	if not sub:
		raise HTTPException(status_code=404, detail="Submission not found")
	(submission, username, problem_title) = sub
	return AdminSubmissionDetail(
		id=submission.id,
		user_id=submission.user_id,
		username=username,
		problem_id=submission.problem_id,
		problem_title=problem_title,
		passed_all=bool(submission.passed_all),
		submitted_at=submission.submitted_at.isoformat() if submission.submitted_at else None,
		code=submission.code,
		results=submission.results
	)


# Qdrant Management

@router.post("/qdrant/chunk-submissions")
def chunk_submissions_to_qdrant(
	request: QdrantChunkRequest,
	db: Session = Depends(get_db),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Tự động chia nhỏ các submission thành các chunk và lưu vào Qdrant"""
	try:
		qdrant = get_qdrant_tutor()

		# Build query - chỉ lấy các submission chưa được chunk
		query = db.query(Submission).filter(Submission.is_chunked.is_(False))

		if request.is_passed_only:
			query = query.filter(Submission.passed_all.is_(True))

		if request.problem_id:
			query = query.filter(Submission.problem_id == int(request.problem_id))

		if request.user_id:
			query = query.filter(Submission.user_id == request.user_id)

		submissions = query.limit(request.limit).all()

		if not submissions:
			return {
				"success": True,
				"message": "No unchunked submissions found matching criteria",
				"chunked_count": 0
			}

		# Chunk into Qdrant
		chunked_count = 0
		submissions_processed = 0
		for submission in submissions:
			try:
				point_ids = qdrant.add_submission(
					problem_id=str(submission.problem_id),
					code_content=submission.code,
					is_passed=submission.passed_all,
					user_uuid=str(submission.user_id),
					metadata={
						"submission_id": submission.id,
						"submitted_at": submission.submitted_at.isoformat() if getattr(submission, 'submitted_at', None) else None
					}
				)
				chunked_count += len(point_ids)
				submissions_processed += 1
				
				# Đánh dấu submission đã được chunk
				submission.is_chunked = True
				db.flush()
				
			except Exception as e:
				logger.error(f"Failed to chunk submission {submission.id}: {e}")
				continue
		
		# Commit tất cả thay đổi
		db.commit()
		logger.info(f"Marked {submissions_processed} submissions as chunked")

		return {
			"success": True,
			"message": f"Chunked {submissions_processed} submissions into {chunked_count} Qdrant points",
			"submissions_processed": submissions_processed,
			"chunked_count": chunked_count
		}

	except Exception as e:
		logger.error(f"Error chunking submissions: {e}")
		raise HTTPException(status_code=500, detail=str(e))


@router.get("/qdrant/stats")
def get_qdrant_stats(
	current_admin: User = Depends(get_current_admin_user)
):
	"""Get Qdrant collection statistics"""
	try:
		qdrant = get_qdrant_tutor()
		stats = qdrant.get_collection_stats()
		return {"success": True, "stats": stats}
	except Exception as e:
		logger.error(f"Failed to get Qdrant stats: {e}")
		raise HTTPException(status_code=500, detail=str(e))


@router.delete("/qdrant/clear")
def clear_qdrant_collection(
	confirm: bool = False,
	current_admin: User = Depends(get_current_admin_user)
):
	"""Xóa toàn bộ dữ liệu từ Qdrant collection"""
	if not confirm:
		raise HTTPException(
			status_code=400,
			detail="Must set confirm=true to clear Qdrant collection"
		)

	try:
		qdrant = get_qdrant_tutor()
		qdrant._ensure_collection()

		return {
			"success": True,
			"message": "Qdrant collection cleared successfully"
		}
	except Exception as e:
		logger.error(f"Failed to clear Qdrant: {e}")
		raise HTTPException(status_code=500, detail=str(e))


# Scheduler Management

@router.get("/scheduler/config")
def get_scheduler_config(
	current_admin: User = Depends(get_current_admin_user)
):
	"""Get scheduler configuration"""
	scheduler = get_scheduler()
	return scheduler.get_config()


class SchedulerConfigUpdate(BaseModel):
	auto_chunk_enabled: Optional[bool] = None
	auto_chunk_interval_hours: Optional[int] = None
	auto_chunk_limit: Optional[int] = None


@router.patch("/scheduler/config")
def update_scheduler_config(
	request: SchedulerConfigUpdate,
	current_admin: User = Depends(get_current_admin_user)
):
	"""Update scheduler configuration"""
	scheduler = get_scheduler()
	scheduler.update_config(
		auto_chunk_enabled=request.auto_chunk_enabled,
		auto_chunk_interval_hours=request.auto_chunk_interval_hours,
		auto_chunk_limit=request.auto_chunk_limit
	)
	return {"success": True, "config": scheduler.get_config()}


@router.post("/scheduler/schedules", status_code=status.HTTP_201_CREATED)
def create_chunking_schedule(
	request: ChunkScheduleRequest,
	current_admin: User = Depends(get_current_admin_user)
):
	"""Tạo lịch chunking"""
	scheduler = get_scheduler()
	sched_dt = None
	if request.scheduled_at:
		try:
			sched_dt = datetime.fromisoformat(request.scheduled_at)
		except Exception:
			raise HTTPException(status_code=400, detail="Invalid scheduled_at format")

	schedule_id = scheduler.schedule_schedule(
		name=request.name,
		is_passed_only=request.is_passed_only,
		problem_id=request.problem_id,
		limit=request.limit,
		scheduled_at=sched_dt
	)
	return {"success": True, "schedule_id": schedule_id}


@router.get("/scheduler/schedules")
def list_schedules(
	limit: int = 20,
	current_admin: User = Depends(get_current_admin_user)
):
	"""List recent schedules"""
	scheduler = get_scheduler()
	schedules = scheduler.get_recent_schedules(limit=limit)
	return {"success": True, "schedules": [schedule.to_dict() for schedule in schedules]}


@router.get("/scheduler/schedules/{schedule_id}")
def get_schedule_status(
	schedule_id: str,
	current_admin: User = Depends(get_current_admin_user)
):
	"""Get status of a specific schedule"""
	scheduler = get_scheduler()
	schedule = scheduler.get_schedule(schedule_id)

	if not schedule:
		raise HTTPException(status_code=404, detail="Schedule not found")

	return {"success": True, "schedule": schedule.to_dict()}


@router.delete("/scheduler/schedules/{schedule_id}")
def cancel_schedule(
	schedule_id: str,
	current_admin: User = Depends(get_current_admin_user)
):
	"""Hủy một schedule đang pending"""
	scheduler = get_scheduler()
	result = scheduler.cancel_schedule(schedule_id)
	
	if not result["success"]:
		raise HTTPException(status_code=400, detail=result.get("error", "Cannot cancel schedule"))
	
	return {"success": True, "message": f"Schedule {schedule_id} cancelled"}


def _process_import_background(import_id: str, submissions: list):
	"""Thực hiện import Qdrant"""
	try:
		qdrant = get_qdrant_tutor()
		
		imported_count = 0
		batch_size = 10
		
		for i in range(0, len(submissions), batch_size):
			batch = submissions[i:i+batch_size]
			
			for submission in batch:
				try:
					code_content = normalize_code(submission["code"])
					point_ids = qdrant.add_submission(
						problem_id=submission['problem_id'],
						code_content=code_content,
						is_passed=submission['is_passed'],
						user_uuid=submission['user_uuid']
					)
					if point_ids:
						imported_count += len(point_ids)
				except Exception as e:
					if import_id in import_progress:
						import_progress[import_id]["errors"].append(str(e))
				
				if import_id in import_progress:
					import_progress[import_id]["processed"] += 1
			
			if import_id in import_progress:
				import_progress[import_id]["imported"] = imported_count
		
		if import_id in import_progress:
			import_progress[import_id]["status"] = "completed"
			
	except Exception as e:
		if import_id in import_progress:
			import_progress[import_id]["status"] = "failed"
			import_progress[import_id]["errors"].append(str(e))
		logger.error(f"Background import failed: {e}")


@router.post("/qdrant/import")
async def import_to_qdrant(
	background_tasks: BackgroundTasks,
	file: UploadFile = File(...),
	problem_id: Optional[str] = Form(None),
	current_admin: User = Depends(get_current_admin_user)
):
	"""Import submissions từ file CSV/JSONL vào Qdrant (Async Background)"""
	import_id = str(uuid.uuid4())
	import_progress[import_id] = {
		"status": "processing",
		"total": 0,
		"processed": 0,
		"imported": 0,
		"errors": []
	}

	try:
		content = await file.read()
		_enforce_upload_limit(len(content))
		
		try:
			file_content = content.decode("utf-8")
		except Exception:
			file_content = content.decode("latin-1", errors="ignore")
		
		submissions = []
		
		if file.filename.endswith('.csv'):
			# Parse CSV
			reader = csv.DictReader(io.StringIO(file_content))
			for row in reader:
				code = row.get('code', '').strip()
				# Chuyển đổi escaped newlines thành newline thực
				code = code.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r')
				is_passed = str(row.get("is_passed", "True")).lower() in ("true", "1", "yes", "y")
				user_uuid = row.get('user_uuid', str(uuid.uuid4()))
				prob_id = problem_id or row.get('problem_id', 'default')
				
				if code:
					submissions.append({
						'code': code,
						'is_passed': is_passed,
						'user_uuid': user_uuid,
						'problem_id': prob_id
					})
					
		elif file.filename.endswith('.jsonl'):
			# Parse JSONL
			for line in file_content.strip().split('\n'):
				if line.strip():
					try:
						row = json.loads(line)
					except Exception as e:
						import_progress[import_id]["errors"].append(f"Invalid JSONL line: {e}")
						continue
					code = (row.get('code', '') or '').strip()
					# Chuyển đổi escaped newlines thành newline thực
					code = code.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r')
					is_passed = row.get('is_passed', True)
					user_uuid = row.get('user_uuid', str(uuid.uuid4()))
					prob_id = problem_id or row.get('problem_id', 'default')
					
					if code:
						submissions.append({
							'code': code,
							'is_passed': bool(is_passed),
							'user_uuid': user_uuid,
							'problem_id': prob_id
						})
		
		total_subs = len(submissions)
		import_progress[import_id]["total"] = total_subs
		
		if total_subs > QDRANT_IMPORT_MAX_RECORDS:
			import_progress[import_id]["errors"].append(
				f"Too many records: {total_subs}. Truncated to {QDRANT_IMPORT_MAX_RECORDS}."
			)
			submissions = submissions[:QDRANT_IMPORT_MAX_RECORDS]
			import_progress[import_id]["total"] = len(submissions)

		background_tasks.add_task(_process_import_background, import_id, submissions)
		
		return {
			"success": True,
			"import_id": import_id,
			"message": "Import started in background",
			"total": len(submissions)
		}
		
	except Exception as e:
		import_progress[import_id]["status"] = "failed"
		import_progress[import_id]["errors"].append(str(e))
		logger.error(f"Import initialization failed: {e}")
		raise HTTPException(status_code=500, detail=str(e))


@router.get("/qdrant/import/{import_id}/progress")
def get_import_progress(
	import_id: str,
	current_admin: User = Depends(get_current_admin_user)
):
	"""Get import progress"""
	if import_id not in import_progress:
		raise HTTPException(status_code=404, detail="Import not found")
	
	return import_progress[import_id]
