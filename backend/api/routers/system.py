"""System/utility endpoints
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
import websockets
import httpx

from infra.services import DockerManager
from app.settings import (
	APP_VERSION,
	EXEC_ALLOWED_LIBRARIES,
	EXEC_CPU_LIMIT_PERCENT,
	EXEC_MEMORY_LIMIT_MB,
	EXEC_NETWORK_ACCESS,
	EXEC_TIMEOUT_SECONDS,
	ENABLE_WS_TERMINAL,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"])

# Docker manager instance
_docker_manager = DockerManager()


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@router.get("/health", response_model=HealthResponse)
async def health_check():
    return {"status": "healthy", "service": "PyTutor AI Backend", "version": APP_VERSION}

@router.get("/api/config")
async def get_config():
	return {
		"cpu_limit_percent": EXEC_CPU_LIMIT_PERCENT,
		"memory_limit_mb": EXEC_MEMORY_LIMIT_MB,
		"timeout_seconds": EXEC_TIMEOUT_SECONDS,
		"network_access": EXEC_NETWORK_ACCESS,
		"allowed_libraries": EXEC_ALLOWED_LIBRARIES,
		"enable_ws_terminal": ENABLE_WS_TERMINAL,
	}


@router.websocket("/ws/terminal")
async def websocket_terminal(websocket: WebSocket):
    if not ENABLE_WS_TERMINAL:
        await websocket.accept()
        await websocket.send_text("WebSocket terminal is disabled on this environment.")
        await websocket.close()
        return

    await websocket.accept()

    # CASE 1: PROXY MODE (Kết nối sang Sandbox Service)
    if _docker_manager.sandbox_url:
        # Derive WebSocket URL từ HTTP URL
        sandbox_base = _docker_manager.sandbox_url.strip()
        if sandbox_base.startswith("http://"):
            sandbox_ws_url = sandbox_base.replace("http://", "ws://", 1) + "/terminal"
        elif sandbox_base.startswith("https://"):
            sandbox_ws_url = sandbox_base.replace("https://", "wss://", 1) + "/terminal"
        else:
            # Assume https if no scheme
            sandbox_ws_url = f"wss://{sandbox_base}/terminal" if "://" not in sandbox_base else f"{sandbox_base}/terminal"
        
        logger.info(f"Proxying terminal websocket to sandbox: {sandbox_ws_url}")
        
        try:
            # Đợi message "start" từ client trước
            init_msg = await websocket.receive_text()
            try:
                obj = json.loads(init_msg)
                if obj.get("type") != "start" or "code" not in obj:
                    await websocket.send_text("ERROR: expected start message with code")
                    await websocket.close()
                    return
                code = obj["code"]
                interactive = bool(obj.get("interactive", True))
                stdin_input = obj.get("stdin", "")
            except Exception:
                await websocket.send_text("ERROR: invalid start message")
                await websocket.close()
                return

            # Non-interactive: call sandbox HTTP /run và forward kết quả, tránh mở shell
            if not interactive:
                try:
                    http_url = sandbox_base.rstrip('/') + '/run'
                    logger.debug(f"Calling sandbox HTTP /run at {http_url}")
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        resp = await client.post(http_url, json={"code": code, "stdin": stdin_input or ""})
                        if resp.status_code != 200:
                            await websocket.send_text(f"ERROR: Sandbox /run returned {resp.status_code}")
                        else:
                            data = resp.json()
                            # Gửi stdout, stderr và thông báo kết quả
                            if data.get("stdout"):
                                await websocket.send_text(data.get("stdout"))
                            if data.get("stderr"):
                                await websocket.send_text(data.get("stderr"))
                except Exception as e:
                    logger.error(f"Sandbox HTTP run error: {e}")
                    try:
                        await websocket.send_text(f"Connection to Sandbox Service failed: {e}")
                    except Exception:
                        pass
                finally:
                    try:
                        await websocket.close()
                    except Exception:
                        pass
                return
            
            # Kết nối đến sandbox service với timeout
            open_timeout = float(os.getenv("SANDBOX_WS_OPEN_TIMEOUT", "60"))
            logger.debug(f"Connecting to sandbox WebSocket with timeout={open_timeout}s")
            
            async with websockets.connect(
                sandbox_ws_url,
                open_timeout=open_timeout,
                close_timeout=10,
                ping_interval=20,
                ping_timeout=10,
            ) as sandbox_ws:
                # Gửi JSON start đến sandbox để chạy python trực tiếp
                await sandbox_ws.send(json.dumps({"type": "start", "code": code}))
                
                async def forward_client_to_sandbox():
                    try:
                        while True:
                            data = await websocket.receive_text()
                            # Parse nếu là JSON message (input từ client)
                            try:
                                msg = json.loads(data)
                                if msg.get("type") == "input":
                                    # Gửi input data sang sandbox (raw text)
                                    input_data = msg.get("data", "")
                                    await sandbox_ws.send(input_data)
                            except:
                                # Nếu không phải JSON, gửi thẳng
                                await sandbox_ws.send(data)
                    except Exception as e:
                        logger.debug(f"forward_client_to_sandbox error: {e}")

                async def forward_sandbox_to_client():
                    try:
                        while True:
                            data = await sandbox_ws.recv()
                            # Sandbox gửi về text/bytes, forward về client
                            if isinstance(data, bytes):
                                await websocket.send_text(data.decode('utf-8', errors='replace'))
                            else:
                                await websocket.send_text(data)
                    except Exception as e:
                        logger.debug(f"forward_sandbox_to_client error: {e}")

                # Chạy song song 2 luồng
                task1 = asyncio.create_task(forward_client_to_sandbox())
                task2 = asyncio.create_task(forward_sandbox_to_client())
                
                # Đợi 1 trong 2 luồng kết thúc (disconnect)
                done, pending = await asyncio.wait([task1, task2], return_when=asyncio.FIRST_COMPLETED)
                for t in pending: t.cancel()

        except Exception as e:
            logger.error(f"Proxy Terminal Error: {e}")
            try:
                await websocket.send_text(f"\r\nConnection to Sandbox Service failed: {e}\r\n")
                await websocket.close()
            except:
                pass
        return

    # CASE 2: DOCKER LOCAL MODE
    container = None
    sock = None
    code_file = None

    try:
        init_msg = await websocket.receive_text()
        try:
            obj = json.loads(init_msg)
            if obj.get("type") != "start" or "code" not in obj:
                await websocket.send_text("ERROR: expected start message with code")
                await websocket.close()
                return
            code = obj["code"]
        except Exception:
            await websocket.send_text("ERROR: invalid start message")
            await websocket.close()
            return

        from starlette.concurrency import run_in_threadpool
        container, sock, code_file = await run_in_threadpool(_docker_manager.create_interactive_container, code)
        if not sock:
            await websocket.send_text("ERROR: failed to attach to container")
            await websocket.close()
            return

        sock_reader = getattr(sock, "_sock", sock)
        # Dùng running loop để tránh warning/deprecation.
        loop = asyncio.get_running_loop()

        async def read_from_container():
            """Đọc output từ container và gửi về WebSocket."""
            try:
                while True:
                    data = await loop.run_in_executor(None, sock_reader.recv, 4096)
                    if not data:
                        break
                    text = data.decode("utf-8", errors="ignore") if isinstance(data, bytes) else str(data)
                    await websocket.send_text(text)
            except Exception:
                pass
            finally:
                try:
                    await websocket.close()
                except Exception:
                    pass

        async def read_from_websocket():
            """Đọc input từ WebSocket và gửi vào container."""
            try:
                while True:
                    msg = await websocket.receive_text()
                    if not msg:
                        continue

                    # Parse message (có thể là JSON {type: input, data: ...} hoặc raw text)
                    input_data = msg
                    try:
                        parsed = json.loads(msg)
                        if isinstance(parsed, dict) and parsed.get("type") == "input":
                            input_data = parsed.get("data", "")
                    except (json.JSONDecodeError, TypeError):
                        pass

                    if input_data:
                        try:
                            sock_writer = getattr(sock, "_sock", sock)
                            await loop.run_in_executor(None, sock_writer.sendall, input_data.encode("utf-8"))
                        except Exception:
                            pass
            except (WebSocketDisconnect, Exception):
                return

        reader_task = asyncio.create_task(read_from_container())
        ws_task = asyncio.create_task(read_from_websocket())

        done, pending = await asyncio.wait([reader_task, ws_task], return_when=asyncio.FIRST_COMPLETED)

        for t in pending:
            t.cancel()

    except WebSocketDisconnect:
        pass
    finally:
        # Cleanup resources
        if sock:
            try:
                sock.close()
            except Exception:
                pass

        if container:
            try:
                container.kill()
            except Exception:
                pass
            try:
                container.remove(force=True)
            except Exception:
                pass

        if code_file:
            try:
                if os.path.exists(code_file):
                    os.remove(code_file)
            except Exception:
                pass


__all__ = ["router"]
