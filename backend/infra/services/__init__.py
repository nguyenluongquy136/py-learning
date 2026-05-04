"""Core services package

Bao gồm các service chính:
- DockerManager: Quản lý container Docker cho việc thực thi code
"""
from .docker_manager import DockerManager

__all__ = [
    'DockerManager',
]
