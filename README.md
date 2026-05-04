# PyTutor AI

Hệ thống học lập trình Python thông minh với AI Tutor: môi trường thực thi code an toàn (Docker sandbox), AI chat với RAG (Qdrant + Groq Llama 3.1), phân tích code thông minh, và hệ thống quản lý bài tập toàn diện.

## Kiến trúc

```
Frontend (React + TypeScript)
    ↓
Backend API (FastAPI + Clean Architecture)
    ↓
Docker Sandbox + Qdrant RAG + Groq LLM
```

## Bắt đầu nhanh

### Backend

```bash
cd backend
pip install -r requirements.txt
docker build -f Dockerfile.sandbox -t python-sandbox .
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend chạy tại `http://localhost:8000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend chạy tại `http://localhost:5173`

## Tính năng

✅ **Code Execution**: Docker sandbox cô lập, giới hạn CPU/RAM/timeout, không kết nối mạng  
✅ **AI Chat Tutor**: RAG với Qdrant vector DB, powered by Groq (Llama 3.1-8B-Instant)  
✅ **AI Hints**: Phân tích code thông minh, gợi ý cải thiện  
✅ **Monaco Editor**: VS Code editor với IntelliSense đầy đủ  
✅ **Terminal tương tác**: WebSocket terminal hỗ trợ `input()` real-time  
✅ **Test Cases**: Tự động chấm bài với test cases  
✅ **Dashboard**: Theo dõi tiến độ học tập, thống kê submissions  
✅ **Admin Panel**: Quản lý users, problems, test cases, Qdrant documents  
✅ **Clean Architecture**: api/domain/infra layers, dễ maintain và mở rộng

## API Endpoints

### Authentication & Users
- `POST /api/auth/login` - Đăng nhập
- `POST /api/auth/register` - Đăng ký
- `GET /api/auth/me` - Thông tin user hiện tại

### Problems & Submissions
- `GET /api/problems` - Danh sách bài tập
- `GET /api/problems/{id}` - Chi tiết bài tập
- `POST /api/submissions` - Nộp bài
- `GET /api/submissions` - Lịch sử nộp bài

### AI Tutor
- `POST /api/ai/chat` - Chat với AI tutor (RAG)
- `POST /api/ai/hint` - Xin gợi ý cho code
- `GET /api/ai/chat/history` - Lịch sử chat

### Admin
- `GET /api/admin/users` - Quản lý users
- `GET /api/admin/problems` - Quản lý problems
- `POST /api/admin/problems` - Tạo problem mới
- `PUT /api/admin/problems/{id}` - Cập nhật problem
- `DELETE /api/admin/problems/{id}` - Xóa problem
- `POST /api/admin/qdrant/import` - Import documents vào Qdrant
- `GET /api/admin/stats` - Thống kê hệ thống

### System
- `GET /health` - Health check
- `GET /api/config` - Sandbox config

## Biến môi trường

**Backend** (`backend/.env`):

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pytutor
# hoặc SQLite cho dev: sqlite:///./pytutor.db

# Authentication
SECRET_KEY=your-secret-key-change-in-production
JWT_ALGORITHM=HS256

# AI Services - Groq LLM
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.1-8b-instant

# Qdrant Vector Database (optional, dùng in-memory nếu không set)
QDRANT_URL=https://your-cluster.aws.cloud.qdrant.io:6333
QDRANT_API_KEY=your-qdrant-api-key

# CORS
CORS_ALLOW_ORIGINS=http://localhost:5173,http://localhost:3000

# Sandbox Settings
SANDBOX_IMAGE=python-sandbox
EXEC_TIMEOUT_SECONDS=10
EXEC_CPU_LIMIT_PERCENT=10
EXEC_MEMORY_LIMIT_MB=512
EXEC_NETWORK_ACCESS=false

# Features
ENABLE_WS_TERMINAL=true
WARMUP_AI_ON_STARTUP=false
```

**Frontend** (`frontend/.env`):

```env
VITE_API_URL=http://localhost:8000
```

## Cấu trúc thư mục

**Backend** (Clean Architecture):

```
backend/
├── api/routers/          # Controllers (admin, ai_tutor, problems, submissions, system)
├── domain/               # Business logic
│   ├── ai/              # AI services (hybrid_analyzer, hybrid_tutor, qdrant_tutor)
│   └── models/          # Domain models (User, Problem, Submission, etc.)
├── infra/               # Infrastructure
│   ├── analysis/        # Code execution & analysis
│   ├── services/        # Docker manager, scheduler
│   └── utils/           # LLM utils, helpers
├── app/                 # Application layer
│   ├── main.py         # FastAPI app
│   ├── settings.py     # Config
│   ├── db.py           # Database
│   └── auth.py         # JWT auth
└── sandbox_service/     # Standalone WebSocket sandbox
```

**Frontend**:

```
frontend/
├── App.tsx              # Main SPA + routing
├── components/          # React components
│   ├── AdminDashboard.tsx
│   ├── Login.tsx
│   ├── ProblemList.tsx
│   ├── CodeEditor.tsx
│   └── ...
├── services/api.ts      # API client
└── types.ts            # TypeScript types
```

## Database Models

- **User**: Authentication, roles (student/admin)
- **Problem**: Coding problems với metadata
- **ProblemType**: Categories
- **Submission**: Student submissions + results
- **TestCase**: Unit tests cho problems
- **QdrantSchedule**: Background import jobs

SQLAlchemy tự động tạo bảng khi backend start.

## Tech Stack

**Frontend**: React 19, TypeScript, Vite, Monaco Editor, Lucide Icons, Recharts, XTerm.js  
**Backend**: FastAPI, SQLAlchemy, PostgreSQL, Docker SDK, Groq API, Qdrant, SentenceTransformers  
**AI**: Groq (Llama 3.1-8B-Instant), Qdrant vector DB, RAG  
**DevOps**: Docker, Render, Vercel, Hugging Face Spaces

## Phát triển

```bash
# Backend dev server
cd backend
uvicorn app.main:app --reload

# Frontend dev server
cd frontend
npm run dev

# Build frontend for production
npm run build

# API docs
open http://localhost:8000/docs
```

## Deployment

**Backend**: Render (hoặc Railway, DigitalOcean)  
**Frontend**: Vercel (hoặc Netlify)  
**Sandbox Service**: Hugging Face Spaces  
**Database**: PostgreSQL (Render, Supabase, hoặc Neon)  
**Qdrant**: Qdrant Cloud (managed)

---

**Built with ❤️ for Python learners**
