import os
import sys
import pty
import select
import subprocess
import fcntl
import termios
import asyncio
import signal
import json
import tempfile
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import multiprocessing
import io
import contextlib
import traceback

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CodeRequest(BaseModel):
    code: str
    stdin: str = ""

class ExecutionResult(BaseModel):
    stdout: str
    stderr: str
    success: bool
    error: str = ""

def execute_code_worker(code, stdin_input, result_queue):
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    if stdin_input:
        stdin_input = stdin_input.replace("\\n", "\n")
    stdin_capture = io.StringIO(stdin_input)
    success = False
    error_msg = None
    try:
        with contextlib.redirect_stdout(stdout_capture), contextlib.redirect_stderr(stderr_capture):
            sys.stdin = stdin_capture
            global_scope = {
                "__builtins__": __builtins__,
                "print": print, "input": input, "range": range, "len": len,
            }
            exec(code, global_scope)
            success = True
    except Exception:
        error_msg = traceback.format_exc()
        success = False
        stderr_capture.write(error_msg)
    finally:
        result_queue.put({
            "stdout": stdout_capture.getvalue(),
            "stderr": stderr_capture.getvalue(),
            "success": success,
            "error": error_msg
        })

@app.post("/run", response_model=ExecutionResult)
async def run_code(request: CodeRequest):
    queue = multiprocessing.Queue()
    process = multiprocessing.Process(target=execute_code_worker, args=(request.code, request.stdin, queue))
    process.start()
    process.join(5)
    if process.is_alive():
        process.terminate()
        process.join()
        return ExecutionResult(stdout="", stderr="Time Limit Exceeded", success=False, error="Timeout")
    if not queue.empty():
        result = queue.get()
        return ExecutionResult(stdout=result["stdout"], stderr=result["stderr"], success=result["success"], error=str(result["error"] or ""))
    return ExecutionResult(stdout="", stderr="Crash", success=False, error="Crash")


# WEBSOCKET TERMINAL

async def _forward_output(fd, websocket: WebSocket):
    """Đọc từ pty master fd và gửi qua websocket"""
    loop = asyncio.get_event_loop()
    max_read_bytes = 1024

    while True:
        try:
            # Chờ đến khi có dữ liệu từ fd
            r, _, _ = await loop.run_in_executor(None, lambda: select.select([fd], [], [], 1.0))
            if not r:
                await asyncio.sleep(0)
                continue

            data = await loop.run_in_executor(None, os.read, fd, max_read_bytes)
            if not data:
                raise Exception("EOF")
            await websocket.send_text(data.decode('utf-8', errors='replace'))
        except OSError:
            break
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error reading from pty: {e}")
            break

async def _monitor_process(p, websocket: WebSocket):
    """Theo dõi tiến trình và đóng websocket khi tiến trình kết thúc"""
    while True:
        await asyncio.sleep(0.5)
        if p.poll() is not None:
            try:
                await websocket.close()
            except Exception:
                pass
            break

@app.websocket("/terminal")
async def terminal_endpoint(websocket: WebSocket):
    await websocket.accept()

    master_fd = None
    slave_fd = None
    output_task = None
    monitor_task = None
    p = None
    code_file = None

    try:
        first_msg = await websocket.receive_text()
        start_obj = None
        try:
            parsed = json.loads(first_msg)
            if isinstance(parsed, dict) and parsed.get("type") == "start" and "code" in parsed:
                start_obj = parsed
        except Exception:
            start_obj = None

        # Tạo pseudo-terminal (pty)
        master_fd, slave_fd = pty.openpty()

        # Giữ TTY echo enabled để người dùng có thể thấy những gì đã nhập
        # Không thay đổi ECHO

        def _preexec_with_ctty():
            os.setsid()
            try:
                fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            except Exception:
                pass

        if start_obj is not None:
            # Run python trực tiếp với code được cung cấp
            code = start_obj.get("code", "")
            stdin_seed = start_obj.get("stdin", "")

            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
                f.write(code)
                code_file = f.name

            p = subprocess.Popen(
                ["python3", "-u", code_file],
                preexec_fn=_preexec_with_ctty,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                universal_newlines=True,
            )

            os.close(slave_fd)
            slave_fd = None

            output_task = asyncio.create_task(_forward_output(master_fd, websocket))
            monitor_task = asyncio.create_task(_monitor_process(p, websocket))

            # Seed stdin nếu có
            if stdin_seed:
                try:
                    if not stdin_seed.endswith("\n"):
                        stdin_seed += "\n"
                    os.write(master_fd, stdin_seed.encode("utf-8"))
                except Exception:
                    pass

            while True:
                data = await websocket.receive_text()
                try:
                    msg = json.loads(data)
                    if isinstance(msg, dict) and msg.get("type") == "input":
                        data = msg.get("data", "")
                except Exception:
                    pass
                if data:
                    os.write(master_fd, data.encode("utf-8"))

        else:
            # Fallback: interactive shell mode
            p = subprocess.Popen(
                ["/bin/sh"],
                preexec_fn=_preexec_with_ctty,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                universal_newlines=True,
            )

            os.close(slave_fd)
            slave_fd = None
            output_task = asyncio.create_task(_forward_output(master_fd, websocket))
            monitor_task = asyncio.create_task(_monitor_process(p, websocket))

            # Forward first message to shell
            try:
                if first_msg:
                    os.write(master_fd, first_msg.encode("utf-8"))
            except Exception:
                pass

            while True:
                data = await websocket.receive_text()
                os.write(master_fd, data.encode("utf-8"))

    except WebSocketDisconnect:
        logger.info("Websocket disconnected")
    except Exception as e:
        logger.error(f"Websocket error: {e}")
        if "EOF" in str(e):
            # Child process thoát, ngắt kết nối websocket
            if p is not None and p.poll() is None:
                try:
                    try:
                        os.killpg(os.getpgid(p.pid), signal.SIGTERM)
                    except Exception:
                        p.terminate()
                    p.wait(timeout=1)
                except Exception:
                    pass
            try:
                await websocket.close()
            except Exception:
                pass
    finally:
        logger.info("Cleaning up terminal session")
        if output_task is not None:
            try:
                output_task.cancel()
            except Exception:
                pass
        if monitor_task is not None:
            try:
                monitor_task.cancel()
            except Exception:
                pass
        if master_fd is not None:
            try:
                os.close(master_fd)
            except Exception:
                pass
        if slave_fd is not None:
            try:
                os.close(slave_fd)
            except Exception:
                pass
        if p is not None and p.poll() is None:
            try:
                try:
                    os.killpg(os.getpgid(p.pid), signal.SIGTERM)
                except Exception:
                    p.terminate()
                p.wait(timeout=3)
            except Exception:
                pass
        if code_file:
            try:
                if os.path.exists(code_file):
                    os.remove(code_file)
            except Exception:
                pass

@app.get("/")
async def root():
    return {"status": "ok", "service": "PyTutor Sandbox Service"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

