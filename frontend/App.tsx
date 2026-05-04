import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Play, Layout, Map, Settings as SettingsIcon, Code, BrainCircuit, TestTube, MessageCircle, X, ChevronDown, ChevronUp, FileText, Maximize2, Minimize2, Lightbulb, TrendingUp, GitBranch, Shield, CheckCircle, ThumbsUp, ThumbsDown, ChevronRight as NextIcon, MessageSquare } from 'lucide-react';
import SimpleEditor from './components/Editor';
import Terminal from './components/Terminal';
import TutorChat from './components/TutorChat';
import KnowledgeDashboard from './components/KnowledgeDashboard';
import LearningMap from './components/LearningMap';
import Settings from './components/Settings';
import HintPanel from './components/HintPanel';
import CodeVisualization from './components/CodeVisualization';
import ProgressTracker from './components/ProgressTracker';
import MarkdownRenderer from './components/MarkdownRenderer';
import { UserMastery, LearningNode, TabView } from './types';
import ProblemList, { ProblemSummary } from './components/ProblemList';
import Auth from './components/Auth';
import { endLearningSession, getLearningPath, getLearningReport, getMastery, getProblem, startLearningSession, submitHintFeedback, submitProblem, getWebSocketUrl } from './services/api';
import AdminDashboard from './components/AdminDashboard';
import ProblemManager from './components/ProblemManager';
import UserManager from './components/UserManager';
import SubmissionManager from './components/SubmissionManager';
import MySubmissions from './components/MySubmissions';
import QdrantScheduler from './components/QdrantScheduler';
import ProblemTypeManager from './components/ProblemTypeManager';

