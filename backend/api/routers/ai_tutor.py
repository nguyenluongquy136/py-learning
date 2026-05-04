"""AI Tutor API.

This router intentionally exposes only the endpoints used by the current frontend
to keep the backend surface area small and easier to maintain.
"""

from fastapi import APIRouter, HTTPException, Depends, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timedelta
import logging
import json
import os

from app.db import get_db
from app.auth import get_current_user, get_user_id_from_authorization_header
from domain.ai import get_hybrid_tutor, get_hybrid_analyzer, get_qdrant_tutor
from infra.utils.llm_utils import get_groq_client
from infra.analysis.ast_analysis import build_ast_graph
from infra.analysis.cfg_builder import build_cfg
from infra.analysis.dfg_builder import analyze_data_flow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


class HintRequest(BaseModel):
	"""Yêu cầu gợi ý"""
	code: str
	# Frontend sends string (can be numeric string or "default")
	problem_id: str
	problem_description: str = ""
	hint_level: int = Field(default=1, ge=1, le=5)
	previous_hints: List[str] = Field(default_factory=list)
	language: str = "vi"
	session_id: Optional[int] = None
	strategy: str = "rag"


class HintResponse(BaseModel):
	"""Phản hồi gợi ý từ gia sư"""
	success: bool
	syntax_valid: bool
	error_type: str
	error_message: str

	# Hint
	hint: str
	hint_level: int
	next_level: int
	follow_up_question: str = ""

	# RAG context
	reference_similarity: float = 0.0
	reference_used: bool = False

	# Telemetry: optional id for recording feedback (requires migration 004)
	interaction_id: Optional[int] = None

	# Additional context from semantic analysis
	suggested_approach: str = ""
	student_intent: str = ""

	# Metadata
	concepts_to_review: List[str] = []
	confidence: float
	strategy: str


class ChatRequest(BaseModel):
	"""Yêu cầu chat với gia sư"""
	code: str
	# Frontend sends string (can be numeric string or "default")
	problem_id: str
	problem_description: str
	message: str
	conversation_history: List[Dict[str, Any]] = Field(default_factory=list)
	language: str = "vi"


class ChatResponse(BaseModel):
	"""Phản hồi chat từ gia sư"""
	response: str
	follow_up_questions: List[str] = []
	concepts_mentioned: List[str] = []
	hint_level: Optional[int] = None


class MasteryItem(BaseModel):
	"""Mastery theo problem type (phục vụ dashboard/path)."""
	topic: str
	score: int
	attempts: int


class LearningPathNode(BaseModel):
	"""Node cho Learning Path UI."""
	id: str
	title: str
	status: str  # locked | available | completed | current
	qValue: float
	description: str


class LearningReportSummary(BaseModel):
	"""High-level metrics for Direction A."""
	solved_sessions: int
	avg_time_solved_seconds: Optional[int] = None
	avg_hints_per_solved: Optional[float] = None
	hint_helpful_rate: Optional[float] = None
	avg_attempts_per_solved_problem: Optional[float] = None


class LearningReportByConceptItem(BaseModel):
	concept: str
	solved_sessions: int
	avg_time_solved_seconds: Optional[int] = None
	avg_hints_per_solved: Optional[float] = None
	hint_helpful_rate: Optional[float] = None


class LearningReportResponse(BaseModel):
	summary: LearningReportSummary
	by_concept: List[LearningReportByConceptItem]


# ==================== Endpoints ====================


