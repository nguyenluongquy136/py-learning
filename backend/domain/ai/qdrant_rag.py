"""
Qdrant Cloud RAG Module - Vector DB và Embedding
Tích hợp với Qdrant Cloud để lưu trữ và truy xuất code mẫu + reference code
"""

from qdrant_client import QdrantClient
from qdrant_client.http import models
from infra.utils.normalize_code import normalize_code
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, field
import uuid
import os
import re
import logging
import ast

logger = logging.getLogger(__name__)

MAX_CHUNK_SIZE = 800
VECTOR_SIZE = 384


@dataclass
class RetrievedCode:
    """Kết quả truy xuất từ Qdrant"""
    id: str
    problem_id: str
    code: str
    similarity: float
    chunk_idx: int
    is_passed: bool = False
    user_uuid: str = ""
    total_chunks: int = 1
    full_code: str = ""
    algo_type: str = "unknown"
    metadata: Dict[str, Any] = field(default_factory=dict)


class QdrantTutor:
    """
    Hệ thống RAG sử dụng Qdrant Cloud.
    Quy trình xử lý 4 bước:
    1. Preprocessing (Normalization + AST cleaning)
    2. Embedding (CodeBERT/GraphCodeBERT or equivalent MiniLM)
    3. Storage (Vector DB + Metadata)
    4. Retrieval (Multi-strategy)
    """

    COLLECTION_SUBMISSIONS = "student_submissions"
    
    def __init__(self):
        """Khởi tạo Qdrant client và embedding model"""
        qdrant_url = os.environ.get("QDRANT_URL", "")
        qdrant_api_key = os.environ.get("QDRANT_API_KEY", "")
        
        if qdrant_url and qdrant_api_key:
            self.client = QdrantClient(
                url=qdrant_url,
                api_key=qdrant_api_key,
            )
            logger.info(f"Connected to Qdrant Cloud: {qdrant_url}")
        else:
            self.client = QdrantClient(":memory:")
            logger.warning("QDRANT_URL not set, using in-memory Qdrant")
        
        try:
            # Sử dụng all-MiniLM-L6-v2 như một giải pháp thay thế nhẹ cho CodeBERT
            # trong môi trường resource-constrained, nhưng vẫn đảm bảo semantic search tốt.
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer('all-MiniLM-L6-v2')
            self.vector_size = VECTOR_SIZE
            logger.info("Loaded embedding model: all-MiniLM-L6-v2 (CodeBERT alternative)")
        except Exception as e:
            logger.error(f"Failed to load embedding model: {e}")
            raise
        
        self._init_collection()
    
    def _init_collection(self):
        """Khởi tạo collection với các payload indexes cần thiết"""
        try:
            existing = [c.name for c in self.client.get_collections().collections]
            
            if self.COLLECTION_SUBMISSIONS not in existing:
                self.client.create_collection(
                    collection_name=self.COLLECTION_SUBMISSIONS,
                    vectors_config=models.VectorParams(
                        size=self.vector_size,
                        distance=models.Distance.COSINE
                    )
                )
                logger.info(f"Created collection: {self.COLLECTION_SUBMISSIONS}")
            
            # Tạo indexes cho filtering
            for field_name, field_type in [
                ("problem_id", models.PayloadSchemaType.KEYWORD),
                ("is_passed", models.PayloadSchemaType.BOOL),
                ("user_uuid", models.PayloadSchemaType.KEYWORD),
                ("algo_type", models.PayloadSchemaType.KEYWORD), # Support Clustering
            ]:
                try:
                    self.client.create_payload_index(
                        collection_name=self.COLLECTION_SUBMISSIONS,
                        field_name=field_name,
                        field_schema=field_type
                    )
                except Exception:
                    pass
                    
        except Exception as e:
            logger.error(f"Error initializing collection: {e}")
            raise
    
    def _analyze_algo_type(self, code: str) -> str:
        """
        Phân loại thuật toán (Clustering Strategy Support).
        Dựa vào AST để phát hiện: Recursive vs Iterative.
        """
        try:
            tree = ast.parse(code)
            is_recursive = False
            has_loops = False
            
            # Tìm tên hàm (nếu có) để check đệ quy
            func_names = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    func_names.add(node.name)
            
            for node in ast.walk(tree):
                # Check Iterative
                if isinstance(node, (ast.For, ast.While)):
                    has_loops = True
                
                # Check Recursive
                if isinstance(node, ast.Call):
                    if isinstance(node.func, ast.Name) and node.func.id in func_names:
                        is_recursive = True
            
            if is_recursive:
                return "recursive"
            if has_loops:
                return "iterative"
            return "sequential"
            
        except SyntaxError:
            return "unknown"

    def _chunk_code(self, code: str) -> List[str]:
        """
        Chia code thông minh.
        """
        # (Giữ nguyên logic cũ, chỉ thay đổi normalize nếu cần)
        # ... Implementation of chunking integrated below for brevity in editing ...
        chunks = []
        try:
            tree = ast.parse(code)
        except SyntaxError:
            for i in range(0, len(code), MAX_CHUNK_SIZE):
                chunks.append(code[i:i + MAX_CHUNK_SIZE])
            return [c for c in chunks if c.strip()]
        
        functions = []
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                func_code = ast.get_source_segment(code, node)
                if func_code:
                    functions.append(func_code.strip())
        
        if functions:
            for func_code in functions:
                if len(func_code) <= MAX_CHUNK_SIZE:
                    chunks.append(func_code)
                else:
                    lines = func_code.split('\n')
                    current_chunk = ''
                    for line in lines:
                        if len(current_chunk + '\n' + line) > MAX_CHUNK_SIZE:
                            if current_chunk: chunks.append(current_chunk.strip())
                            current_chunk = line
                        else:
                            current_chunk += '\n' + line if current_chunk else line
                    if current_chunk: chunks.append(current_chunk.strip())
            
            remaining = code
            for func in functions:
                remaining = remaining.replace(func, '', 1)
            remaining = remaining.strip()
            if remaining:
                chunks.append(remaining) # Simplify remaining handling
        else:
             for i in range(0, len(code), MAX_CHUNK_SIZE):
                chunks.append(code[i:i + MAX_CHUNK_SIZE])
        
        return [c for c in chunks if c.strip()]
    
    def add_submission(
        self,
        problem_id: str,
        code_content: str,
        is_passed: bool = False,
        user_uuid: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> List[str]:
        """
        Bước 3: Storage 
        Lưu vector với metadata phong phú để hỗ trợ Clustering và Repair.
        """
        # 1. Preprocessing
        normalized_content = normalize_code(code_content, remove_comments=True)
        algo_type = self._analyze_algo_type(normalized_content)

        chunks = self._chunk_code(normalized_content)
        total_chunks = len(chunks)
        
        points = []
        point_ids = []
        
        # 2. Embedding Loop
        for i, chunk in enumerate(chunks):
            point_id = str(uuid.uuid4())
            vector = self.model.encode(chunk).tolist()
            
            payload = {
                "problem_id": str(problem_id),
                "code": chunk,
                "chunk_idx": i,
                "total_chunks": total_chunks,
                "is_passed": is_passed,
                "user_uuid": user_uuid or "anonymous",
                "full_code": normalized_content,
                "algo_type": algo_type, # Metadata for Clustering
                **(metadata or {})
            }
            
            points.append(models.PointStruct(
                id=point_id,
                vector=vector,
                payload=payload
            ))
            point_ids.append(point_id)
        
        self.client.upsert(
            collection_name=self.COLLECTION_SUBMISSIONS,
            points=points
        )
        
        logger.info(f"Added {len(points)} chunks for problem {problem_id} (passed={is_passed}, algo={algo_type})")
        return point_ids
    
    def add_dataset(self, problem_id: str, code_content: str) -> List[str]:
        return self.add_submission(
            problem_id=problem_id,
            code_content=code_content,
            is_passed=True,
            user_uuid="system_dataset"
        )
    
    def get_suggestions(
        self, 
        student_code: str, 
        problem_id: str, 
        strategy: str = "rag",
        top_k: int = 3
    ) -> List[RetrievedCode]:
        """
        Lấy gợi ý code dựa trên chiến lược Unified hoặc Legacy.
        Unified: Auto-Clustering + Edit Distance Re-ranking.
        """
        # Chuẩn hóa code input
        query_vector = self.model.encode(normalize_code(student_code)).tolist()
        
        # 1. Build Filter
        must_conditions = [
            models.FieldCondition(
                key="problem_id",
                match=models.MatchValue(value=str(problem_id))
            ),
            models.FieldCondition(
                key="is_passed",
                match=models.MatchValue(value=True) # Chỉ học từ bài đúng
            )
        ]

        # Chiến lược Clustering / Unified: Chỉ tìm trong cùng cụm thuật toán
        # Unified = Auto Clustering
        if strategy in ["clustering", "unified"]:
            try:
                # Phân tích xem code sinh viên đang thuộc loại nào
                algo_type = self._analyze_algo_type(student_code)
                if algo_type != "unknown":
                     must_conditions.append(
                        models.FieldCondition(
                            key="algo_type",
                            match=models.MatchValue(value=algo_type)
                        )
                    )
            except Exception:
                pass # Fallback nếu lỗi parse

        search_filter = models.Filter(must=must_conditions)

        # 2. Retrieval 
        # Nếu strategy="repair" hoặc "unified", ta lấy pool rộng hơn để re-rank
        pool_size = top_k * 3 if strategy in ["repair", "rag", "unified"] else top_k
        
        try:
             results = self.client.query_points(
                collection_name=self.COLLECTION_SUBMISSIONS,
                query=query_vector,
                query_filter=search_filter,
                limit=pool_size
             ).points
        except Exception as e:
             logging.error(f"Retrieve failed: {e}")
             return []
        
        
        # Convert to RetrievedCode objects
        candidates = []
        for hit in results:
            candidates.append(RetrievedCode(
                id=str(hit.id),
                problem_id=hit.payload.get("problem_id", ""),
                code=hit.payload.get("code", ""),
                similarity=hit.score,
                chunk_idx=hit.payload.get("chunk_idx", 0),
                is_passed=hit.payload.get("is_passed", False),
                user_uuid=hit.payload.get("user_uuid", ""),
                total_chunks=hit.payload.get("total_chunks", 1),
                full_code=hit.payload.get("full_code", ""),
                algo_type=hit.payload.get("algo_type", "unknown"),
                metadata={}
            ))

        # 3. Re-ranking (Levenshtein Distance)
        # Chỉ áp dụng re-ranking nếu có kết quả và strategy cần độ chính xác cao
        if candidates and strategy in ["repair", "rag", "unified"]:
            try:
                import Levenshtein
                
                norm_student = normalize_code(student_code)
                
                for cand in candidates:
                    # So sánh với full_code của candidate (nếu có) hoặc chunk code
                    target_code = cand.full_code if cand.full_code else cand.code
                    norm_target = normalize_code(target_code)
                    
                    # Tính khoảng cách chỉnh sửa
                    dist = Levenshtein.distance(norm_student, norm_target)
                    
                    # Tính điểm Normalized (càng gần 0 càng tốt -> similarity càng cao)
                    # Similarity gốc (Cosine) thường từ 0.7 - 1.0
                    # Ta muốn kết hợp: Score = w1 * Cosine - w2 * Dist
                    # Hoặc đơn giản: Ưu tiên Edit Distance cho Repair
                    
                    cand.metadata["edit_distance"] = dist
                
                # Sort lại candidate
                if strategy == "repair":
                    # Repair ưu tiên sửa ít nhất -> Sort by Distance ASC
                    candidates.sort(key=lambda x: x.metadata.get("edit_distance", 9999))
                else: 
                    # Unified / RAG: Hybrid Score
                    # Hybrid = Sim - (Dist / 2000)
                    candidates.sort(key=lambda x: x.similarity - (x.metadata.get("edit_distance", 0) / 2000), reverse=True)

            except ImportError:
                logger.warning("python-Levenshtein not installed, skipping re-ranking")
        
        # Trả về top_k tốt nhất
        return candidates[:top_k]

    # ... keep other methods like get_collection_stats, delete_by_problem, etc if needed ...
    # Re-implementing simplified semantic_search to wrap get_suggestions
    def semantic_search(
        self,
        query: str,
        top_k: int = 5,
        problem_id: Optional[str] = None,
        only_passed: bool = False
    ) -> List[RetrievedCode]:
        # Legacy support wrapper
        processed = normalize_code(query)
        vec = self.model.encode(processed).tolist()
        conds = []
        if problem_id:
            conds.append(models.FieldCondition(key="problem_id", match=models.MatchValue(value=str(problem_id))))
        if only_passed:
            conds.append(models.FieldCondition(key="is_passed", match=models.MatchValue(value=True)))
        
        res = self.client.query_points(
            collection_name=self.COLLECTION_SUBMISSIONS,
            query=vec,
            query_filter=models.Filter(must=conds) if conds else None,
            limit=top_k
        ).points
        return [
            RetrievedCode(
                id=str(h.id), problem_id=h.payload.get("problem_id"), code=h.payload.get("code"),
                similarity=h.score, chunk_idx=h.payload.get("chunk_idx"), is_passed=h.payload.get("is_passed"),
                full_code=h.payload.get("full_code"), algo_type=h.payload.get("algo_type", "unknown")
            ) for h in res
        ]

    def get_collection_stats(self) -> Dict[str, Any]:
        """Lấy thống kê về collection"""
        try:
            info = self.client.get_collection(self.COLLECTION_SUBMISSIONS)
            points_count = getattr(info, "points_count", None)
            vectors_count = getattr(info, "vectors_count", None) # Attempt direct access
            
            if vectors_count is None: # Fallback strategies
                 vectors_count = getattr(info, "vectors", {}).get("vectors_count") if isinstance(getattr(info, "vectors", None), dict) else points_count

            return {
                self.COLLECTION_SUBMISSIONS: {
                    "points_count": points_count,
                    "vectors_count": vectors_count,
                    "status": getattr(info, "status", "unknown")
                }
            }
        except Exception as e:
            return {self.COLLECTION_SUBMISSIONS: {"error": str(e)}}
    
    def delete_by_problem(self, problem_id: str):
         try:
            self.client.delete(
                collection_name=self.COLLECTION_SUBMISSIONS,
                points_selector=models.FilterSelector(
                    filter=models.Filter(
                        must=[models.FieldCondition(key="problem_id", match=models.MatchValue(value=problem_id))]
                    )
                )
            )
            logger.info(f"Deleted all data for problem {problem_id}")
         except Exception as e:
            logger.error(f"Error deleting data: {e}")

# Singleton instance
_qdrant_tutor: Optional[QdrantTutor] = None

def get_qdrant_tutor() -> QdrantTutor:
    global _qdrant_tutor
    if _qdrant_tutor is None:
        _qdrant_tutor = QdrantTutor()
    return _qdrant_tutor
