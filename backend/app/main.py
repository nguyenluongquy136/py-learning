import logging
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from infra.services import DockerManager
from infra.services.scheduler import get_scheduler
from api.routers import (
    admin_router,
    ai_tutor_router,
    problems_router,
    submissions_router,
    system_router,
)
from .settings import APP_DESCRIPTION, APP_TITLE, APP_VERSION, CORS_ALLOW_ORIGINS, QDRANT_URL, WARMUP_AI_ON_STARTUP
from .auth import router as auth_router

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description=APP_DESCRIPTION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

docker_manager = DockerManager()


@app.on_event("startup")
async def startup_event():
    logger.info("Starting PyTutor AI Backend v3.0...")

    if QDRANT_URL:
        logger.info(f"Qdrant Cloud configured: {QDRANT_URL[:50]}...")
    else:
        logger.warning("QDRANT_URL not set - using in-memory storage")

    docker_manager.cleanup_stale_containers()

    # Initialize and start scheduler
    scheduler = get_scheduler()
    await scheduler.start()
    logger.info("Qdrant Scheduler started")

    # Khởi động trước các thành phần AI (warm-up) để giảm độ trễ cho request đầu tiên.
    if WARMUP_AI_ON_STARTUP:
        async def _warmup_ai():
            try:
                logger.info("AI warm-up: starting (qdrant/analyzer/tutor)...")
                from domain.ai import get_qdrant_tutor, get_hybrid_analyzer, get_hybrid_tutor

                # Chuyển tải khởi tạo nặng (SentenceTransformer import/load) đến thread.
                await asyncio.to_thread(get_qdrant_tutor)
                await asyncio.to_thread(get_hybrid_analyzer)
                await asyncio.to_thread(get_hybrid_tutor)
                logger.info("AI warm-up: completed")
            except Exception as e:
                logger.warning(f"AI warm-up failed (continuing without warm-up): {e}")

        asyncio.create_task(_warmup_ai())

    logger.info("Startup complete")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    scheduler = get_scheduler()
    await scheduler.stop()
    logger.info("Qdrant Scheduler stopped")


app.include_router(auth_router)
app.include_router(problems_router)
app.include_router(submissions_router)
app.include_router(ai_tutor_router)
app.include_router(admin_router)
app.include_router(system_router)


__all__ = ["app"]