@router.post("/hint", response_model=HintResponse)
async def get_hint(
	request: HintRequest,
	db: Session = Depends(get_db),
	authorization: Optional[str] = Header(None),
):
	"""Lấy gợi ý từ gia sư AI sử dụng Qdrant RAG + Socratic method."""
	try:
		tutor = get_hybrid_tutor()

		feedback = await tutor.generate_feedback(
			student_code=request.code,
			problem_id=str(request.problem_id),
			problem_description=request.problem_description,
			hint_level=request.hint_level,
			previous_hints=request.previous_hints,
			language=request.language
		)

		# Optional telemetry: save interaction if user is authenticated and table exists.
		interaction_id: Optional[int] = None
		try:
			user_id = get_user_id_from_authorization_header(authorization)
			if user_id:
				# Best-effort conversion for problem_id
				pid: Optional[int] = None
				try:
					pid = int(str(request.problem_id)) if str(request.problem_id).isdigit() else None
				except Exception:
					pid = None

				# Insert and try to get id (PostgreSQL supports RETURNING)
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
					"user_id": int(user_id),
					"problem_id": pid,
					"session_id": int(request.session_id) if request.session_id else None,
					"code_snapshot": request.code,
					"hint_level": int(request.hint_level),
					"hint_text": feedback.hint,
					"strategy": getattr(feedback, "strategy", "unified_rag"), # Default logic moi
					"reference_similarity": float(getattr(feedback, "reference_similarity", 0.0) or 0.0),
					"reference_used": bool(getattr(feedback, "reference_code", None) is not None),
					"concepts_involved": json.dumps(list(getattr(feedback, "concepts_to_review", []) or []), ensure_ascii=False),
				}).fetchone()
				db.commit()
				if row and row[0]:
					interaction_id = int(row[0])
		except Exception as e:
			# Do not fail hint generation if telemetry is unavailable (e.g. table not migrated yet).
			logger.info(f"Telemetry hint interaction skipped: {e}")

		return HintResponse(
			success=True,
			syntax_valid=feedback.syntax_valid,
			error_type=feedback.error_type,
			error_message=feedback.error_message,
			hint=feedback.hint,
			hint_level=feedback.hint_level,
			next_level=min(feedback.hint_level + 1, 5),
			follow_up_question=feedback.follow_up_question,
			reference_similarity=feedback.reference_similarity,
			reference_used=feedback.reference_code is not None,
			interaction_id=interaction_id,
			suggested_approach=getattr(feedback, 'suggested_approach', ''),
			student_intent=getattr(feedback, 'student_intent', ''),
			concepts_to_review=feedback.concepts_to_review,
			confidence=feedback.confidence,
			strategy=feedback.strategy
		)

	except Exception as e:
		logger.error(f"Hint error: {e}")
		raise HTTPException(status_code=500, detail=str(e))


class HintFeedbackRequest(BaseModel):
	interaction_id: int
	was_helpful: bool


