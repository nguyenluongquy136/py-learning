import docker
import tempfile
import os
import time
import httpx
from typing import Optional, Dict, Any
import logging

# Lấy URL service sandbox từ biến môi trường (nếu có)
SANDBOX_SERVICE_URL = os.getenv("SANDBOX_SERVICE_URL")

logger = logging.getLogger(__name__)


class DockerManager:
    
    def __init__(self, image_name: str = "pytutor-sandbox:latest"):
        self.use_docker = False
        self.sandbox_url = SANDBOX_SERVICE_URL
        self.image_name = image_name
        
        # CASE 1: Ưu tiên dùng Sandbox Service riêng (Microservices pattern)
        if self.sandbox_url:
            logger.info(f"Using External Sandbox Service at: {self.sandbox_url}")
            return # Không cần init Docker client

        # CASE 2: Thử dùng Docker local (cho Local Dev / VPS)
        try:
            self.client = docker.from_env()
            self.client.ping() # Check connection
            self.use_docker = True
            logger.info("Docker daemon connected successfully. Using Docker for sandbox.")
            self._ensure_image()
        except Exception as e:
            logger.warning(f"Could not connect to Docker daemon: {e}")
            logger.warning("Falling back to internal execution (NOT SECURE for production if not isolated).")
            self.use_docker = False
    
    def _ensure_image(self):
        if not self.use_docker:
            return
        try:
            self.client.images.get(self.image_name)
            logger.info(f"Image {self.image_name} found")
        except docker.errors.ImageNotFound:
            logger.warning(f"Image {self.image_name} not found. In production, ensure image is pulled.")
    
    def cleanup_stale_containers(self):
        if not self.use_docker:
            return
        try:
            containers = self.client.containers.list(all=True, filters={"ancestor": self.image_name})
            for container in containers:
                try:
                    container.remove(force=True)
                except Exception:
                    pass
        except Exception:
            pass
    
    def run_code(self, code: str, timeout: int = 100, memory_limit: int = 512 * 1024 * 1024, stdin_input: Optional[str] = None) -> Dict[str, Any]:
        """
        Executes code via External Service OR Local Docker
        """
        # CASE 1: Dùng External HTTP Service
        if self.sandbox_url:
            return self._run_via_http_service(code, stdin_input)

        # CASE 2: Dùng Local Docker
        if self.use_docker:
            return self._run_via_docker(code, timeout, memory_limit, stdin_input)

        # CASE 3: Không có gì -> Trả lỗi
        return {
            "success": False,
            "output": "",
            "error": "No execution environment available (Docker missing & SANDBOX_SERVICE_URL not set).",
            "execution_time": 0,
            "resource_stats": {}
        }

    def _run_via_http_service(self, code: str, stdin_input: str) -> Dict[str, Any]:
        """Gọi sang Sandbox Service riêng"""
        start_time = time.time()
        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(
                    f"{self.sandbox_url}/run",
                    json={"code": code, "stdin": stdin_input or ""}
                )
                if resp.status_code != 200:
                    return {
                        "success": False, 
                        "error": f"Sandbox HTTP Error: {resp.status_code}", 
                        "output": ""
                    }
                
                data = resp.json()
                return {
                    "success": data["success"],
                    "output": data["stdout"],
                    "error": data["stderr"] if data["stderr"] else None,
                    "execution_time": time.time() - start_time,
                    "resource_stats": {}
                }
        except Exception as e:
            return {
                "success": False,
                "error": f"Connection to Sandbox Service failed: {str(e)}",
                "output": "",
                "execution_time": 0
            }

    def _run_via_docker(self, code: str, timeout: int, memory_limit: int, stdin_input: Optional[str]):
        container = None
        code_file = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
                f.write(code)
                code_file = f.name
            
            start_time = time.time()
            container = self.client.containers.run(
                self.image_name,
                ["/sandbox/code.py"],
                volumes={code_file: {"bind": "/sandbox/code.py", "mode": "ro"}},
                tty=False,
                cpu_period=100000,
                cpu_quota=10000,
                mem_limit=memory_limit,
                memswap_limit=memory_limit,
                network_disabled=True,
                stdin_open=True,
                detach=True,
                remove=False
            )
            
            if stdin_input:
                try:
                    decoded_input = stdin_input.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r')
                    if not decoded_input.endswith('\n'):
                        decoded_input += '\n'
                    sock = container.attach_socket(params={'stdin': 1, 'stream': 1})
                    sock_writer = getattr(sock, '_sock', sock)
                    sock_writer.sendall(decoded_input.encode('utf-8'))
                    sock.close()
                except Exception:
                    pass
            
            result = container.wait(timeout=timeout)
            execution_time = time.time() - start_time
            stdout = container.logs(stdout=True, stderr=False).decode('utf-8', errors='replace')
            stderr = container.logs(stdout=False, stderr=True).decode('utf-8', errors='replace')
            
            return {
                "success": result.get("StatusCode") == 0,
                "output": stdout,
                "error": stderr if stderr else None,
                "execution_time": execution_time,
                "resource_stats": {}
            }
        except Exception as e:
            if container: container.kill()
            return {"success": False, "error": str(e), "output": ""}
        finally:
            if container: 
                try: container.remove(force=True) 
                except: pass
            if code_file and os.path.exists(code_file): os.remove(code_file)

    def create_interactive_container(self, code: str, memory_limit: int = 512 * 1024 * 1024):
        if self.sandbox_url and not self.use_docker:
             raise RuntimeError("Interactive Terminal requires Docker (not available with HTTP Sandbox).")
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
            f.write(code)
            code_file = f.name

        container = self.client.containers.run(
            self.image_name,
            ["/sandbox/code.py"],
            volumes={code_file: {"bind": "/sandbox/code.py", "mode": "ro"}},
            tty=True,
            stdin_open=True,
            detach=True,
            network_disabled=True,
            mem_limit=memory_limit,
            remove=False
        )
        try:
            sock = container.attach_socket(params={'stdin': 1, 'stdout': 1, 'stderr': 1, 'stream': 1})
        except Exception:
            sock = None
        return container, sock, code_file