type Theme = 'dark' | 'light';
type AdminView = 'dashboard' | 'users' | 'problems' | 'problem-types' | 'submissions' | 'scheduler';

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('token'));
  const [isAdmin, setIsAdmin] = useState(() => {
    const token = localStorage.getItem('token');
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.is_admin === 1 || payload.is_admin === true;
    } catch {
      return false;
    }
  });
  const [activeTab, setActiveTab] = useState<TabView>(isLoggedIn ? TabView.EDITOR : TabView.AUTH);
  const [adminView, setAdminView] = useState<AdminView | null>(null);
  const [code, setCode] = useState<string>("# Write your Python code here\n\n");
  const [isRunning, setIsRunning] = useState(false);
  const [runTrigger, setRunTrigger] = useState(0);

  const [currentProblem, setCurrentProblem] = useState<ProblemSummary | null>(null);
  const [problemsRefreshTrigger, setProblemsRefreshTrigger] = useState(0);
  const [testResults, setTestResults] = useState<any[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [lastNonSettingsPath, setLastNonSettingsPath] = useState<string>('/editor');
  const [lastNonMySubmissionsPath, setLastNonMySubmissionsPath] = useState<string>('/editor');
  const [testError, setTestError] = useState<string | null>(null);
  const [testHint, setTestHint] = useState<any>(null);
  const [testHintFeedback, setTestHintFeedback] = useState<'up' | 'down' | null>(null);
  const [isSubmittingTestHintFeedback, setIsSubmittingTestHintFeedback] = useState(false);
  const [currentHintLevel, setCurrentHintLevel] = useState(1);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showProblemListPanel, setShowProblemListPanel] = useState(true);
  const [isHintPanelOpen, setIsHintPanelOpen] = useState(false);
  const [showVisualization, setShowVisualization] = useState(false);
  const [visualizationType, setVisualizationType] = useState<'ast' | 'cfg' | 'dfg'>('cfg');
  const [lastNonProgressPath, setLastNonProgressPath] = useState<string>('/editor');
  const [bottomTab, setBottomTab] = useState<'terminal' | 'tests'>(() => {
    const v = localStorage.getItem('bottomTab');
    return v === 'tests' ? 'tests' : 'terminal';
  });
  const [bottomSplit, setBottomSplit] = useState<boolean>(() => {
    return localStorage.getItem('bottomSplit') === 'true';
  });
  const [leftTab, setLeftTab] = useState<'list' | 'desc'>('list');

  // Tự động chuyển sang tab mô tả khi chọn bài toán
  useEffect(() => {
    if (currentProblem) {
      setLeftTab('desc');
    } else {
      setLeftTab('list');
    }
  }, [currentProblem?.id]);

  const [showTerminal, setShowTerminal] = useState<boolean>(() => {
    const s = localStorage.getItem('showTerminal');
    return s === null ? true : s === 'true';
  });
  const [terminalExpanded, setTerminalExpanded] = useState<boolean>(() => {
    const v = localStorage.getItem('terminalExpanded');
    return v === 'true';
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });
  const [language, setLanguage] = useState<'en' | 'vi'>(() => {
    const saved = localStorage.getItem('language');
    return saved === 'en' ? 'en' : 'vi';
  });

  const [problemLoadError, setProblemLoadError] = useState<string | null>(null);
  const [isProblemLoading, setIsProblemLoading] = useState(false);

  // Theo dõi thời gian giải bài qua các sessions
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [activeSessionProblemId, setActiveSessionProblemId] = useState<number | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  const resetUserScopedState = useCallback(() => {
    setCode("# Write your Python code here\n\n");
    setCurrentProblem(null);
    setTestResults([]);
    setIsTesting(false);
    setTestError(null);
    setTestHint(null);
    setCurrentHintLevel(1);
    setProblemLoadError(null);
    setIsProblemLoading(false);
    setIsChatOpen(false);
    setIsHintPanelOpen(false);
    setShowVisualization(false);
    setIsRunning(false);
    setActiveSessionId(null);
    setActiveSessionProblemId(null);
  }, []);

  const handleLogout = useCallback(() => {
    const token = localStorage.getItem('token') || undefined;

    // Đóng sessions hiện tại trước khi đăng xuất
    if (token && activeSessionId) {
      endLearningSession(activeSessionId, 'abandoned', token).catch(() => { });
    }

    localStorage.removeItem('token');
    localStorage.removeItem('username');

    setIsLoggedIn(false);
    setIsAdmin(false);
    setAdminView(null);
    resetUserScopedState();
    navigate('/login', { replace: true });
  }, [activeSessionId, navigate, resetUserScopedState]);

  const pathname = useMemo(() => {
    // Chuẩn hóa dấu gạch chéo cuối: "/login/" => "/login" (giữ nguyên "/")
    const p = location.pathname.replace(/\/+$/, '');
    return p.length === 0 ? '/' : p;
  }, [location.pathname]);

  const tabFromPathname = useCallback((p: string): TabView => {
    if (p === '/login') return TabView.AUTH;
    if (p === '/path') return TabView.PATH;
    if (p === '/dashboard') return TabView.DASHBOARD;
    // Các route "/editor", "/problems*", "/problem*", "/admin/*", "/" quay về giao diện chính
    return TabView.EDITOR;
  }, []);

  const adminViewFromPathname = useCallback((p: string): AdminView => {
    if (p === '/admin' || p === '/admin/') return 'dashboard';
    if (p.startsWith('/admin/users')) return 'users';
    if (p.startsWith('/admin/problems')) return 'problems';
    if (p.startsWith('/admin/problem-types')) return 'problem-types';
    if (p.startsWith('/admin/submissions')) return 'submissions';
    if (p.startsWith('/admin/scheduler')) return 'scheduler';
    return 'dashboard';
  }, []);

  const pathForAdminView = useCallback((view: AdminView): string => {
    switch (view) {
      case 'dashboard': return '/admin';
      case 'users': return '/admin/users';
      case 'problems': return '/admin/problems';
      case 'problem-types': return '/admin/problem-types';
      case 'submissions': return '/admin/submissions';
      case 'scheduler': return '/admin/scheduler';
      default: return '/admin';
    }
  }, []);

  const parseProblemIdFromPath = useCallback((p: string): number | null => {
    // Hỗ trợ cả "/problem/:id" (giải bài) và "/problems/:id" (duyệt + chi tiết)
    const m1 = p.match(/^\/problem\/(\d+)$/);
    if (m1) return Number(m1[1]);
    const m2 = p.match(/^\/problems\/(\d+)$/);
    if (m2) return Number(m2[1]);
    return null;
  }, []);

  const isProblemsSectionPath = useCallback((p: string): boolean => {
    return p === '/problems' || /^\/problems\/\d+$/.test(p);
  }, []);

  const isProgressPath = useCallback((p: string): boolean => {
    return p === '/progress';
  }, []);

  const isSettingsPath = useCallback((p: string): boolean => {
    return p === '/settings';
  }, []);

  const isMySubmissionsPath = useCallback((p: string): boolean => {
    return p === '/submissions';
  }, []);

  const isAllowedPath = useCallback((p: string): boolean => {
    if (p === '/' || p === '/login' || p === '/editor' || p === '/path' || p === '/dashboard' || p === '/progress' || p === '/settings') return true;
    if (p === '/submissions') return true;
    if (p === '/problems' || /^\/problems\/\d+$/.test(p)) return true;
    if (/^\/problem\/\d+$/.test(p)) return true;
    if (p === '/admin' || /^\/admin\/(users|problems|problem-types|submissions|scheduler)$/.test(p)) return true;
    return false;
  }, []);

  const resetForNewProblem = useCallback((p: ProblemSummary) => {
    setCurrentProblem(p);
    // Reset code cho bài tập mới
    setCode("# Write your Python code here\n\n");
    setTestResults([]);
    setTestError(null);
    setTestHint(null);
    setCurrentHintLevel(1);
    setIsTesting(false);
  }, []);

  // Đồng bộ tab vơi url
  useEffect(() => {
    setActiveTab(tabFromPathname(pathname));

    if (pathname.startsWith('/admin')) {
      setAdminView(adminViewFromPathname(pathname));
    } else {
      setAdminView(null);
    }

    // Điều khiển tab bên trái dựa trên URL
    if (pathname === '/problems' || pathname === '/problems/') {
      setLeftTab('list');
    } else if (/^\/problems\/\d+$/.test(pathname) || /^\/problem\/\d+$/.test(pathname)) {
      setLeftTab('desc');
    }

    // Lưu đường dẫn trước đó để quay lại khi đóng
    if (!isProgressPath(pathname)) {
      setLastNonProgressPath(pathname);
    }

    // Lưu đường dẫn không phải settings
    if (!isSettingsPath(pathname)) {
      setLastNonSettingsPath(pathname);
    }

    if (!isMySubmissionsPath(pathname)) {
      setLastNonMySubmissionsPath(pathname);
    }
  }, [pathname, tabFromPathname, adminViewFromPathname, isProblemsSectionPath, isProgressPath, isSettingsPath, isMySubmissionsPath]);

  // Security route đơn giản và chuyển hướng "/"
  useEffect(() => {
    if (!isAllowedPath(pathname)) {
      navigate(isLoggedIn ? '/editor' : '/login', { replace: true });
      return;
    }

    if (pathname === '/') {
      navigate(isLoggedIn ? '/editor' : '/login', { replace: true });
      return;
    }

    if (!isLoggedIn && pathname !== '/login') {
      navigate('/login', { replace: true });
      return;
    }

    if (isLoggedIn && pathname === '/login') {
      navigate('/editor', { replace: true });
      return;
    }

    if (pathname.startsWith('/admin') && !isAdmin) {
      navigate('/editor', { replace: true });
    }
  }, [pathname, isLoggedIn, isAdmin, navigate, isAllowedPath]);

  // Load bài tập khi truy cập trực tiếp link /problem/:id hoặc /problems/:id
  useEffect(() => {
    const id = parseProblemIdFromPath(pathname);
    if (!id) {
      setProblemLoadError(null);
      setIsProblemLoading(false);
      return;
    }

    // Nếu đã load bài này rồi thì không load lại
    if (currentProblem?.id === id) {
      setProblemLoadError(null);
      setIsProblemLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsProblemLoading(true);
      setProblemLoadError(null);
      try {
        const p = await getProblem(id);
        if (cancelled) return;
        resetForNewProblem(p);
      } catch (e: any) {
        if (cancelled) return;
        setProblemLoadError(e?.message || 'Failed to load problem');
      } finally {
        if (!cancelled) setIsProblemLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, parseProblemIdFromPath, currentProblem?.id, resetForNewProblem]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem('showTerminal', String(showTerminal));
  }, [showTerminal]);

  useEffect(() => {
    localStorage.setItem('terminalExpanded', String(terminalExpanded));
  }, [terminalExpanded]);

  useEffect(() => {
    localStorage.setItem('bottomTab', bottomTab);
  }, [bottomTab]);

  useEffect(() => {
    localStorage.setItem('bottomSplit', String(bottomSplit));
  }, [bottomSplit]);



  // Kiểm tra quyền admin từ token JWT
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && isLoggedIn) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(payload.is_admin === 1 || payload.is_admin === true);
      } catch (e) {
        setIsAdmin(false);
      }
      // Trigger làm mới danh sách bài tập khi trạng thái đăng nhập thay đổi
      setProblemsRefreshTrigger(prev => prev + 1);
    } else {
      setIsAdmin(false);
    }
  }, [isLoggedIn]);

  // Dữ liệu mức độ thành thạo và lộ trình học từ backend
  const [masteryData, setMasteryData] = useState<UserMastery[]>([]);
  const [learningNodes, setLearningNodes] = useState<LearningNode[]>([]);
  const [learningReport, setLearningReport] = useState<any>(null);

  const handleRunCode = useCallback(() => {
    // Hiển thị terminal khi chạy code
    setShowTerminal(true);
    setTerminalExpanded(true);
    setBottomTab('terminal');
    setRunTrigger(prev => prev + 1);
  }, []);

  const handleRunTests = useCallback(async () => {
    if (!currentProblem) return;
    if (!isLoggedIn) {
      setTestError('Vui lòng đăng nhập để chạy thử');
      return;
    }
    // Hiển thị terminal và panel test khi bắt đầu test
    setShowTerminal(true);
    setTerminalExpanded(true);
    setBottomTab('tests');
    setIsTesting(true);
    setTestError(null);
    try {
      const token = localStorage.getItem('token');
      const result = await submitProblem(currentProblem.id, code, token || undefined, currentHintLevel, activeSessionId);
      // Chuyển sang tab tests khi có kết quả
      setBottomTab('tests');
      setTestResults(result.results || []);

      // Gán gợi ý nếu có
      setTestHint(result.hint || null);
      setTestHintFeedback(null);
      setIsSubmittingTestHintFeedback(false);

      // Kiểm tra xem tất cả test case có pass
      const allTestsPassed = result.passed_all === true || (
        result.results && result.results.length > 0 &&
        result.results.every((test: any) => test.passed === true)
      );

      const passedCount = result.results ? result.results.filter((test: any) => test.passed === true).length : 0;
      const totalCount = result.results ? result.results.length : 0;

      // Load lại danh sách bài tập sau khi nộp thành công
      if (allTestsPassed) {
        setProblemsRefreshTrigger(prev => prev + 1);
        // Kết thúc session là solved
        try {
          if (activeSessionId) {
            await endLearningSession(activeSessionId, 'solved', token || undefined);
            setActiveSessionId(null);
            setActiveSessionProblemId(null);
          }
        } catch { }
      }
    } catch (error: any) {
      console.error('Test failed:', error);
      setTestError(error.message || 'Chạy kiểm thử thất bại');
      setBottomTab('tests');
      setTestResults([]);
    } finally {
      setIsTesting(false);
    }
  }, [currentProblem, code, isLoggedIn, currentHintLevel, activeSessionId]);

  const handleNextHint = useCallback(async () => {
    if (!currentProblem || !testHint) return;

    try {
      const token = localStorage.getItem('token');
      const nextLevel = Math.min(currentHintLevel + 1, 5);
      setCurrentHintLevel(nextLevel);

      // Call hint API với level tiếp theo
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/ai/hint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          code,
          problem_id: currentProblem.id.toString(),
          problem_description: currentProblem.description,
          hint_level: nextLevel,
          previous_hints: [testHint.hint],
          language: language,
          session_id: activeSessionId
        })
      });

      if (response.ok) {
        const hintData = await response.json();
        setTestHint({
          ...testHint,
          hint: hintData.hint,
          hint_level: nextLevel,
          // Quan trọng: API hint có thể trả về interaction_id mới; cần cập nhật để feedback đúng
          interaction_id: hintData.interaction_id ?? testHint?.interaction_id,
          error_type: hintData.error_type ?? testHint?.error_type,
          error_message: hintData.error_message ?? testHint?.error_message,
          concepts_to_review: hintData.concepts_to_review ?? testHint?.concepts_to_review,
          confidence: hintData.confidence ?? testHint?.confidence,
        });
        setTestHintFeedback(null);
        setIsSubmittingTestHintFeedback(false);
      }
    } catch (error) {
      console.error('Failed to get next hint:', error);
    }
  }, [currentProblem, testHint, currentHintLevel, code, language, activeSessionId]);

  const handleHintFeedback = useCallback(async (helpful: boolean) => {
    if (!testHint) return;
    if (isSubmittingTestHintFeedback) return;
    if (testHintFeedback) return;

    try {
      const token = localStorage.getItem('token') || undefined;
      const interactionId = testHint?.interaction_id;
      if (!interactionId) return;
      setIsSubmittingTestHintFeedback(true);
      await submitHintFeedback(interactionId, helpful, token);
      setTestHintFeedback(helpful ? 'up' : 'down');
    } catch (error) {
      console.error('Failed to submit hint feedback:', error);
    } finally {
      setIsSubmittingTestHintFeedback(false);
    }
  }, [testHint, isSubmittingTestHintFeedback, testHintFeedback]);

  const handleAskMore = useCallback(() => {
    // Mở chat với AI Tutor kèm ngữ cảnh gợi ý
    setIsChatOpen(true);
  }, []);

  const handleExecutionStart = useCallback(() => {
    setIsRunning(true);
  }, []);

  const handleExecutionEnd = useCallback((success: boolean) => {
    setIsRunning(false);
  }, [code]);

  const handleApplySuggestion = useCallback((newCode: string) => {
    setCode(newCode);
  }, [setCode]);

  // Bắt đầu session khi chọn bài; kết thúc session cũ khi chuyển bài
  useEffect(() => {
    if (!isLoggedIn) return;
    const token = localStorage.getItem('token') || undefined;
    const pid = currentProblem?.id ?? null;

    if (!pid) return;
    if (activeSessionProblemId === pid && activeSessionId) return;

    let cancelled = false;
    (async () => {
      // Kết thúc session cũ nếu tồn tại và khác bài hiện tại
      try {
        if (activeSessionId && activeSessionProblemId && activeSessionProblemId !== pid) {
          await endLearningSession(activeSessionId, 'abandoned', token);
        }
      } catch { }

      try {
        const res = await startLearningSession(pid, token);
        if (cancelled) return;
        setActiveSessionId(res.session_id ?? null);
        setActiveSessionProblemId(pid);
      } catch {
        if (!cancelled) {
          setActiveSessionId(null);
          setActiveSessionProblemId(pid);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [currentProblem?.id, isLoggedIn]);

  // Kết thúc session khi đóng tab / refresh trang
  useEffect(() => {
    if (!isLoggedIn) return;
    const onBeforeUnload = () => {
      try {
        const token = localStorage.getItem('token') || undefined;
        if (activeSessionId) {
          endLearningSession(activeSessionId, 'abandoned', token);
        }
      } catch { }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [activeSessionId, isLoggedIn]);

  // Tải dữ liệu thành thạo + lộ trình học
  useEffect(() => {
    if (!isLoggedIn) {
      setMasteryData([]);
      setLearningNodes([]);
      return;
    }

    const token = localStorage.getItem('token') || undefined;

    // Dashboard
    if (pathname === '/dashboard') {
      let cancelled = false;
      (async () => {
        try {
          const m = await getMastery(token);
          if (cancelled) return;
          setMasteryData(m);
          const r = await getLearningReport(token);
          if (!cancelled) setLearningReport(r);
        } catch (e) {
          if (!cancelled) setMasteryData([]);
          if (!cancelled) setLearningReport(null);
        }
      })();
      return () => { cancelled = true; };
    }

    // Learning Path
    if (pathname === '/path') {
      let cancelled = false;
      (async () => {
        try {
          const nodes = await getLearningPath(token);
          if (cancelled) return;
          setLearningNodes(nodes as any);
        } catch (e) {
          if (!cancelled) setLearningNodes([]);
        }
      })();
      return () => { cancelled = true; };
    }
  }, [pathname, isLoggedIn]);

  // Render giao diện admin
  if (adminView) {
    const token = localStorage.getItem('token') || '';

    if (adminView === 'dashboard') {
      return (
        <AdminDashboard
          theme={theme}
          token={token}
          onNavigate={(view) => navigate(pathForAdminView(view))}
          onBack={() => navigate('/editor')}
        />
      );
    } else if (adminView === 'problems') {
      return <ProblemManager theme={theme} token={token} onBack={() => navigate('/admin')} />;
    } else if (adminView === 'problem-types') {
      return <ProblemTypeManager theme={theme} token={token} onBack={() => navigate('/admin')} />;
    } else if (adminView === 'users') {
      return <UserManager theme={theme} token={token} onBack={() => navigate('/admin')} />;
    } else if (adminView === 'submissions') {
      return <SubmissionManager theme={theme} token={token} onBack={() => navigate('/admin')} />;
    } else if (adminView === 'scheduler') {
      return <QdrantScheduler theme={theme} token={token} onBack={() => navigate('/admin')} />;
    }
  }

  return (
    <div className={`flex h-screen font-sans overflow-hidden transition-colors ${theme === 'dark' ? 'bg-black text-zinc-200' : 'bg-gray-50 text-gray-800'}`}>
      <div className={`w-16 border-r flex flex-col items-center py-6 gap-6 z-20 ${theme === 'dark' ? 'bg-[#09090b] border-zinc-800' : 'bg-white border-gray-200'}`}>
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4">
          <BrainCircuit className="text-white" size={24} />
        </div>

        <button
          onClick={() => navigate('/editor')}
          className={`p-3 rounded-xl transition-all ${activeTab === TabView.EDITOR
            ? theme === 'dark' ? 'bg-zinc-800 text-white' : 'bg-gray-200 text-gray-900'
            : theme === 'dark' ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'
            }`}
          title="Code IDE"
        >
          <Code size={20} />
        </button>

        <button
          onClick={() => navigate('/path')}
          className={`p-3 rounded-xl transition-all ${activeTab === TabView.PATH
            ? theme === 'dark' ? 'bg-zinc-800 text-white' : 'bg-gray-200 text-gray-900'
            : theme === 'dark' ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'
            }`}
          title="Learning Path (RL)"
        >
          <Map size={20} />
        </button>

        <button
          onClick={() => navigate('/dashboard')}
          className={`p-3 rounded-xl transition-all ${activeTab === TabView.DASHBOARD
            ? theme === 'dark' ? 'bg-zinc-800 text-white' : 'bg-gray-200 text-gray-900'
            : theme === 'dark' ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'
            }`}
          title="Knowledge Dashboard"
        >
          <Layout size={20} />
        </button>

        {isAdmin && (
          <button
            onClick={() => navigate('/admin')}
            className={`p-3 rounded-xl transition-all ${adminView
              ? theme === 'dark' ? 'bg-red-600 text-white' : 'bg-red-500 text-white'
              : theme === 'dark' ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'
              }`}
            title="Admin Panel"
          >
            <Shield size={20} />
          </button>
        )}

        <div className="mt-auto flex flex-col gap-4">
          <button
            onClick={() => {
              if (pathname === '/submissions') {
                navigate(lastNonMySubmissionsPath || '/editor');
                return;
              }
              navigate('/submissions');
            }}
            className={`p-3 rounded-xl transition-all ${pathname === '/submissions'
              ? theme === 'dark' ? 'bg-indigo-600 text-white' : 'bg-indigo-500 text-white'
              : theme === 'dark' ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'
              }`}
            title="Bài nộp của tôi"
          >
            <FileText size={20} />
          </button>
          <button
            onClick={() => {
              if (pathname === '/progress') {
                navigate(lastNonProgressPath || '/editor');
                return;
              }
              navigate('/progress');
            }}
            className={`p-3 rounded-xl transition-all ${pathname === '/progress'
              ? theme === 'dark' ? 'bg-indigo-600 text-white' : 'bg-indigo-500 text-white'
              : theme === 'dark' ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'
              }`}
            title="Learning Progress"
          >
            <TrendingUp size={20} />
          </button>
          <button
            onClick={() => {
              if (pathname === '/settings') {
                navigate(lastNonSettingsPath || '/editor');
                return;
              }
              navigate('/settings');
            }}
            className={`p-3 transition-colors ${theme === 'dark' ? 'text-zinc-600 hover:text-zinc-400' : 'text-gray-400 hover:text-gray-600'}`}
            title="Settings"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className={`h-14 border-b flex items-center justify-between px-6 ${theme === 'dark' ? 'border-zinc-800 bg-[#09090b]' : 'border-gray-200 bg-white'}`}>
          <h1 className={`font-semibold flex items-center gap-2 ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-700'}`}>
            {activeTab === TabView.EDITOR && (
              <>
                Python IDE
                {currentProblem && (
                  <span className="text-sm text-zinc-500"> - {currentProblem.title}</span>
                )}
              </>
            )}
            {activeTab === TabView.PATH && "Lộ trình học"}
            {activeTab === TabView.DASHBOARD && "Bảng phân tích"}
            {activeTab === TabView.AUTH && "Chào mừng"}
          </h1>

          {activeTab === TabView.EDITOR && (
            <div className="flex items-center gap-4">
              {!isLoggedIn && (
                <button
                  onClick={() => navigate('/login')}
                  className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-md font-medium text-sm transition-all"
                >
                  Đăng nhập
                </button>
              )}
              <button
                onClick={() => {
                  setShowProblemListPanel(prev => !prev);
                  if (!showProblemListPanel) {
                    setIsHintPanelOpen(false);
                  }
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all ${showProblemListPanel
                  ? theme === 'dark' ? 'bg-emerald-600 text-white' : 'bg-emerald-600 text-white'
                  : theme === 'dark' ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-gray-600 hover:bg-gray-500 text-white'
                  }`}
                title="Toggle Problem List"
              >
                <FileText size={16} />
                Bài tập
              </button>
              {currentProblem && (
                <button
                  onClick={handleRunTests}
                  disabled={isTesting}
                  className={`
                    flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm transition-all
                    ${isTesting ? 'bg-zinc-700 cursor-not-allowed text-zinc-400' : 'bg-purple-700 hover:bg-purple-600 text-white shadow-lg shadow-purple-900/20'}
                  `}
                >
                  <TestTube size={16} fill="currentColor" />
                  {isTesting ? 'Testing...' : 'Run Tests'}
                </button>
              )}
              <button
                onClick={handleRunCode}
                disabled={isRunning}
                className={`
                  flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm transition-all
                  ${isRunning ? 'bg-zinc-700 cursor-not-allowed text-zinc-400' : 'bg-green-700 hover:bg-green-600 text-white shadow-lg shadow-green-900/20'}
                `}
              >
                <Play size={16} fill="currentColor" />
                {isRunning ? 'Running...' : 'Run Code'}
              </button>
              <button
                onClick={() => {
                  setIsHintPanelOpen(prev => !prev);
                  if (!isHintPanelOpen) {
                    setShowProblemListPanel(false);
                  }
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all ${isHintPanelOpen ? 'bg-yellow-600 text-white' : 'bg-yellow-700 hover:bg-yellow-600 text-white'}`}
                title="AI Hints"
              >
                <Lightbulb size={16} />
                Gợi ý AI
              </button>

              <button
                onClick={() => setShowVisualization(prev => !prev)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all ${showVisualization ? 'bg-cyan-600 text-white' : 'bg-cyan-700 hover:bg-cyan-600 text-white'}`}
                title="Code Visualization (AST/CFG/DFG)"
              >
                <GitBranch size={16} />
                Visualization
              </button>
              {(testResults.length > 0 || testError || isTesting) && (
                <button
                  onClick={() => {
                    setShowTerminal(true);
                    setTerminalExpanded(true);
                    setBottomTab('tests');
                  }}
                  className={`px-3 py-1 rounded-md text-sm transition-all ${showTerminal && bottomTab === 'tests'
                    ? 'bg-zinc-600 text-white'
                    : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                    }`}
                  title="Open tests panel"
                >
                  Tests
                </button>
              )}
              <button
                onClick={() => {
                  setShowTerminal(prev => {
                    const next = !prev;
                    if (next) setBottomTab('terminal');
                    return next;
                  });
                }}
                className={`px-3 py-1 rounded-md text-sm transition-all ${showTerminal ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                title={showTerminal ? 'Hide bottom panel' : 'Show bottom panel'}
              >
                {showTerminal ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-hidden relative">
          {activeTab === TabView.EDITOR && (
            <div className="flex h-full w-full overflow-hidden">
              {/* LEFT SIDEBAR: Problem List & Description */}
              {showProblemListPanel && (
                <div className={`flex flex-col flex-shrink-0 w-80 md:w-96 border-r transition-colors z-10 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
                  {/* Sidebar Tabs */}
                  <div className={`flex border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
                    <button
                      onClick={() => setLeftTab('list')}
                      className={`flex-1 py-3 text-xs md:text-sm font-medium border-b-2 transition-colors ${leftTab === 'list'
                        ? theme === 'dark' ? 'border-emerald-500 text-emerald-400 bg-zinc-800/50' : 'border-emerald-500 text-emerald-700 bg-emerald-50'
                        : theme === 'dark' ? 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                      Danh sách
                    </button>
                    <button
                      onClick={() => setLeftTab('desc')}
                      className={`flex-1 py-3 text-xs md:text-sm font-medium border-b-2 transition-colors ${leftTab === 'desc'
                        ? theme === 'dark' ? 'border-indigo-500 text-indigo-400 bg-zinc-800/50' : 'border-indigo-500 text-indigo-700 bg-indigo-50'
                        : theme === 'dark' ? 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                      Mô tả
                    </button>
                  </div>

                  {/* Sidebar Content */}
                  <div className="flex-1 overflow-hidden relative">
                    {leftTab === 'list' ? (
                      <ProblemList
                        theme={theme}
                        selectedProblemId={currentProblem?.id}
                        refreshTrigger={problemsRefreshTrigger}
                        showHeader={false}
                        embedded={true}
                        onSelect={(p: ProblemSummary) => {
                          resetForNewProblem(p);
                          navigate(`/problems/${p.id}`);
                          // Tab switch handled by useEffect
                        }}
                      />
                    ) : (
                      <div className="h-full overflow-y-auto custom-scrollbar">
                        {(isProblemLoading || problemLoadError) ? (
                          <div className={`p-4 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                            {isProblemLoading && "Đang tải bài tập..."}
                            {problemLoadError && <span className="text-red-500">Lỗi: {problemLoadError}</span>}
                          </div>
                        ) : currentProblem ? (
                          <div className="p-4 space-y-4">
                            <div>
                              <h3 className={`font-bold text-lg leading-tight mb-2 ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
                                {currentProblem.title}
                              </h3>
                              <div className="flex flex-wrap gap-2">
                                {currentProblem.difficulty && (
                                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${currentProblem.difficulty === 'Easy' ? 'bg-green-600/20 text-green-400 border border-green-600/30' :
                                    currentProblem.difficulty === 'Medium' ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/30' :
                                      'bg-red-600/20 text-red-400 border border-red-600/30'
                                    }`}>
                                    {currentProblem.difficulty}
                                  </span>
                                )}
                                {currentProblem.problem_type && (
                                  <span className={`text-xs px-2 py-0.5 rounded border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-300' : 'bg-gray-100 border-gray-200 text-gray-700'}`}>
                                    {currentProblem.problem_type}
                                  </span>
                                )}
                                {currentProblem?.completed && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 border border-blue-600/30 flex items-center gap-1">
                                    <CheckCircle size={10} /> Solved
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className={`prose prose-sm max-w-none ${theme === 'dark' ? 'prose-invert' : 'prose-gray'}`}>
                              <div className={`p-3 rounded-lg border text-sm whitespace-pre-wrap ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 text-zinc-300' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
                                {currentProblem.description}
                              </div>
                            </div>

                            <div className={`text-xs p-3 rounded-lg border ${theme === 'dark' ? 'bg-indigo-900/10 border-indigo-500/20 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}>
                              <div className="flex items-center gap-2 mb-1 font-semibold">
                                <Lightbulb size={14} />
                                <span>Mẹo</span>
                              </div>
                              Sử dụng "Gợi ý AI" ở thanh công cụ phía trên nếu bạn gặp khó khăn.
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-64 text-center p-6 opacity-60">
                            <FileText size={48} className="mb-4 text-gray-400" />
                            <p className={`text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                              Chưa chọn bài tập nào.<br />
                              Vui lòng chọn từ tab <b>Danh sách</b>.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}    {/* CENTER: Editor & Terminal */}
              <div className="flex-1 flex flex-col min-w-0 bg-transparent">
                {/* Editor Area */}
                <div className={`flex-1 min-h-0 relative ${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-white'}`}>
                  <SimpleEditor code={code} onChange={setCode} theme={theme} />
                </div>

                {/* Terminal / Tests Area */}
                {showTerminal && (
                  <div
                    className={`flex-shrink-0 border-t flex flex-col transition-all duration-300 ease-in-out ${theme === 'dark' ? 'border-zinc-800 bg-[#1e1e1e]' : 'border-gray-200 bg-white'}`}
                    style={{ height: terminalExpanded ? '60%' : '35%' }}
                  >
                    <div className={`px-4 py-2 border-b flex items-center justify-betweenSelect ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setBottomTab('terminal')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors ${bottomTab === 'terminal'
                            ? theme === 'dark' ? 'border-indigo-500 text-indigo-400 bg-zinc-800' : 'border-indigo-600 text-indigo-700 bg-white'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                          Terminal
                        </button>
                        <button
                          onClick={() => setBottomTab('tests')}
                          disabled={!(testResults.length > 0 || testError || isTesting)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors flex items-center gap-2 ${(testResults.length > 0 || testError || isTesting)
                            ? bottomTab === 'tests'
                              ? theme === 'dark' ? 'border-emerald-500 text-emerald-400 bg-zinc-800' : 'border-emerald-600 text-emerald-700 bg-white'
                              : 'border-transparent text-gray-500 hover:text-gray-700'
                            : 'border-transparent opacity-50 cursor-not-allowed'
                            }`}
                        >
                          Test Results
                          {(testResults.length > 0 || testError) && (
                            <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${testError ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}>
                              {testError ? '!' : `${testResults.filter((t: any) => t.passed === true).length}/${testResults.length}`}
                            </span>
                          )}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setTerminalExpanded(!terminalExpanded)}
                          className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors`}
                          title={terminalExpanded ? "Thu nhỏ" : "Phóng to"}
                        >
                          {terminalExpanded ? <Minimize2 size={14} className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'} /> : <Maximize2 size={14} className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'} />}
                        </button>
                        <button
                          onClick={() => setShowTerminal(false)}
                          className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors`}
                          title="Đóng panel"
                        >
                          <ChevronDown size={14} className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'} />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-hidden relative">
                      {bottomTab === 'terminal' ? (
                        <div className="h-full w-full p-2">
                          <Terminal
                            result={null}
                            isRunning={isRunning}
                            code={code}
                            runTrigger={runTrigger}
                            wsUrl={getWebSocketUrl('/ws/terminal')}
                            onExecutionStart={handleExecutionStart}
                            onExecutionEnd={handleExecutionEnd}
                          />
                        </div>
                      ) : (
                        <div className="h-full w-full overflow-y-auto p-4 custom-scrollbar">
                          {isTesting && (
                            <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4 animate-pulse">
                              <TestTube size={16} /> Đang chạy test cases...
                            </div>
                          )}
                          {testError && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-900/50 text-sm mb-4">
                              <b>Lỗi:</b> {testError}
                            </div>
                          )}

                          {/* Hints Result Block */}
                          {testHint && (
                            <div className={`mb-6 p-4 rounded-xl border ${theme === 'dark' ? 'bg-yellow-900/10 border-yellow-700/30' : 'bg-yellow-50 border-yellow-200'}`}>
                              <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-yellow-900/30 text-yellow-500' : 'bg-yellow-100 text-yellow-700'}`}>
                                  <Lightbulb size={20} />
                                </div>
                                <div className="flex-1">
                                  <h4 className={`text-sm font-bold mb-1 ${theme === 'dark' ? 'text-yellow-100' : 'text-yellow-900'}`}>
                                    Gợi ý AI (Level {currentHintLevel})
                                  </h4>
                                  <div className={`text-sm leading-relaxed mb-3 ${theme === 'dark' ? 'text-yellow-100/80' : 'text-yellow-800'}`}>
                                    <MarkdownRenderer content={testHint.hint} theme={theme} />
                                  </div>

                                  <div className="flex items-center flex-wrap gap-2 mt-2">
                                    {/* Feedback buttons */}
                                    <button
                                      onClick={() => handleHintFeedback(true)}
                                      disabled={!testHint?.interaction_id || isSubmittingTestHintFeedback || testHintFeedback !== null}
                                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors border ${testHintFeedback === 'up'
                                        ? 'bg-green-600 text-white border-green-600'
                                        : theme === 'dark' ? 'border-green-800 text-green-400 hover:bg-green-900/50' : 'border-green-200 text-green-700 hover:bg-green-50'
                                        } ${(!testHint?.interaction_id) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                      <ThumbsUp size={12} /> Hữu ích
                                    </button>
                                    <button
                                      onClick={() => handleHintFeedback(false)}
                                      disabled={!testHint?.interaction_id || isSubmittingTestHintFeedback || testHintFeedback !== null}
                                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors border ${testHintFeedback === 'down'
                                        ? 'bg-red-600 text-white border-red-600'
                                        : theme === 'dark' ? 'border-red-800 text-red-400 hover:bg-red-900/50' : 'border-red-200 text-red-700 hover:bg-red-50'
                                        } ${(!testHint?.interaction_id) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                      <ThumbsDown size={12} /> Không hữu ích
                                    </button>
                                    {currentHintLevel < 5 && (
                                      <button onClick={handleNextHint} className="text-xs px-2 py-1 rounded border border-yellow-600/30 text-yellow-600 hover:bg-yellow-600/10 transition-colors ml-auto">
                                        Xem gợi ý tiếp theo →
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Test Cases List */}
                          <div className="space-y-2">
                            {testResults.map((result, idx) => (
                              <div key={idx} className={`p-3 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-gray-200'} flex items-start gap-3`}>
                                <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${result.passed ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'}`}>
                                  {result.passed ? <CheckCircle size={14} /> : <X size={14} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-sm font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-700'}`}>Test Case #{result.testcase_id}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${result.passed ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                      {result.passed ? 'Passed' : 'Failed'}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-4 text-xs font-mono mt-2">
                                    <div>
                                      <div className="text-zinc-500 mb-0.5">Expected Output:</div>
                                      <div className={`p-1.5 rounded ${theme === 'dark' ? 'bg-black/30 text-zinc-300' : 'bg-gray-100 text-gray-700'}`}>{result.expected_output}</div>
                                    </div>
                                    <div>
                                      <div className="text-zinc-500 mb-0.5">Actual Output:</div>
                                      <div className={`p-1.5 rounded ${theme === 'dark' ? 'bg-black/30 text-zinc-300' : 'bg-gray-100 text-gray-700'}`}>{result.output}</div>
                                    </div>
                                  </div>
                                  {result.error && (
                                    <div className="mt-2 text-xs text-red-400 p-2 rounded bg-red-900/10 border border-red-900/20 font-mono">
                                      {result.error}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                            {testResults.length === 0 && !isTesting && !testError && (
                              <div className="text-center py-10 opacity-50">
                                <TestTube size={32} className="mx-auto mb-2" />
                                <span className="text-sm">Chưa có kết quả kiểm thử</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT SIDEBAR: Hint Panel (Collapsible Overlay or Fixed) */}
              {isHintPanelOpen && (
                <div className={`w-96 flex-shrink-0 border-l transition-all z-20 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
                  <HintPanel
                    code={code}
                    problemId={currentProblem?.id?.toString()}
                    sessionId={activeSessionId}
                    theme={theme}
                    language={language}
                    isOpen={isHintPanelOpen}
                    onClose={() => setIsHintPanelOpen(false)}
                    onApplySuggestion={handleApplySuggestion}
                  />
                </div>
              )}

              {/* Tutor Chat Button & Window */}
              {!isChatOpen && (
                <button
                  onClick={() => setIsChatOpen(true)}
                  className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 hover:bg-indigo-700 rounded-full shadow-lg shadow-indigo-900/50 flex items-center justify-center text-white transition-all z-40"
                  title="Open AI Tutor"
                >
                  <MessageCircle size={24} />
                </button>
              )}

              {isChatOpen && (
                <div className={`fixed bottom-6 right-6 w-96 h-[500px] rounded-lg border shadow-2xl flex flex-col z-40 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-700' : 'bg-white border-gray-300'}`}>
                  <div className={`px-4 py-3 rounded-t-lg border-b flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-gray-100 border-gray-300'}`}>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className={`text-sm font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>AI Tutor</span>
                    </div>
                    <button
                      onClick={() => setIsChatOpen(false)}
                      className={`p-1 rounded transition-colors ${theme === 'dark' ? 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200' : 'hover:bg-gray-200 text-gray-400 hover:text-gray-800'}`}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <TutorChat
                      currentCode={code}
                      theme={theme}
                      onApplySuggestion={handleApplySuggestion}
                      problemId={currentProblem?.id?.toString()}
                      problemDescription={currentProblem?.description || "Giải bài tập Python"}
                      language={language}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {
            activeTab === TabView.PATH && (
              <div className={`h-full w-full ${theme === 'dark' ? 'bg-[#09090b]' : 'bg-gray-50'}`}>
                <LearningMap nodes={learningNodes} theme={theme} />
              </div>
            )
          }

          {
            activeTab === TabView.DASHBOARD && (
              <div className={`h-full w-full ${theme === 'dark' ? 'bg-[#09090b]' : 'bg-gray-50'}`}>
                <KnowledgeDashboard masteryData={masteryData} report={learningReport} theme={theme} />
              </div>
            )
          }

          {
            activeTab === TabView.AUTH && (
              <div className={`h-full w-full flex items-center justify-center ${theme === 'dark' ? 'bg-[#09090b]' : 'bg-gray-50'}`}>
                <Auth
                  theme={theme}
                  onLogin={async () => {
                    setIsLoggedIn(true);
                    navigate('/editor', { replace: true });
                    setProblemsRefreshTrigger(prev => prev + 1);
                  }}
                />
              </div>
            )
          }

        </main >
      </div >

      {pathname === '/settings' && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className={`rounded-lg border w-full max-w-2xl max-h-[80vh] overflow-y-auto ${theme === 'dark' ? 'bg-[#09090b] border-zinc-800' : 'bg-white border-gray-200'}`}>
            <div className={`sticky top-0 border-b px-6 py-4 flex items-center justify-between ${theme === 'dark' ? 'bg-[#09090b] border-zinc-800' : 'bg-white border-gray-200'}`}>
              <h2 className={`text-lg font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Cài đặt</h2>
              <button
                onClick={() => navigate(lastNonSettingsPath || '/editor')}
                className={`text-xl ${theme === 'dark' ? 'text-zinc-400 hover:text-zinc-200' : 'text-gray-400 hover:text-gray-800'}`}
              >
                ✕
              </button>
            </div>
            <Settings
              isLoggedIn={isLoggedIn}
              theme={theme}
              onThemeChange={setTheme}
              onLogout={handleLogout}
              isAdmin={isAdmin}
            />
          </div>
        </div>
      )}

      {
        pathname === '/submissions' && (
          <MySubmissions
            theme={theme}
            onClose={() => navigate(lastNonMySubmissionsPath || '/editor')}
          />
        )
      }

      {
        showVisualization && (
          <CodeVisualization
            code={code}
            visualizationType={visualizationType}
            onTypeChange={setVisualizationType}
            isOpen={showVisualization}
            onClose={() => setShowVisualization(false)}
            theme={theme}
          />
        )
      }

      {
        pathname === '/progress' && (
          <ProgressTracker
            isOpen={true}
            onClose={() => navigate(lastNonProgressPath || '/editor')}
            theme={theme}
          />
        )
      }
    </div >
  );
};

export default App;