@router.post("/hint/feedback")
def submit_hint_feedback(
	req: HintFeedbackRequest,
	user=Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Lưu feedback cho interaction hint.
	"""
	try:
		res = db.execute(text("""
			UPDATE student_hint_interactions
			SET was_helpful = :was_helpful
			WHERE id = :id AND user_id = :user_id
		"""), {"was_helpful": bool(req.was_helpful), "id": int(req.interaction_id), "user_id": int(user.id)})
		db.commit()
		updated = getattr(res, "rowcount", 0) or 0
		if updated == 0:
			raise HTTPException(status_code=404, detail="Interaction not found")
		return {"success": True}
	except HTTPException:
		raise
	except Exception as e:
		logger.warning(f"Lưu feedback cho interaction hint thất bại: {e}")
		raise HTTPException(status_code=500, detail="Telemetry storage is not available (did you apply migration 004?)")


class SessionStartRequest(BaseModel):
	problem_id: Optional[int] = None


class SessionEndRequest(BaseModel):
	session_id: int
	outcome: Optional[str] = "unknown"  # solved | abandoned | unknown


@router.post("/session/start")
def start_learning_session(
	req: SessionStartRequest,
	user=Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Bắt đầu một session học cho user hiện tại"""
	try:
		row = db.execute(text("""
			INSERT INTO learning_sessions(user_id, problem_id)
			VALUES (:user_id, :problem_id)
			RETURNING id
		"""), {"user_id": int(user.id), "problem_id": int(req.problem_id) if req.problem_id else None}).fetchone()
		db.commit()
		return {"success": True, "session_id": int(row[0]) if row and row[0] else None}
	except Exception as e:
		logger.warning(f"Start session failed: {e}")
		raise HTTPException(status_code=500, detail="Learning session storage is not available (did you apply migration 005?)")


@router.post("/session/end")
def end_learning_session(
	req: SessionEndRequest,
	user=Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Kết thúc một session học cho user hiện tại"""
	try:
		# Kiểm tra session có tồn tại và chưa kết thúc
		row = db.execute(text("""
			SELECT id, started_at, ended_at
			FROM learning_sessions
			WHERE id = :id AND user_id = :user_id
			LIMIT 1
		"""), {"id": int(req.session_id), "user_id": int(user.id)}).fetchone()
		if not row:
			raise HTTPException(status_code=404, detail="Session not found")
		if row[2] is not None:
			return {"success": True, "session_id": int(req.session_id), "already_ended": True}

		# Cập nhật ended_at và duration
		db.execute(text("""
			UPDATE learning_sessions
			SET ended_at = CURRENT_TIMESTAMP,
			    duration_seconds = GREATEST(0, CAST(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) AS INTEGER)),
			    outcome = :outcome
			WHERE id = :id AND user_id = :user_id
		"""), {"id": int(req.session_id), "user_id": int(user.id), "outcome": (req.outcome or "unknown")[:32]})
		db.commit()
		return {"success": True, "session_id": int(req.session_id)}
	except HTTPException:
		raise
	except Exception as e:
		logger.warning(f"End session failed: {e}")
		raise HTTPException(status_code=500, detail="Learning session storage is not available (did you apply migration 005?)")


@router.post("/chat", response_model=ChatResponse)
async def chat_with_tutor(request: ChatRequest):
	"""Chat tương tác với gia sư AI."""
	try:
		tutor = get_hybrid_tutor()
		analyzer = get_hybrid_analyzer()
		qdrant = get_qdrant_tutor()

		# Phân tích code hiện tại
		analysis = analyzer.analyze_ast(request.code)

		# Lấy reference code từ Qdrant (semantic_search chỉ chọn solution đã pass)
		refs = qdrant.semantic_search(query=request.code, top_k=1, problem_id=str(request.problem_id), only_passed=True)
		ref_code = (refs[0].full_code if refs[0].full_code else refs[0].code) if refs else None

		# Build conversation context
		conv_text = ""
		for msg in request.conversation_history[-8:]:
			role = "Học sinh" if msg.get("role") == "user" else "Gia sư"
			conv_text += f"{role}: {msg.get('content', '')}\n"

		# Build prompt
		lang_note = "Trả lời bằng tiếng Việt." if request.language == "vi" else "Respond in English."

		error_context = ""
		if not analysis.valid_syntax:
			error_context = f"\nLỗi syntax: {analysis.error} ở dòng {analysis.error_line}"
		elif analysis.undefined_variables:
			error_context = f"\nBiến chưa định nghĩa: {', '.join(analysis.undefined_variables)}"
		elif analysis.potential_infinite_loop:
			error_context = "\nCảnh báo: Có thể có vòng lặp vô tận"

		ref_section = ""
		if ref_code:
			ref_section = f"\n\nCode tham khảo (KHÔNG cho sinh viên thấy):\n```python\n{ref_code}\n```"

		prompt = f"""{lang_note}
Bạn là gia sư Python thân thiện, sử dụng phương pháp Socratic.
QUAN TRỌNG: KHÔNG BAO GIỜ đưa code hoàn chỉnh. Chỉ hướng dẫn và đặt câu hỏi.

Bài toán: {request.problem_description}

Code hiện tại của sinh viên:
```python
{request.code}
```{error_context}{ref_section}

Lịch sử chat:
{conv_text}

Sinh viên hỏi: {request.message}

Hãy trả lời theo phương pháp đặt câu hỏi dẫn dắt thay vì cho đáp án trực tiếp.
"""

		# Call LLM
		try:
			client = get_groq_client()
			response = client.chat.completions.create(
				model=os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant"),
				messages=[
					{"role": "system", "content": "You are a friendly Socratic Python tutor."},
					{"role": "user", "content": prompt}
				],
				max_tokens=1024,
				temperature=0.7
			)
			response_text = response.choices[0].message.content.strip()
		except Exception as e:
			logger.warning(f"LLM error: {e}")
			if request.language == "vi":
				response_text = "Xin lỗi, mình gặp chút vấn đề. Bạn có thể mô tả lại vấn đề không? 🙏"
			else:
				response_text = "Sorry, I encountered an issue. Could you describe your problem again? 🙏"

		# Lấy các khái niệm liên quan
		concepts = []
		if analysis.has_for_loop or analysis.has_while_loop:
			concepts.append("loops" if request.language == "en" else "vòng lặp")
		if analysis.has_function:
			concepts.append("functions" if request.language == "en" else "hàm")
		if analysis.has_recursion:
			concepts.append("recursion" if request.language == "en" else "đệ quy")

		# Tạo câu hỏi tiếp theo
		follow_ups = []
		if request.language == "vi":
			if not analysis.valid_syntax:
				follow_ups.append("Bạn đã kiểm tra lại dấu ngoặc và thụt lề chưa?")
			elif analysis.potential_infinite_loop:
				follow_ups.append("Điều kiện dừng của vòng lặp là gì?")
			else:
				follow_ups.append("Bạn có muốn mình kiểm tra thêm gì không?")
		else:
			if not analysis.valid_syntax:
				follow_ups.append("Have you checked your brackets and indentation?")
			elif analysis.potential_infinite_loop:
				follow_ups.append("What's the stopping condition for your loop?")
			else:
				follow_ups.append("Would you like me to check anything else?")

		return ChatResponse(
			response=response_text,
			follow_up_questions=follow_ups,
			concepts_mentioned=concepts
		)

	except Exception as e:
		logger.error(f"Chat error: {e}")
		raise HTTPException(status_code=500, detail=str(e))


# Visualization Endpoints

class VisualizationRequest(BaseModel):
	code: str
	max_nodes: int = Field(default=800, ge=50, le=5000)


@router.post("/visualize/ast")
async def visualize_ast(request: VisualizationRequest):
	"""Generate Abstract Syntax Tree (AST) graph for the code."""
	try:
		graph = build_ast_graph(request.code, max_nodes=request.max_nodes)
		return {"success": True, "graph": graph, "type": "ast"}
	except SyntaxError as e:
		# Hiển thị lỗi syntax errors
		raise HTTPException(
			status_code=400,
			detail={"error": f"Syntax error: {e.msg}", "error_line": e.lineno or 0},
		)
	except Exception as e:
		logger.error(f"AST generation error: {e}")
		raise HTTPException(status_code=500, detail=str(e))


@router.post("/visualize/cfg")
async def visualize_cfg(request: VisualizationRequest):
	"""Generate Control Flow Graph (CFG) for the code."""
	try:
		cfg_data = build_cfg(request.code)
		return {"success": True, "graph": cfg_data, "type": "cfg"}
	except Exception as e:
		logger.error(f"CFG generation error: {e}")
		raise HTTPException(status_code=500, detail=str(e))


@router.post("/visualize/dfg")
async def visualize_dfg(request: VisualizationRequest):
	"""Generate Data Flow Graph (DFG) for the code."""
	try:
		dfg_data = analyze_data_flow(request.code)
		return {
			"success": True,
			"graph": dfg_data.get("graph"),
			"issues": dfg_data.get("issues"),
			"statistics": dfg_data.get("statistics"),
			"type": "dfg"
		}
	except Exception as e:
		logger.error(f"DFG generation error: {e}")
		raise HTTPException(status_code=500, detail=str(e))


# Progress Tracking

@router.get("/progress")
async def get_student_progress(
	user_id: Optional[int] = None,
	authorization: Optional[str] = Header(None),
	history_page: int = 1,
	history_size: int = 10,
	pt_page: int = 1,
	pt_size: int = 20,
	db: Session = Depends(get_db)
):
	"""Lấy thông tin tiến trình học của học sinh"""

	if not user_id:
		user_id = get_user_id_from_authorization_header(authorization)

	# Không có user_id hợp lệ -> yêu cầu client gửi token hoặc truyền user_id
	if not user_id:
		raise HTTPException(status_code=401, detail="Missing or invalid authorization")

	try:
		# Lấy thông tin tiến trình học
		submission_stats = db.execute(text("""
			SELECT 
				COUNT(*) as total_submissions,
				COUNT(DISTINCT problem_id) as total_problems,
				COUNT(*) FILTER (WHERE passed_all = true) as solved_count,
				COUNT(DISTINCT problem_id) FILTER (WHERE passed_all = true) as solved_problems
			FROM submissions
			WHERE user_id = :user_id
		"""), {"user_id": user_id}).fetchone()

		total_problems = submission_stats[1] if submission_stats else 0
		solved_problems = submission_stats[3] if submission_stats else 0

		# Lấy số lượng bài tập
		total_available = db.execute(text("SELECT COUNT(*) FROM problems")).fetchone()
		total_available_problems = total_available[0] if total_available else 0

		# Lấy số lượng bài nộp gần đây (phân trang)
		recent_total_row = db.execute(text("""
			SELECT COUNT(*) FROM submissions WHERE user_id = :user_id
		"""), {"user_id": user_id}).fetchone()
		recent_total = recent_total_row[0] if recent_total_row else 0

		offset = max(history_page - 1, 0) * max(history_size, 1)
		recent_submissions = db.execute(text("""
			SELECT 
				s.id,
				s.passed_all,
				p.title,
				s.submitted_at
			FROM submissions s
			LEFT JOIN problems p ON s.problem_id = p.id
			WHERE s.user_id = :user_id
			ORDER BY s.submitted_at DESC
			LIMIT :limit OFFSET :offset
		"""), {"user_id": user_id, "limit": history_size, "offset": offset}).fetchall()

		recent_activity = []
		for row in recent_submissions:
			activity_type = "solved" if row[1] else "attempted"
			desc = f"{'Giải thành công' if row[1] else 'Thử bài'} '{row[2] or 'Bài tập'}'"
			recent_activity.append({
				"id": str(row[0]),
				"type": activity_type,
				"description": desc,
				"timestamp": row[3].isoformat() if row[3] else None
			})

		# Lấy số lượng loại bài tập
		total_pt_row = db.execute(text("""
			SELECT COUNT(DISTINCT COALESCE(pt.name,'Khác')) FROM submissions s
			LEFT JOIN problems p ON s.problem_id = p.id
			LEFT JOIN problem_types pt ON p.problem_type_id = pt.id
			WHERE s.user_id = :user_id
		"""), {"user_id": user_id}).fetchone()
		total_problem_types = total_pt_row[0] if total_pt_row else 0

		pt_offset = max(pt_page - 1, 0) * max(pt_size, 1)
		concept_stats = db.execute(text("""
			SELECT 
				COALESCE(pt.name, 'Khác') as concept,
				COUNT(DISTINCT s.problem_id) as practice_count,
				COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed_all = true) as success_count,
				MAX(s.submitted_at) as last_practiced
			FROM submissions s
			LEFT JOIN problems p ON s.problem_id = p.id
			LEFT JOIN problem_types pt ON p.problem_type_id = pt.id
			WHERE s.user_id = :user_id
			GROUP BY pt.name
			ORDER BY practice_count DESC
			LIMIT :limit OFFSET :offset
		"""), {"user_id": user_id, "limit": pt_size, "offset": pt_offset}).fetchall()

		concept_progress = []
		concepts_mastered = 0

		for row in concept_stats:
			practice_count = row[1] or 0
			success_count = row[2] or 0
			success_rate = round((success_count / max(practice_count, 1)) * 100)
			mastery = min(success_rate, 100)

			if mastery >= 80:
				concepts_mastered += 1

			concept_progress.append({
				"problemType": row[0],
				"problemTypeVi": row[0],
				"masteryLevel": mastery,
				"practiceCount": practice_count,
				"lastPracticed": row[3].strftime("%Y-%m-%d") if row[3] else None,
				"hintsUsed": 0,
				"successRate": success_rate
			})

		# Lấy tiến trình tuần (7 ngày gần nhất)
		weekly_progress = []
		day_names = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]

		for i in range(6, -1, -1):
			day = datetime.now() - timedelta(days=i)
			day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
			day_end = day.replace(hour=23, minute=59, second=59, microsecond=999999)

			day_stats = db.execute(text("""
				SELECT 
					COUNT(*) as submissions,
					COUNT(*) FILTER (WHERE passed_all = true) as solved
				FROM submissions
				WHERE submitted_at BETWEEN :start AND :end
				AND user_id = :user_id
			"""), {"start": day_start, "end": day_end, "user_id": user_id}).fetchone()

			weekly_progress.append({
				"day": day_names[day.weekday()],
				"problems": day_stats[0] if day_stats else 0,
				"solved": day_stats[1] if day_stats else 0,
				"hints": 0,
				"timeSpent": (day_stats[0] or 0) * 10
			})

		# Tính tổng thành thạo
		overall_mastery = 0
		if total_problems > 0:
			overall_mastery = round((solved_problems / total_problems) * 100)

		# Tính chuỗi ngày
		current_streak = 0
		check_date = datetime.now().date()
		for _ in range(100):
			has_submission = db.execute(text("""
				SELECT 1 FROM submissions 
				WHERE DATE(submitted_at) = :check_date
				AND user_id = :user_id
				LIMIT 1
			"""), {"check_date": check_date, "user_id": user_id}).fetchone()

			if has_submission:
				current_streak += 1
				check_date -= timedelta(days=1)
			else:
				break

		return {
			"overallMastery": overall_mastery,
			"totalProblems": total_available_problems,
			"solvedProblems": solved_problems,
			"currentStreak": current_streak,
			"longestStreak": current_streak,
			"problemTypesMastered": concepts_mastered,
			"totalProblemTypes": total_problem_types,
			"recentTotal": recent_total,
			"historyPage": history_page,
			"historySize": history_size,
			"recentActivity": recent_activity,
			"problemTypeProgress": concept_progress,
			"problemTypeTotal": total_problem_types,
			"ptPage": pt_page,
			"ptSize": pt_size,
			"weeklyProgress": weekly_progress
		}

	except Exception as e:
		logger.error(f"Error fetching progress: {e}")
		return {
			"overallMastery": 0,
			"totalProblems": 0,
			"solvedProblems": 0,
			"currentStreak": 0,
			"longestStreak": 0,
			"problemTypesMastered": 0,
			"totalProblemTypes": 1,
			"recentActivity": [],
			"problemTypeProgress": [],
			"weeklyProgress": []
		}


__all__ = ["router"]


# Tinh tiến trình học


@router.get("/mastery", response_model=List[MasteryItem])
def get_mastery(
	user=Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Return user mastery bằng `problem_type` dựa trên submissions.
	"""

	rows = db.execute(text("""
		SELECT
			COALESCE(pt.name, 'Khác') AS topic,
			COUNT(DISTINCT s.problem_id) AS attempts,
			COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed_all = true) AS successes
		FROM submissions s
		LEFT JOIN problems p ON s.problem_id = p.id
		LEFT JOIN problem_types pt ON p.problem_type_id = pt.id
		WHERE s.user_id = :user_id
		GROUP BY pt.name
		ORDER BY attempts DESC, topic ASC
	"""), {"user_id": user.id}).fetchall()

	out: List[MasteryItem] = []
	for r in rows:
		attempts = int(r[1] or 0)
		successes = int(r[2] or 0)
		score = int(round((successes / max(attempts, 1)) * 100))
		out.append(MasteryItem(topic=str(r[0]), score=score, attempts=attempts))
	return out


