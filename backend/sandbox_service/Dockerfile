# Sử dụng Python 3.11 Alpine
FROM python:3.11-alpine

# Thư mục làm việc
WORKDIR /app

# Cài đặt các thư dependencies cần thiết
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy code vào
COPY app.py .

RUN adduser -D sandboxuser
USER sandboxuser

# Port mặc định
EXPOSE 8000

# Lệnh chạy
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
