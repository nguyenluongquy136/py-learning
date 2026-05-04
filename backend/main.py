"""Compatibility shim.

The canonical ASGI app is now `app.main:app`.
This module remains so `uvicorn main:app` continues to work.
"""

from app.main import app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