@router.get("/path", response_model=List[LearningPathNode])
def get_learning_path(
	user=Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Return learning path đơn giản dựa trên mastery của mỗi loại bài tập."""

	# Load tất cả loại bài tập (sắp xếp theo display_order để có lộ trình hợp lý)
	pt_rows = db.execute(text("""
		SELECT id, name, COALESCE(description,'') AS description
		FROM problem_types
		ORDER BY COALESCE(display_order, id) ASC, id ASC
	""")).fetchall()

	# Tính mastery cho mỗi loại bài tập (attempted/solved)
	m_rows = db.execute(text("""
		SELECT
			p.problem_type_id AS pt_id,
			COUNT(DISTINCT s.problem_id) AS attempts,
			COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed_all = true) AS successes
		FROM submissions s
		JOIN problems p ON s.problem_id = p.id
		WHERE s.user_id = :user_id
		GROUP BY p.problem_type_id
	"""), {"user_id": user.id}).fetchall()

	m_by_id: Dict[Optional[int], Dict[str, int]] = {}
	for r in m_rows:
		pt_id = r[0]
		m_by_id[pt_id] = {"attempts": int(r[1] or 0), "successes": int(r[2] or 0)}

	# Xác định status
	# completed: score >= 80 (đã thành thạo)
	# current: type có score thấp nhất trong các type đã từng làm (attempts > 0) và chưa completed
	# available: phần còn lại
	# locked: nếu user chưa làm gì cả, chỉ mở type đầu tiên là current, các type khác locked
	attempted_ids = [pt_id for pt_id, v in m_by_id.items() if v.get("attempts", 0) > 0 and pt_id is not None]
	has_any_attempt = len(attempted_ids) > 0

	def _score_for(pt_id: Optional[int]) -> int:
		v = m_by_id.get(pt_id) or {}
		attempts = int(v.get("attempts", 0))
		successes = int(v.get("successes", 0))
		return int(round((successes / max(attempts, 1)) * 100)) if attempts > 0 else 0

	candidates_current = []
	if has_any_attempt:
		for pt_id in attempted_ids:
			score = _score_for(pt_id)
			if score < 80:
				candidates_current.append((score, pt_id))
	candidates_current.sort(key=lambda x: (x[0], x[1] or 0))
	current_pt_id = candidates_current[0][1] if candidates_current else (attempted_ids[0] if attempted_ids else (pt_rows[0][0] if pt_rows else None))

	nodes: List[LearningPathNode] = []
	for (pt_id, name, desc) in pt_rows:
		score = _score_for(pt_id)
		attempts = int((m_by_id.get(pt_id) or {}).get("attempts", 0))

		if not has_any_attempt:
			status = "current" if pt_id == (pt_rows[0][0] if pt_rows else None) else "locked"
		else:
			if score >= 80 and attempts > 0:
				status = "completed"
			elif pt_id == current_pt_id:
				status = "current"
			else:
				status = "available"

		# qValue: baseline = "chưa thành thạo" (1 - mastery)
		q_value = round(1.0 - (score / 100.0), 3) if attempts > 0 else 0.9

		nodes.append(LearningPathNode(
			id=str(pt_id),
			title=str(name),
			status=status,
			qValue=float(q_value),
			description=str(desc) if desc else f"Luyện thêm dạng bài: {name}",
		))

	return nodes


@router.get("/report", response_model=LearningReportResponse)
def get_learning_report(
	user=Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Direction A report: time-to-solve + hint usage metrics.

	Requires migration 005 (learning_sessions). Hint metrics require migration 004 + 005.
	"""
	from sqlalchemy import text

	# Số session đã giải quyết
	solved_row = db.execute(text("""
		SELECT
			COUNT(*) AS solved_sessions,
			ROUND(AVG(duration_seconds))::INT AS avg_time_solved_seconds
		FROM learning_sessions
		WHERE user_id = :user_id AND outcome = 'solved'
	"""), {"user_id": user.id}).fetchone()

	solved_sessions = int(solved_row[0] or 0) if solved_row else 0
	avg_time = int(solved_row[1]) if solved_row and solved_row[1] is not None else None

	# Số hints trên session đã giải quyết + tỉ lệ hữu ích
	avg_hints = None
	helpful_rate = None
	try:
		h_row = db.execute(text("""
			WITH solved AS (
				SELECT id
				FROM learning_sessions
				WHERE user_id = :user_id AND outcome = 'solved'
			),
			agg AS (
				SELECT
					s.id AS session_id,
					COUNT(shi.id) AS hints_used,
					AVG(CASE WHEN shi.was_helpful IS NULL THEN NULL WHEN shi.was_helpful THEN 1 ELSE 0 END) AS helpful_rate
				FROM solved s
				LEFT JOIN student_hint_interactions shi ON shi.session_id = s.id
				GROUP BY s.id
			)
			SELECT
				ROUND(AVG(hints_used)::numeric, 3) AS avg_hints_per_solved,
				ROUND(AVG(helpful_rate)::numeric, 3) AS hint_helpful_rate
			FROM agg
		"""), {"user_id": user.id}).fetchone()
		if h_row:
			avg_hints = float(h_row[0]) if h_row[0] is not None else None
			helpful_rate = float(h_row[1]) if h_row[1] is not None else None
	except Exception as e:
		logger.info(f"Report hint metrics unavailable: {e}")

	# Số lần thử trên mỗi bài đã giải quyết (distinct problem_id)
	attempts_avg = None
	try:
		a_row = db.execute(text("""
			WITH per_problem AS (
				SELECT
					s.problem_id,
					COUNT(*) AS attempts,
					MAX(CASE WHEN s.passed_all = true THEN 1 ELSE 0 END) AS solved
				FROM submissions s
				WHERE s.user_id = :user_id
				GROUP BY s.problem_id
			)
			SELECT ROUND(AVG(attempts)::numeric, 3)
			FROM per_problem
			WHERE solved = 1
		"""), {"user_id": user.id}).fetchone()
		if a_row and a_row[0] is not None:
			attempts_avg = float(a_row[0])
	except Exception as e:
		logger.info(f"Report attempts metrics unavailable: {e}")

	# Phân tích theo concept (problem_type)
	by_concept: List[LearningReportByConceptItem] = []
	try:
		rows = db.execute(text("""
			WITH solved_sessions AS (
				SELECT
					ls.id,
					ls.duration_seconds,
					COALESCE(pt.name, 'Khác') AS concept
				FROM learning_sessions ls
				LEFT JOIN problems p ON ls.problem_id = p.id
				LEFT JOIN problem_types pt ON p.problem_type_id = pt.id
				WHERE ls.user_id = :user_id AND ls.outcome = 'solved'
			),
			hints AS (
				SELECT
					ss.concept,
					ss.id AS session_id,
					COUNT(shi.id) AS hints_used,
					AVG(CASE WHEN shi.was_helpful IS NULL THEN NULL WHEN shi.was_helpful THEN 1 ELSE 0 END) AS helpful_rate
				FROM solved_sessions ss
				LEFT JOIN student_hint_interactions shi ON shi.session_id = ss.id
				GROUP BY ss.concept, ss.id
			)
			SELECT
				ss.concept,
				COUNT(*) AS solved_sessions,
				ROUND(AVG(ss.duration_seconds))::INT AS avg_time_solved_seconds,
				ROUND(AVG(h.hints_used)::numeric, 3) AS avg_hints_per_solved,
				ROUND(AVG(h.helpful_rate)::numeric, 3) AS hint_helpful_rate
			FROM solved_sessions ss
			LEFT JOIN hints h ON h.session_id = ss.id AND h.concept = ss.concept
			GROUP BY ss.concept
			ORDER BY solved_sessions DESC, ss.concept ASC
		"""), {"user_id": user.id}).fetchall()

		for r in rows:
			by_concept.append(LearningReportByConceptItem(
				concept=str(r[0]),
				solved_sessions=int(r[1] or 0),
				avg_time_solved_seconds=int(r[2]) if r[2] is not None else None,
				avg_hints_per_solved=float(r[3]) if r[3] is not None else None,
				hint_helpful_rate=float(r[4]) if r[4] is not None else None,
			))
	except Exception as e:
		logger.info(f"Report by_concept unavailable: {e}")

	return LearningReportResponse(
		summary=LearningReportSummary(
			solved_sessions=solved_sessions,
			avg_time_solved_seconds=avg_time,
			avg_hints_per_solved=avg_hints,
			hint_helpful_rate=helpful_rate,
			avg_attempts_per_solved_problem=attempts_avg,
		),
		by_concept=by_concept,
	)


