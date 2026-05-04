import time
import logging
from typing import Callable, Any
import os
from functools import lru_cache

try:
    from groq import Groq
except Exception:
    Groq = None

logger = logging.getLogger(__name__)


def generate_with_backoff(callable_fn: Callable[[], Any], max_retries: int = 3, initial_delay: float = 1.0) -> Any:
    delay = initial_delay
    for attempt in range(1, max_retries + 1):
        try:
            return callable_fn()
        except Exception as e:
            logger.warning(f"LLM call attempt {attempt} failed: {e}")
            if attempt == max_retries:
                logger.error("LLM call failed after retries")
                raise
            time.sleep(delay)
            delay *= 2


def init_groq_client(api_key: str | None = None):
    if Groq is None:
        raise RuntimeError("groq package is not installed. Install with `pip install groq`")
    key = api_key or os.environ.get("GROQ_API_KEY")
    if not key:
        raise ValueError("GROQ_API_KEY not set in environment and no api_key provided")
    return Groq(api_key=key)


@lru_cache(maxsize=1)
def get_groq_client():
    """Singleton Groq client (per-process).

    Ghi chú (vi):
    - Init client nhiều lần thường không cần thiết và làm request đầu chậm hơn.
    - Cache theo process là đủ (uvicorn workers => mỗi worker có 1 client riêng).
    """
    return init_groq_client()


def create_groq_completion(client, messages, model: str = "openai/gpt-oss-20b", stream: bool = False, **kwargs):
    params = {"model": model, "messages": messages, "stream": stream}
    params.update(kwargs or {})
    return client.chat.completions.create(**params)


def extract_groq_content(response) -> str:
    try:
        # Ưu tiên access kiểu attribute vì qdrant/groq client có thể trả object
        choice = response.choices[0]
        # message.content có thể là str hoặc object/dict tuỳ version
        msg = getattr(choice, "message", None)
        if msg is not None:
            content = getattr(msg, "content", None)
            if content:
                if isinstance(content, str):
                    return content
                if isinstance(content, dict):
                    return content.get("text") or content.get("content") or ""

        # Một số SDK dùng field `text`
        text = getattr(choice, "text", None)
        if text:
            return text
    except Exception:
        pass

    try:
        # Fallback: access kiểu dict (tương thích nhiều phiên bản response)
        choice = response["choices"][0]
        msg = choice.get("message")
        if isinstance(msg, dict):
            c = msg.get("content")
            if isinstance(c, str):
                return c
            if isinstance(c, dict):
                return c.get("text") or c.get("content") or ""
        return choice.get("text", str(response))
    except Exception:
        return str(response)
