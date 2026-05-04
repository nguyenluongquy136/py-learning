"""
Hybrid Tutor - Hệ thống Gia sư AI sử dụng Qdrant RAG + AST Analysis.
Kết hợp truy xuất code mẫu và phương pháp Socratic để hướng dẫn sinh viên.
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import logging
import os
import time
import json

from .qdrant_rag import get_qdrant_tutor
from .analyzer import get_hybrid_analyzer, HybridAnalysisResult
from infra.utils.normalize_code import normalize_code
from infra.utils.llm_utils import get_groq_client
import re

logger = logging.getLogger(__name__)


@dataclass
class TutorFeedback:
    """Kết quả phản hồi từ gia sư AI"""
    # Kết quả phân tích
    syntax_valid: bool
    error_type: str
    error_message: str
    error_line: Optional[int] = None
    
    # Kết quả phân tích Hybrid
    code_structure: Dict[str, Any] = None
    
    # Kết quả truy xuất từ Qdrant
    reference_code: Optional[str] = None
    reference_similarity: float = 0.0
    
    # Gợi ý (Socratic method)
    hint: str = ""
    hint_level: int = 1
    
    # Câu hỏi theo dõi
    follow_up_question: str = ""
    concepts_to_review: List[str] = None
    
    # Độ tin cậy và metadata
    confidence: float = 0.5
    strategy: str = "socratic"
    
    def __post_init__(self):
        if self.concepts_to_review is None:
            self.concepts_to_review = []
        if self.code_structure is None:
            self.code_structure = {}


class HybridTutor:
    """
    Gia sư AI kết hợp RAG (Qdrant) và phương pháp Socratic.
    
    Features:
    1. Truy xuất code mẫu tương tự từ Qdrant
    2. Phân tích AST để hiểu cấu trúc code
    3. Phân tích trong Sandbox để bắt lỗi runtime
    4. Sinh gợi ý theo phương pháp Socratic (đặt câu hỏi dẫn dắt)
    5. Hỗ trợ cả tiếng Việt và tiếng Anh
    """
    
    def __init__(self):
        self.qdrant = get_qdrant_tutor()
        self.analyzer = get_hybrid_analyzer()
        self._llm_client = None
    
    def _get_llm_client(self):
        """Lazy load Groq client"""
        if self._llm_client is None:
            try:
                self._llm_client = get_groq_client()
            except Exception as e:
                logger.error(f"Failed to initialize Groq client: {e}")
                self._llm_client = None
        return self._llm_client
    
    async def generate_feedback(
        self,
        student_code: str,
        problem_id: str,
        problem_description: str = "",
        hint_level: int = 1,
        previous_hints: Optional[List[str]] = None,
        language: str = "vi",
        run_sandbox: bool = False
    ) -> TutorFeedback:
        """
        Sinh phản hồi gia sư kết hợp RAG và Socratic method.
        Pipeline chuẩn: Preprocess -> Analyze -> Retrieve (Cluster+Re-rank) -> Prompt -> Output.
        """
        previous_hints = previous_hints or []

        # 0. Empty Code Check
        normalized_input = normalize_code(student_code)
        if not normalized_input or len(normalized_input.strip()) < 5:
             # Code quá ngắn hoặc rỗng -> Trả về feedback nhắc nhở ngay
             return TutorFeedback(
                syntax_valid=False,
                error_type="empty_code",
                error_message="Bạn chưa viết code hoặc code quá ngắn.",
                code_structure={},
                reference_code=None,
                reference_similarity=0.0,
                hint="Hãy bắt đầu bằng việc đọc kỹ đề bài và viết thử vài dòng code nhé! Đừng ngại sai.",
                hint_level=hint_level,
                concepts_to_review=[],
                confidence=1.0, # Tự tin là code rỗng
                strategy="heuristic"
            )

        try:
            # 1. Phân tích (AST + Loguc)
            analysis = self.analyzer.analyze_hybrid(student_code, run_sandbox=run_sandbox)

            # 2. Retrieval Unified Pipeline - Async Wrapper for Blocking Call
            # Gọi Qdrant để lấy code mẫu tốt nhất (đã qua lọc Clustering và Re-rank bằng Edit Distance)
            from starlette.concurrency import run_in_threadpool
            
            retrieved = await run_in_threadpool(
                self.qdrant.get_suggestions,
                student_code=student_code,
                problem_id=problem_id,
                strategy="unified", # Strategy unified: Cluster + Re-rank
                top_k=1
            )

            ref_code = retrieved[0].full_code if retrieved else None
            ref_similarity = retrieved[0].similarity if retrieved else 0.0
            algo_type = retrieved[0].algo_type if retrieved else "unknown"
            
            # Confidence logic
            confidence = self._calculate_confidence(analysis, ref_similarity)

            # 3. Kích hoạt LLM để sinh hint
            client = self._get_llm_client()
            
            # Nếu không có LLM client (hoặc lỗi config), fallback về template
            if not client:
                hint_text = self._generate_template_hint(analysis, hint_level, language)
                follow_up = self._generate_follow_up(analysis, language)
                return TutorFeedback(
                    syntax_valid=analysis.ast_analysis.valid_syntax,
                    error_type=analysis.error_type,
                    error_message=analysis.error_message,
                    error_line=analysis.error_line,
                    code_structure=self.analyzer.get_code_structure_summary(student_code),
                    reference_code=ref_code,
                    reference_similarity=ref_similarity,
                    hint=hint_text,
                    hint_level=hint_level,
                    follow_up_question=follow_up,
                    concepts_to_review=analysis.concepts_involved,
                    confidence=confidence,
                    strategy="template_fallback"
                )

            # Build JSON user payload theo spec (Unified)
            user_payload = {
                "student_code": normalize_code(student_code, rename_vars=True),
                "problem_statement": problem_description or "",
                "reference_code": ref_code,
                "reference_similarity": ref_similarity,
                "reference_algo_type": algo_type, 
                "error_type": analysis.error_type,
                "error_message": analysis.error_message,
                "concepts": analysis.concepts_involved,
                "hint_level": hint_level,
                "previous_hints": previous_hints,
                "constraints": "Do not give full solution code. Provide one next-step action."
            }

            # Tạo Unified System Prompt
            if language == "vi":
                system_prompt = (
                    "Trả lời bằng tiếng Việt.\n"
                    "Bạn là một Gia sư Python thông minh, sử dụng phương pháp Socratic kết hợp với code tham khảo từ hệ thống.\n\n"
                    "QUAN TRỌNG:\n"
                    "- KHÔNG cho đáp án trực tiếp hay viết code hoàn chỉnh thay sinh viên\n"
                    "- HÃY so sánh sự khác biệt giữa student_code và reference_code (code mẫu chuẩn) để tìm ra vấn đề\n"
                    "- Đặt câu hỏi dẫn dắt để sinh viên TỰ TÌM RA lỗi sai\n\n"
                    "Điều chỉnh mức độ gợi ý theo hint_level:\n"
                    "- Level 1-2: Hỏi về concept chung, không nhắc code mẫu\n"
                    "- Level 3-4: Gợi ý vị trí lỗi dựa trên sự khác biệt với code mẫu\n"
                    "- Level 5: Chỉ ra điểm sai cụ thể nhưng để sinh viên tự sửa\n\n"
                    "Trả về JSON hợp lệ: {\"hint\": \"...\", \"next_step\": \"...\"}"
                )
            else:
                system_prompt = (
                    "Respond in English.\n"
                    "You are an intelligent Socratic Python Tutor utilizing reference code.\n\n"
                    "IMPORTANT:\n"
                    "- DO NOT give direct answers or write complete code\n"
                    "- COMPARE student_code with reference_code to identify gaps\n"
                    "- Ask guiding questions to help students DISCOVER the solution\n\n"
                    "Adjust hint levels:\n"
                    "- Level 1-2: General conceptual questions\n"
                    "- Level 3-4: Hint at error location based on differences\n"
                    "- Level 5: Point out specific discrepancy but let student fix it\n\n"
                    "Return valid JSON: {\"hint\": \"...\", \"next_step\": \"...\"}"
                )
            
            # Logic gọi LLM (Async Wrapper)
            try:
                def call_groq():
                    return client.chat.completions.create(
                        model=os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant"),
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}
                        ],
                        max_tokens=1024,
                        temperature=0.0
                    )
                
                response = await run_in_threadpool(call_groq)
                
                response_text = response.choices[0].message.content.strip()

                # Parse JSON response
                try:
                    parsed = json.loads(response_text)
                    hint_text = parsed.get("hint", "").strip()
                    next_step = parsed.get("next_step", "").strip()
                except json.JSONDecodeError:
                    # Fallback parsing regex
                    json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                    if json_match:
                        try:
                            parsed = json.loads(json_match.group())
                            hint_text = parsed.get("hint", "").strip()
                            next_step = parsed.get("next_step", "").strip()
                        except json.JSONDecodeError:
                            hint_text = response_text.strip()
                            next_step = ""
                    else:
                        hint_text = response_text.strip()
                        next_step = ""

                if not hint_text:
                    hint_text = self._generate_template_hint(analysis, hint_level, language)

            except Exception as e:
                logger.error(f"LLM call failed: {e}")
                hint_text = self._generate_template_hint(analysis, hint_level, language)
                next_step = self._generate_follow_up(analysis, language)

            return TutorFeedback(
                syntax_valid=analysis.ast_analysis.valid_syntax,
                error_type=analysis.error_type,
                error_message=analysis.error_message,
                error_line=analysis.error_line,
                code_structure=self.analyzer.get_code_structure_summary(student_code),
                reference_code=ref_code if ref_code else None,
                reference_similarity=ref_similarity,
                hint=hint_text,
                hint_level=hint_level,
                follow_up_question=next_step,
                concepts_to_review=analysis.concepts_involved,
                confidence=confidence,
                strategy="unified_rag"
            )
            
            # Nếu không sử dụng LLM, sử dụng template hints
            hint_text = self._generate_template_hint(analysis, hint_level, language)
            follow_up = self._generate_follow_up(analysis, language)
            
            return TutorFeedback(
                syntax_valid=analysis.ast_analysis.valid_syntax,
                error_type=analysis.error_type,
                error_message=analysis.error_message,
                error_line=analysis.error_line,
                code_structure=self.analyzer.get_code_structure_summary(student_code),
                reference_code=ref_code,
                reference_similarity=ref_similarity,
                hint=hint_text,
                hint_level=hint_level,
                follow_up_question=follow_up,
                concepts_to_review=analysis.concepts_involved,
                confidence=confidence,
                strategy="template"
            )

        except Exception as e:
            logger.exception("Error generating feedback")
            return self._generate_fallback_feedback(hint_level, language)
    
    def _build_socratic_prompt(
        self,
        student_code: str,
        problem_description: str,
        analysis: HybridAnalysisResult,
        reference_code: Optional[str],
        hint_level: int,
        previous_hints: List[str],
        language: str
    ) -> str:
        # Giữ nguyên logic cũ cho phương thức helper này nếu còn dùng
        return "" 
    
    def _generate_from_llm(self, prompt: str, language: str, hint_level: int) -> str:
         # Helper cũ
         return ""

    def _generate_template_hint(
        self,
        analysis: Optional[HybridAnalysisResult],
        hint_level: int,
        language: str
    ) -> str:
        """Sinh hint từ template khi không dùng LLM"""
        
        templates = {
            "vi": {
                "syntax": {
                    1: "Có vẻ như có lỗi cú pháp trong code của bạn. Bạn đã kiểm tra lại cách viết chưa?",
                    2: "Hãy kiểm tra lại các dấu ngoặc, dấu hai chấm và thụt lề trong code.",
                    3: "Lỗi cú pháp thường xảy ra ở dấu ngoặc hoặc thụt lề. Xem lại dòng được báo lỗi.",
                    4: "Kiểm tra dòng có lỗi: có đủ dấu ngoặc đóng không? Thụt lề có đúng không?",
                    5: "Cú pháp Python yêu cầu: dấu hai chấm sau if/for/while/def, thụt lề 4 spaces."
                },
                "logic": {
                    1: "Kết quả có vẻ chưa đúng. Bạn đã thử với các trường hợp khác nhau chưa?",
                    2: "Hãy nghĩ về logic của thuật toán. Các điều kiện đã đầy đủ chưa?",
                    3: "Kiểm tra lại các điều kiện trong vòng lặp và câu lệnh if.",
                    4: "Chú ý đến giá trị biên. Vòng lặp bắt đầu và kết thúc đúng chỗ chưa?",
                    5: "Kiểm tra range(): range(n) cho 0 đến n-1, range(1, n+1) cho 1 đến n."
                },
                "runtime": {
                    1: "Code gặp lỗi khi chạy. Bạn đã kiểm tra các biến chưa?",
                    2: "Có biến nào đang được sử dụng mà chưa được tạo không?",
                    3: "Kiểm tra tên biến: có viết đúng không? Có tạo trước khi dùng không?",
                    4: "Lỗi NameError thường do biến chưa được gán giá trị hoặc viết sai tên.",
                    5: "Thêm dòng khởi tạo biến trước khi sử dụng."
                },
                "infinite_loop": {
                    1: "Code có vẻ chạy mãi. Vòng lặp của bạn có điểm dừng không?",
                    2: "Vòng lặp while cần có điều kiện dừng. Bạn đã kiểm tra chưa?",
                    3: "Biến điều kiện có được thay đổi trong vòng lặp không?",
                    4: "Với while True, cần có break hoặc return để thoát.",
                    5: "Thêm điều kiện if và break để thoát vòng lặp khi cần."
                },
                "none": {
                    1: "Code của bạn có vẻ OK. Hãy thử với nhiều test case hơn.",
                    2: "Kiểm tra lại logic với các trường hợp đặc biệt.",
                    3: "Xem xét các edge cases: list rỗng, số âm, số 0...",
                    4: "So sánh output với kết quả mong đợi.",
                    5: "Nếu bạn vẫn cần giúp, hãy mô tả vấn đề cụ thể hơn."
                }
            },
            "en": {
                "syntax": {
                    1: "There seems to be a syntax error. Have you checked your code structure?",
                    2: "Check your brackets, colons, and indentation.",
                    3: "Syntax errors often occur with brackets or indentation. Review the error line.",
                    4: "Check the error line: are brackets balanced? Is indentation correct?",
                    5: "Python syntax requires: colon after if/for/while/def, 4-space indentation."
                },
                "logic": {
                    1: "The result doesn't seem right. Have you tried different test cases?",
                    2: "Think about the algorithm logic. Are all conditions covered?",
                    3: "Review conditions in your loops and if statements.",
                    4: "Pay attention to boundary values. Does the loop start/end correctly?",
                    5: "Check range(): range(n) gives 0 to n-1, range(1, n+1) gives 1 to n."
                },
                "runtime": {
                    1: "The code encounters an error when running. Have you checked your variables?",
                    2: "Is there a variable being used before it's defined?",
                    3: "Check variable names: spelled correctly? Defined before use?",
                    4: "NameError usually means a variable wasn't assigned or is misspelled.",
                    5: "Add a line to initialize the variable before using it."
                },
                "infinite_loop": {
                    1: "The code seems to run forever. Does your loop have a stopping point?",
                    2: "While loops need a stopping condition. Have you checked?",
                    3: "Is the condition variable being modified inside the loop?",
                    4: "With while True, you need break or return to exit.",
                    5: "Add an if condition with break to exit the loop when needed."
                },
                "none": {
                    1: "Your code looks OK. Try testing with more test cases.",
                    2: "Review the logic with special cases.",
                    3: "Consider edge cases: empty list, negative numbers, zero...",
                    4: "Compare output with expected results.",
                    5: "If you still need help, describe your issue more specifically."
                }
            }
        }
        
        lang_templates = templates.get(language, templates["vi"])
        
        error_type = "none"
        if analysis:
            error_type = analysis.error_type or "none"
        
        type_templates = lang_templates.get(error_type, lang_templates["none"])
        
        return type_templates.get(hint_level, type_templates[1])
    
    def _generate_follow_up(
        self,
        analysis: HybridAnalysisResult,
        language: str
    ) -> str:
        """Tạo câu hỏi follow-up"""
        if language == "vi":
            if analysis.error_type == "syntax":
                return "Bạn có thể chỉ ra dòng nào có lỗi không?"
            elif analysis.error_type == "logic":
                return "Kết quả bạn mong đợi là gì? Kết quả thực tế là gì?"
            elif analysis.error_type == "runtime":
                return "Lỗi xảy ra ở dòng nào? Thông báo lỗi nói gì?"
            elif analysis.error_type == "infinite_loop":
                return "Điều kiện dừng của vòng lặp là gì?"
            else:
                return "Bạn có câu hỏi gì thêm không?"
        else:
            if analysis.error_type == "syntax":
                return "Can you identify which line has the error?"
            elif analysis.error_type == "logic":
                return "What output do you expect? What do you actually get?"
            elif analysis.error_type == "runtime":
                return "Which line causes the error? What does the error message say?"
            elif analysis.error_type == "infinite_loop":
                return "What is the stopping condition for your loop?"
            else:
                return "Do you have any other questions?"
    
    def _calculate_confidence(
        self,
        analysis: HybridAnalysisResult,
        ref_similarity: float
    ) -> float:
        """
        Tính độ tin cậy của gợi ý dựa trên mô hình Weighted Average (CodeBLEU simplified).
        Confidence = w1*Sim + w2*Structure + w3*StaticAnalysis
        """
        # 1. Similarity Score (0.0 - 1.0)
        s1_semantic = max(0.0, ref_similarity)

        # 2. Structural Score (Inverse Edit Distance)
        # Edit dist lấy từ kết quả RAG (được tính ngầm định) hoặc ước lượng
        # Do hàm này tách biệt, ta ước lượng thô hoặc mặc định nếu ko có info
        # Tuy nhiên, trong flow Unified mới, ta nên trust Similarity đã re-ranked
        # Để đơn giản và hiệu quả: Ta dùng giả định Similarity đã phản ánh 1 phần structure
        # Hoặc nếu ref_similarity > 0.8 thì boost lên.
        
        # Cập nhật: Hệ thống Unified đã re-rank bằng Edit Distance
        # Nên ref_similarity của Top-1 đã là "best match".
        # Ta dùng logic heuristic:
        
        # w1: Semantic + Structural (đại diện bởi ref_similarity)
        # w2: Analysis (đại diện bởi error detection)

        confidence = 0.0
        
        # Base confidence từ retrieval (chiếm 70%)
        # Similarity của Qdrant (Cosine) thường từ 0.0 -> 1.0
        confidence += s1_semantic * 0.7

        # Evaluation confidence (chiếm 30%)
        # Nếu bắt được lỗi cụ thể -> tin tưởng hơn
        if analysis.error_type != "none":
             confidence += 0.3
        else:
             confidence += 0.1 # Vẫn cộng 1 chút vì code không lỗi syntax cũng là 1 dạng info

        return min(0.98, confidence)

    
    def _generate_fallback_feedback(
        self,
        hint_level: int,
        language: str
    ) -> TutorFeedback:
        """Tạo feedback fallback khi có lỗi"""
        if language == "vi":
            hint = "Xin lỗi, mình gặp chút vấn đề. Bạn có thể thử lại không? 🙏"
        else:
            hint = "Sorry, I encountered an issue. Could you try again? 🙏"
        
        return TutorFeedback(
            syntax_valid=True,
            error_type="unknown",
            error_message="",
            hint=hint,
            hint_level=hint_level,
            confidence=0.3,
            strategy="fallback"
        )
    
    def add_to_knowledge_base(
        self,
        problem_id: str,
        code: str,
        user_uuid: Optional[str] = None,
        is_passed: bool = True
    ):
        """
        Thêm code vào knowledge base.
        """
        if is_passed and user_uuid:
            self.qdrant.add_submission(
                problem_id=problem_id, 
                code_content=code, 
                is_passed=True,
                user_uuid=str(user_uuid)
            )
        else:
            self.qdrant.add_dataset(problem_id=problem_id, code_content=code)


# Singleton instance
_hybrid_tutor: Optional[HybridTutor] = None


def get_hybrid_tutor() -> HybridTutor:
    """Lấy instance của HybridTutor"""
    global _hybrid_tutor
    if _hybrid_tutor is None:
        _hybrid_tutor = HybridTutor()
    return _hybrid_tutor