@router.get("/report/export")
def export_learning_report_csv(
	kind: str = "summary",
	user=Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Export dữ liệu CSV

	`Các trường hợp`:
	- summary: chỉ số tổng hợp (like /report.by_concept)
	- sessions: các session đã giải quyết
	- hints: các hint đã sử dụng
	"""
	from sqlalchemy import text
	import csv
	import io
	from datetime import datetime

	kind = (kind or "summary").strip().lower()
	if kind not in ("summary", "sessions", "hints"):
		raise HTTPException(status_code=400, detail="Invalid kind. Use summary|sessions|hints")

	ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
	filename = f"learning_{kind}_user_{user.id}_{ts}.csv"

	def _iter_csv():
		buf = io.StringIO()
		writer = csv.writer(buf)

		if kind == "summary":
			writer.writerow(["concept", "solved_sessions", "avg_time_solved_seconds", "avg_hints_per_solved", "hint_helpful_rate"])
			rows = db.execute(text("""
				WITH solved_sessions AS (
					SELECT
						ls.id,
						ls.duration_seconds,
						COALESCE(pt.name, 'Khác') AS concept
					FROM learning_sessions ls
					LEFT JOIN problems p ON ls.problem_id = p.id
					LEFT JOIN problem_types pt ON p.problem_type_id = pt.id
					WHERE ls.user_id = :user_id AND ls.outcome = 'solved'
				),
				hints AS (
					SELECT
						ss.concept,
						ss.id AS session_id,
						COUNT(shi.id) AS hints_used,
						AVG(CASE WHEN shi.was_helpful IS NULL THEN NULL WHEN shi.was_helpful THEN 1 ELSE 0 END) AS helpful_rate
					FROM solved_sessions ss
					LEFT JOIN student_hint_interactions shi ON shi.session_id = ss.id
					GROUP BY ss.concept, ss.id
				)
				SELECT
					ss.concept,
					COUNT(*) AS solved_sessions,
					ROUND(AVG(ss.duration_seconds))::INT AS avg_time_solved_seconds,
					ROUND(AVG(h.hints_used)::numeric, 3) AS avg_hints_per_solved,
					ROUND(AVG(h.helpful_rate)::numeric, 3) AS hint_helpful_rate
				FROM solved_sessions ss
				LEFT JOIN hints h ON h.session_id = ss.id AND h.concept = ss.concept
				GROUP BY ss.concept
				ORDER BY solved_sessions DESC, ss.concept ASC
			"""), {"user_id": user.id}).fetchall()

			for r in rows:
				writer.writerow([r[0], r[1], r[2], r[3], r[4]])

		elif kind == "sessions":
			writer.writerow(["id", "user_id", "problem_id", "started_at", "ended_at", "duration_seconds", "outcome"])
			rows = db.execute(text("""
				SELECT id, user_id, problem_id, started_at, ended_at, duration_seconds, outcome
				FROM learning_sessions
				WHERE user_id = :user_id
				ORDER BY started_at DESC
			"""), {"user_id": user.id}).fetchall()
			for r in rows:
				writer.writerow([r[0], r[1], r[2], r[3], r[4], r[5], r[6]])

		else:  # hints
			writer.writerow([
				"id", "user_id", "problem_id", "session_id", "created_at",
				"hint_level", "strategy", "reference_similarity", "reference_used",
				"was_helpful", "concepts_involved"
			])
			rows = db.execute(text("""
				SELECT
					id, user_id, problem_id, session_id, created_at,
					hint_level, strategy, reference_similarity, reference_used,
					was_helpful, concepts_involved
				FROM student_hint_interactions
				WHERE user_id = :user_id
				ORDER BY created_at DESC
			"""), {"user_id": user.id}).fetchall()
			for r in rows:
				writer.writerow(list(r))

		data = buf.getvalue()
		buf.close()
		yield data

	return StreamingResponse(
		_iter_csv(),
		media_type="text/csv; charset=utf-8",
		headers={"Content-Disposition": f'attachment; filename="{filename}"'},
	)
