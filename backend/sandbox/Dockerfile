FROM python:3.11-alpine

WORKDIR /sandbox

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

RUN pip install --no-cache-dir numpy pandas matplotlib

RUN addgroup -S sandbox && adduser -S sandbox -G sandbox

COPY sandbox/run_code.py /sandbox/run_code.py
RUN chmod +x /sandbox/run_code.py

USER sandbox

ENTRYPOINT ["python", "/sandbox/run_code.py"]
