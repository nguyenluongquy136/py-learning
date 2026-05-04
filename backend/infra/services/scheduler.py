"""
Scheduler Service - Background tasks for Qdrant chunking and maintenance.

Tính năng:
- Chia nhỏ submission thành các chunk và lưu vào Qdrant
- Scheduling với các khoảng thời gian định kỳ
- Bắt đầu schedule thủ công
- Theo dõi trạng thái của schedule
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from enum import Enum

from sqlalchemy.orm import Session
from app.db import SessionLocal
from domain.models import Submission, QdrantSchedule

logger = logging.getLogger(__name__)


class ScheduleStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ChunkingSchedule:
    id: str
    name: str
    status: ScheduleStatus = ScheduleStatus.PENDING
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    # Thời gian chạy schedule (nếu có)
    scheduled_at: Optional[datetime] = None
    
    # Configuration
    is_passed_only: bool = True
    problem_id: Optional[str] = None
    limit: int = 100
    
    # Results
    submissions_processed: int = 0
    points_created: int = 0
    error_message: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "scheduled_at": self.scheduled_at.isoformat() if self.scheduled_at else None,
            "is_passed_only": self.is_passed_only,
            "problem_id": self.problem_id,
            "limit": self.limit,
            "submissions_processed": self.submissions_processed,
            "points_created": self.points_created,
            "error_message": self.error_message
        }


class QdrantScheduler:
    """
    Background scheduler cho chunking submissions vào Qdrant.
    
    Schedules và config được lưu xuống DB.
    """
    
    def __init__(self):
        self.is_running = False
        self._task: Optional[asyncio.Task] = None
        
        # In-memory schedule tracking (for compatibility)
        self.schedules: Dict[str, ChunkingSchedule] = {}
        
        # Configuration
        self.auto_chunk_enabled = True
        self.auto_chunk_interval_hours = 6
        self.auto_chunk_limit = 500
        
        # Load config từ DB khi khởi tạo
        self._load_config_from_db()
    
    def _load_config_from_db(self):
        """Load scheduler config từ bảng system_config"""
        from sqlalchemy import text
        db = SessionLocal()
        try:
            rows = db.execute(text("""
                SELECT key, value FROM system_config
                WHERE key LIKE 'scheduler_%'
            """)).fetchall()
            
            for key, value in rows:
                if key == 'scheduler_auto_chunk_enabled':
                    self.auto_chunk_enabled = value.lower() == 'true'
                elif key == 'scheduler_auto_chunk_interval_hours':
                    self.auto_chunk_interval_hours = int(value)
                elif key == 'scheduler_auto_chunk_limit':
                    self.auto_chunk_limit = int(value)
            
            logger.info(f"Loaded scheduler config from DB: enabled={self.auto_chunk_enabled}, interval={self.auto_chunk_interval_hours}h, limit={self.auto_chunk_limit}")
        except Exception as e:
            logger.warning(f"Failed to load scheduler config from DB (using defaults): {e}")
        finally:
            db.close()
    
    def _save_config_to_db(self):
        """Save scheduler config vào bảng system_config"""
        from sqlalchemy import text
        db = SessionLocal()
        try:
            db.execute(text("""
                INSERT INTO system_config (key, value, updated_at) VALUES
                    ('scheduler_auto_chunk_enabled', :enabled, CURRENT_TIMESTAMP),
                    ('scheduler_auto_chunk_interval_hours', :interval, CURRENT_TIMESTAMP),
                    ('scheduler_auto_chunk_limit', :limit, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value,
                    updated_at = CURRENT_TIMESTAMP
            """), {
                "enabled": str(self.auto_chunk_enabled).lower(),
                "interval": str(self.auto_chunk_interval_hours),
                "limit": str(self.auto_chunk_limit)
            })
            db.commit()
            logger.info(f"Saved scheduler config to DB")
        except Exception as e:
            logger.error(f"Failed to save scheduler config to DB: {e}")
            db.rollback()
        finally:
            db.close()
        
    async def start(self):
        """Bắt đầu scheduler"""
        if self.is_running:
            logger.warning("Scheduler already running")
            return
        
        # Reload config từ DB
        self._load_config_from_db()
        
        # Load pending schedules from DB
        await self._load_schedules_from_db()
        
        self.is_running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Qdrant Scheduler started")
    
    async def _load_schedules_from_db(self):
        """Load pending/running schedules từ DB vào memory"""
        db = SessionLocal()
        try:
            schedules_db = db.query(QdrantSchedule).filter(
                QdrantSchedule.status.in_(["pending", "running"])
            ).all()
            
            for schedule_db in schedules_db:
                schedule_obj = ChunkingSchedule(
                    id=schedule_db.id,
                    name=schedule_db.name,
                    status=ScheduleStatus(schedule_db.status),
                    created_at=schedule_db.created_at,
                    started_at=schedule_db.started_at,
                    completed_at=schedule_db.completed_at,
                    scheduled_at=schedule_db.scheduled_at,
                    is_passed_only=schedule_db.is_passed_only,
                    problem_id=schedule_db.problem_id,
                    limit=schedule_db.limit_count
                )
                self.schedules[schedule_db.id] = schedule_obj
                
            logger.info(f"Loaded {len(schedules_db)} schedules from DB")
        finally:
            db.close()
    
    async def stop(self):
        """Dừng lịch trình"""
        self.is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.warning(f"Scheduler stop: task ended with error: {e}")
        logger.info("Qdrant Scheduler stopped")
    
    async def _run_loop(self):
        """Lặp lại lịch trình"""
        last_auto_chunk = datetime.utcnow()
        
        while self.is_running:
            try:
                # Kiểm tra nếu đã đến thời gian chạy auto-chunk
                if self.auto_chunk_enabled:
                    elapsed = (datetime.utcnow() - last_auto_chunk).total_seconds() / 3600
                    if elapsed >= self.auto_chunk_interval_hours:
                        logger.info(f"Running auto-chunk (interval: {self.auto_chunk_interval_hours}h)")
                        await self.schedule_auto_chunk()
                        last_auto_chunk = datetime.utcnow()
                
                # Xử lý lịch trình chờ
                await self._process_pending_schedules()
                
                # Tạm dừng 1 phút trước khi kiểm tra lại
                await asyncio.sleep(60)
                
            except Exception as e:
                logger.error(f"Scheduler loop error: {e}")
                await asyncio.sleep(60)
    
    async def _process_pending_schedules(self):
        """Xử lý tất cả các lịch trình chờ có thời gian chạy đã đến (từ DB)."""
        now = datetime.utcnow()
        db = SessionLocal()
        try:
            pending_schedules = db.query(QdrantSchedule).filter(
                QdrantSchedule.status == "pending",
                (QdrantSchedule.scheduled_at.is_(None) | (QdrantSchedule.scheduled_at <= now))
            ).all()

            for schedule_db in pending_schedules:
                try:
                    await self._execute_schedule_db(schedule_db, db)
                except Exception as e:
                    logger.error(f"Schedule {schedule_db.id} failed: {e}")
                    schedule_db.status = "failed"
                    schedule_db.error_message = str(e)
                    schedule_db.completed_at = datetime.utcnow()
                    db.commit()
        finally:
            db.close()
    
    async def _execute_schedule_db(self, schedule_db: QdrantSchedule, db: Session):
        """Thực thi một lịch trình chunking từ DB"""
        schedule_db.status = "running"
        schedule_db.started_at = datetime.utcnow()
        db.commit()
        
        # Cập nhật trạng thái trong bộ nhớ
        if schedule_db.id in self.schedules:
            self.schedules[schedule_db.id].status = ScheduleStatus.RUNNING
            self.schedules[schedule_db.id].started_at = schedule_db.started_at
        
        logger.info(f"Executing schedule {schedule_db.id}: {schedule_db.name}")
        
        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, self._chunk_submissions_sync, schedule_db)
            
            schedule_db.submissions_processed = result["submissions_processed"]
            schedule_db.points_created = result["points_created"]
            schedule_db.status = "completed"
            schedule_db.completed_at = datetime.utcnow()
            db.commit()
            
            # Cập nhật trạng thái trong bộ nhớ
            if schedule_db.id in self.schedules:
                self.schedules[schedule_db.id].status = ScheduleStatus.COMPLETED
                self.schedules[schedule_db.id].completed_at = schedule_db.completed_at
            
            logger.info(f"Schedule {schedule_db.id} completed: {schedule_db.submissions_processed} submissions, {schedule_db.points_created} points")
            
        except Exception as e:
            logger.error(f"Schedule {schedule_db.id} failed: {e}")
            schedule_db.status = "failed"
            schedule_db.error_message = str(e)
            schedule_db.completed_at = datetime.utcnow()
            db.commit()
            
            # Cập nhật trạng thái trong bộ nhớ
            if schedule_db.id in self.schedules:
                self.schedules[schedule_db.id].status = ScheduleStatus.FAILED
                self.schedules[schedule_db.id].completed_at = schedule_db.completed_at
    
    def _chunk_submissions_sync(self, schedule: QdrantSchedule) -> Dict[str, int]:
        """Thực hiện chunking các submission"""
        db = SessionLocal()
        try:
            from domain.ai import get_qdrant_tutor

            qdrant = get_qdrant_tutor()
            
            # Build query
            query = db.query(Submission)
            
            if schedule.is_passed_only:
                query = query.filter(Submission.passed_all.is_(True))
            
            if schedule.problem_id:
                query = query.filter(Submission.problem_id == int(schedule.problem_id))
            
            query = query.filter(Submission.is_chunked.is_(False))
            
            query = query.order_by(Submission.submitted_at.desc())
            
            submissions = query.limit(schedule.limit_count).all()
            
            submissions_processed = 0
            points_created = 0
            
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
                    submissions_processed += 1
                    points_created += len(point_ids)
                    
                    submission.is_chunked = True
                    db.commit()
                    
                except Exception as e:
                    logger.error(f"Failed to chunk submission {submission.id}: {e}")
                    continue
            
            return {
                "submissions_processed": submissions_processed,
                "points_created": points_created
            }
            
        finally:
            db.close()
    
    def schedule_schedule(
        self,
        name: str,
        is_passed_only: bool = True,
        problem_id: Optional[str] = None,
        limit: int = 100,
        scheduled_at: Optional[datetime] = None,
    ) -> str:
        """Lịch trình chunking và lưu xuống DB"""
        schedule_id = f"schedule_{int(datetime.utcnow().timestamp() * 1000)}"
        
        db = SessionLocal()
        try:
            schedule_db = QdrantSchedule(
                id=schedule_id,
                name=name,
                is_passed_only=is_passed_only,
                problem_id=problem_id,
                limit_count=limit,
                scheduled_at=scheduled_at
            )
            db.add(schedule_db)
            db.commit()
            
            schedule_obj = ChunkingSchedule(
                id=schedule_id,
                name=name,
                is_passed_only=is_passed_only,
                problem_id=problem_id,
                limit=limit,
                scheduled_at=scheduled_at
            )
            self.schedules[schedule_id] = schedule_obj
        finally:
            db.close()
        
        logger.info(f"Scheduled schedule {schedule_id}: {name}")
        
        return schedule_id
    
    async def schedule_auto_chunk(self) -> str:
        """Lịch trình chunking tự động"""
        return self.schedule_schedule(
            name=f"Auto-chunk ({datetime.utcnow().strftime('%Y-%m-%d %H:%M')})",
            is_passed_only=True,
            limit=self.auto_chunk_limit
        )
    
    def _schedule_from_db(self, row: QdrantSchedule) -> ChunkingSchedule:
        """Chuyển đổi record DB -> object schedule dùng cho API."""
        try:
            st = ScheduleStatus(row.status)
        except Exception:
            st = ScheduleStatus.PENDING

        return ChunkingSchedule(
            id=row.id,
            name=row.name,
            status=st,
            created_at=row.created_at,
            started_at=row.started_at,
            completed_at=row.completed_at,
            scheduled_at=row.scheduled_at,
            is_passed_only=row.is_passed_only,
            problem_id=row.problem_id,
            limit=row.limit_count,
            submissions_processed=row.submissions_processed,
            points_created=row.points_created,
            error_message=row.error_message,
        )
    
    def update_config(
        self,
        auto_chunk_enabled: Optional[bool] = None,
        auto_chunk_interval_hours: Optional[int] = None,
        auto_chunk_limit: Optional[int] = None
    ):
        """Update scheduler configuration và lưu vào DB"""
        if auto_chunk_enabled is not None:
            self.auto_chunk_enabled = auto_chunk_enabled
        if auto_chunk_interval_hours is not None:
            self.auto_chunk_interval_hours = auto_chunk_interval_hours
        if auto_chunk_limit is not None:
            self.auto_chunk_limit = auto_chunk_limit
        
        # Persist to DB
        self._save_config_to_db()
        
        logger.info(f"Scheduler config updated: enabled={self.auto_chunk_enabled}, interval={self.auto_chunk_interval_hours}h, limit={self.auto_chunk_limit}")
    
    def get_recent_schedules(self, limit: int = 20) -> List[ChunkingSchedule]:
        """Lấy các schedule gần đây từ DB (phục vụ admin UI)."""
        db = SessionLocal()
        try:
            rows = (
                db.query(QdrantSchedule)
                .order_by(QdrantSchedule.created_at.desc())
                .limit(limit)
                .all()
            )
            out: List[ChunkingSchedule] = []
            for r in rows:
                s = self._schedule_from_db(r)
                # cache in-memory để `/scheduler/config` có số liệu gần đúng
                self.schedules.setdefault(s.id, s)
                out.append(s)
            return out
        finally:
            db.close()
    
    def get_schedule(self, schedule_id: str) -> Optional[ChunkingSchedule]:
        """Lấy 1 schedule theo id từ DB."""
        db = SessionLocal()
        try:
            row = db.query(QdrantSchedule).filter(QdrantSchedule.id == schedule_id).first()
            if not row:
                return None
            s = self._schedule_from_db(row)
            self.schedules[s.id] = s
            return s
        finally:
            db.close()
    
    def cancel_schedule(self, schedule_id: str) -> Dict[str, Any]:
        """Hủy một schedule đang pending."""
        db = SessionLocal()
        try:
            row = db.query(QdrantSchedule).filter(QdrantSchedule.id == schedule_id).first()
            if not row:
                return {"success": False, "error": "Schedule not found"}
            
            # Chỉ cho phép hủy schedule pending
            if row.status != "pending":
                return {"success": False, "error": f"Cannot cancel schedule with status '{row.status}'. Only pending schedules can be cancelled."}
            
            # Cập nhật status thành cancelled
            row.status = "failed"
            row.error_message = "Cancelled by admin"
            row.completed_at = datetime.utcnow()
            db.commit()
            
            # Xóa khỏi cache in-memory
            if schedule_id in self.schedules:
                self.schedules[schedule_id].status = ScheduleStatus.FAILED
                self.schedules[schedule_id].error_message = "Cancelled by admin"
            
            logger.info(f"Schedule {schedule_id} cancelled")
            return {"success": True}
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to cancel schedule {schedule_id}: {e}")
            return {"success": False, "error": str(e)}
        finally:
            db.close()
    
    def clear_old_schedules(self, keep_days: int = 7):
        """Xoá schedule completed/failed quá hạn khỏi DB + dọn cache in-memory."""
        cutoff = datetime.utcnow() - timedelta(days=keep_days)
        db = SessionLocal()
        try:
            deleted = db.query(QdrantSchedule).filter(
                QdrantSchedule.created_at < cutoff,
                QdrantSchedule.status.in_(["completed", "failed"])
            ).delete()
            db.commit()
            logger.info(f"Cleared {deleted} old schedules from DB")
        finally:
            db.close()

        # Dọn cache in-memory (không bắt buộc nhưng giúp giảm memory leak khi chạy lâu)
        to_delete = [
            sid
            for sid, s in list(self.schedules.items())
            if s.created_at < cutoff and s.status in (ScheduleStatus.COMPLETED, ScheduleStatus.FAILED)
        ]
        for sid in to_delete:
            self.schedules.pop(sid, None)
    
    def get_config(self) -> Dict[str, Any]:
        """Lấy config hiện tại"""
        return {
            "auto_chunk_enabled": self.auto_chunk_enabled,
            "auto_chunk_interval_hours": self.auto_chunk_interval_hours,
            "auto_chunk_limit": self.auto_chunk_limit,
            "is_running": self.is_running,
            "total_schedules": len(self.schedules),
            "pending_schedules": sum(1 for j in self.schedules.values() if j.status == ScheduleStatus.PENDING),
            "running_schedules": sum(1 for j in self.schedules.values() if j.status == ScheduleStatus.RUNNING)
        }


# Global scheduler instance
_scheduler: Optional[QdrantScheduler] = None


def get_scheduler() -> QdrantScheduler:
    """Get global scheduler instance"""
    global _scheduler
    if _scheduler is None:
        _scheduler = QdrantScheduler()
    return _scheduler
