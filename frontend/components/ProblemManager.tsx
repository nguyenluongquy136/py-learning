import React, { useMemo, useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Save, X, FileCode, AlertCircle, CheckCircle } from 'lucide-react';
import { API_BASE_URL } from '../services/api';

interface Problem {
  id: number;
  title: string;
  description: string;
  difficulty: string;
  problem_type_id: number | null;
  problem_type: string | null;
  test_case_count: number;
  test_cases?: TestCase[];
}

interface ProblemsResponse {
  total: number;
  skip: number;
  limit: number;
  items: Problem[];
}

interface TestCase {
  input: string;
  expected_output: string;
}

interface ProblemManagerProps {
  theme: 'dark' | 'light';
  token?: string;
  onBack: () => void;
}

const ProblemManager: React.FC<ProblemManagerProps> = ({ theme, token, onBack }) => {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [total, setTotal] = useState(0);

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProblem, setEditingProblem] = useState<Problem | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [testCases, setTestCases] = useState<TestCase[]>([{ input: '', expected_output: '' }]);

  const [problemTypes, setProblemTypes] = useState<Array<{ id: number, name: string }>>([]);
  const [selectedProblemType, setSelectedProblemType] = useState<string | null>(null);

  useEffect(() => {
    loadProblems();
    loadProblemTypes();
  }, []);

  const loadProblemTypes = async () => {
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE_URL}/api/admin/problem-types`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      setProblemTypes(data || []);
    } catch (e) {
      // ignore
    }
  };

  const loadProblems = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const skip = Math.max(page, 0) * Math.max(pageSize, 1);
      const params = new URLSearchParams({ skip: String(skip), limit: String(pageSize) });
      const q = search.trim();
      if (q) params.set('q', q);
      const res = await fetch(`${API_BASE_URL}/api/admin/problems?${params.toString()}`, { headers });
      if (!res.ok) throw new Error('Failed to load problems');

      const data: ProblemsResponse = await res.json();
      const items = data.items || [];
      setProblems(items);
      setTotal(data.total || 0);
      setHasNext(items.length === pageSize);
    } catch (err: any) {
      setError(err.message || 'Failed to load problems');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProblems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0);
      loadProblems();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) {
      setError('Tiêu đề và mô tả là bắt buộc');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/api/admin/problems`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title,
          description,
          difficulty,
          problem_type_id: selectedProblemType ? parseInt(selectedProblemType) : undefined,
          test_cases: testCases.filter(tc => tc.input || tc.expected_output)
        })
      });

      if (!res.ok) throw new Error('Failed to create problem');

      setSuccess('Tạo bài tập thành công!');
      setShowCreateModal(false);
      resetForm();
      loadProblems();
    } catch (err: any) {
      setError(err.message || 'Failed to create problem');
    }
  };

  const handleUpdate = async (problemId: number) => {
    if (!editingProblem) return;

    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/api/admin/problems/${problemId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          title: editingProblem.title,
          description: editingProblem.description,
          difficulty: editingProblem.difficulty,
          problem_type_id: editingProblem.problem_type_id,
          test_cases: editingProblem.test_cases || []
        })
      });

      if (!res.ok) throw new Error('Failed to update problem');

      setSuccess('Cập nhật bài tập thành công!');
      setEditingProblem(null);
      loadProblems();
    } catch (err: any) {
      setError(err.message || 'Failed to update problem');
    }
  };

  const handleDelete = async (problemId: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bài tập này? Tất cả bài nộp sẽ bị mất.')) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/api/admin/problems/${problemId}`, {
        method: 'DELETE',
        headers
      });

      if (!res.ok) throw new Error('Failed to delete problem');

      setSuccess('Xóa bài tập thành công!');
      loadProblems();
    } catch (err: any) {
      setError(err.message || 'Failed to delete problem');
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDifficulty('easy');
    setTestCases([{ input: '', expected_output: '' }]);
  };

  const addTestCase = () => {
    setTestCases([...testCases, { input: '', expected_output: '' }]);
  };

  const removeTestCase = (index: number) => {
    setTestCases(testCases.filter((_, i) => i !== index));
  };

  // Edit-mode testcases helpers
  const addEditTestCase = () => {
    if (!editingProblem) return;
    const tc = editingProblem.test_cases ? [...editingProblem.test_cases, { input: '', expected_output: '' }] : [{ input: '', expected_output: '' }];
    setEditingProblem({ ...editingProblem, test_cases: tc });
  };

  const removeEditTestCase = (index: number) => {
    if (!editingProblem) return;
    const tc = (editingProblem.test_cases || []).filter((_, i) => i !== index);
    setEditingProblem({ ...editingProblem, test_cases: tc });
  };

  const updateEditTestCase = (index: number, field: 'input' | 'expected_output', value: string) => {
    if (!editingProblem) return;
    const tc = (editingProblem.test_cases || []).slice();
    tc[index] = { ...tc[index], [field]: value };
    setEditingProblem({ ...editingProblem, test_cases: tc });
  };

  const updateTestCase = (index: number, field: 'input' | 'expected_output', value: string) => {
    const updated = [...testCases];
    updated[index][field] = value;
    setTestCases(updated);
  };

  const getDifficultyColor = (diff: string) => {
    switch (diff?.toLowerCase()) {
      case 'easy': return 'bg-green-600';
      case 'medium': return 'bg-yellow-600';
      case 'hard': return 'bg-red-600';
      default: return 'bg-gray-600';
    }
  };

  const filteredProblems = useMemo(() => problems, [problems]);

  const toggleExpanded = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b transition-colors duration-300 ${theme === 'dark' ? 'border-white/10 bg-[#09090b]/80' : 'border-gray-200/50 bg-white/70'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className={`group flex items-center gap-2 text-sm font-medium transition-colors ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
              >
                <div className={`p-1.5 rounded-full transition-colors ${theme === 'dark' ? 'bg-white/5 group-hover:bg-white/10' : 'bg-black/5 group-hover:bg-black/10'}`}>
                  ←
                </div>
                Quay lại
              </button>
              <div className="h-6 w-px bg-current opacity-10 mx-2" />
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 ring-1 ring-white/10">
                  <FileCode className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight">Quản lý bài tập</h1>
                  <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    {total.toLocaleString()} bài • hiển thị {filteredProblems.length}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-emerald-500/25 transition-all duration-200 active:scale-95"
            >
              <Plus size={18} />
              Tạo bài tập
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Alerts */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-500 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto opacity-70 hover:opacity-100">
              <X size={18} />
            </button>
          </div>
        )}

        {success && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-emerald-500 animate-in fade-in slide-in-from-top-2">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{success}</span>
            <button onClick={() => setSuccess(null)} className="ml-auto opacity-70 hover:opacity-100">
              <X size={18} />
            </button>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className={`rounded-2xl border backdrop-blur-md p-2 flex items-center gap-2 transition-all duration-300 ${theme === 'dark' ? 'bg-gray-800/40 border-white/10' : 'bg-white/60 border-gray-200/60 shadow-sm'}`}>
          <div className="relative flex-1">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm kiếm theo ID, tiêu đề, mô tả..."
              className={`w-full pl-4 pr-4 py-2.5 rounded-xl text-sm outline-none bg-transparent transition-all ${theme === 'dark' ? 'placeholder-gray-500 text-gray-200' : 'placeholder-gray-400 text-gray-800'}`}
            />
          </div>
          <div className={`h-8 w-px ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className="flex items-center gap-3 px-3">
            <span className={`text-xs font-medium uppercase tracking-wide ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Hiển thị</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
              className={`text-sm font-medium bg-transparent outline-none cursor-pointer ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}
            >
              <option value={20} className={theme === 'dark' ? 'bg-gray-800' : 'bg-white'}>20</option>
              <option value={50} className={theme === 'dark' ? 'bg-gray-800' : 'bg-white'}>50</option>
              <option value={100} className={theme === 'dark' ? 'bg-gray-800' : 'bg-white'}>100</option>
            </select>
          </div>
        </div>

        {/* Problems List */}
        {loading ? (
          <div className="grid gap-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className={`h-24 rounded-2xl animate-pulse ${theme === 'dark' ? 'bg-white/5' : 'bg-gray-100'}`} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredProblems.length === 0 ? (
              <div className={`flex flex-col items-center justify-center py-16 rounded-3xl border border-dashed ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                <div className={`p-4 rounded-full mb-4 ${theme === 'dark' ? 'bg-white/5 text-gray-500' : 'bg-gray-50 text-gray-400'}`}>
                  <FileCode size={32} />
                </div>
                <h3 className={`text-lg font-medium ${theme === 'dark' ? 'text-gray-300' : 'text-gray-900'}`}>Không tìm thấy bài tập</h3>
                <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>Thử thay đổi từ khoá tìm kiếm của bạn.</p>
              </div>
            ) : filteredProblems.map((problem) => (
              <div
                key={problem.id}
                className={`group rounded-2xl border transition-all duration-300 ${theme === 'dark' ? 'bg-gray-800/40 border-white/5 hover:border-white/10 hover:bg-gray-800/60' : 'bg-white border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200'}`}
              >
                {editingProblem?.id === problem.id ? (
                  // Edit mode
                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="col-span-1 md:col-span-2 space-y-4">
                        <label className="text-sm font-medium block">Thông tin cơ bản</label>
                        <input
                          type="text"
                          value={editingProblem.title}
                          onChange={(e) => setEditingProblem({ ...editingProblem, title: e.target.value })}
                          className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${theme === 'dark' ? 'bg-gray-900/50 border-white/10 focus:border-emerald-500/50' : 'bg-gray-50 border-gray-200'}`}
                          placeholder="Tiêu đề bài tập"
                        />
                        <textarea
                          value={editingProblem.description}
                          onChange={(e) => setEditingProblem({ ...editingProblem, description: e.target.value })}
                          rows={4}
                          className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${theme === 'dark' ? 'bg-gray-900/50 border-white/10 focus:border-emerald-500/50' : 'bg-gray-50 border-gray-200'}`}
                          placeholder="Mô tả chi tiết..."
                        />
                      </div>

                      <div className="space-y-4">
                        <label className="text-sm font-medium block">Cấu hình</label>
                        <div className="grid grid-cols-2 gap-4">
                          <select
                            value={editingProblem.difficulty}
                            onChange={(e) => setEditingProblem({ ...editingProblem, difficulty: e.target.value })}
                            className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${theme === 'dark' ? 'bg-gray-900/50 border-white/10 focus:border-emerald-500/50' : 'bg-gray-50 border-gray-200'}`}
                          >
                            <option value="easy">Easy (Dễ)</option>
                            <option value="medium">Medium (Vừa)</option>
                            <option value="hard">Hard (Khó)</option>
                          </select>
                          <select
                            value={String(editingProblem.problem_type_id || '')}
                            onChange={(e) => setEditingProblem({ ...editingProblem, problem_type_id: e.target.value ? parseInt(e.target.value) : null })}
                            className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${theme === 'dark' ? 'bg-gray-900/50 border-white/10 focus:border-emerald-500/50' : 'bg-gray-50 border-gray-200'}`}
                          >
                            <option value="">-- Loại bài tập --</option>
                            {problemTypes.map(pt => <option key={pt.id} value={String(pt.id)}>{pt.name}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Edit test cases */}
                    <div className="space-y-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Test Cases</label>
                        <button onClick={addEditTestCase} className="text-sm px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors cursor-pointer">+ Thêm Test Case</button>
                      </div>
                      <div className="space-y-3">
                        {(editingProblem.test_cases || []).map((tc, idx) => (
                          <div key={idx} className={`p-4 rounded-xl border group/tc relative ${theme === 'dark' ? 'bg-gray-900/30 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="text-xs text-gray-500 mb-1 block">Input</label>
                                <input type="text" value={tc.input || ''} onChange={(e) => updateEditTestCase(idx, 'input', e.target.value)} className={`w-full px-3 py-2 rounded-lg border outline-none font-mono text-sm ${theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-white border-gray-200'}`} />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 mb-1 block">Expected Output</label>
                                <input type="text" value={tc.expected_output || ''} onChange={(e) => updateEditTestCase(idx, 'expected_output', e.target.value)} className={`w-full px-3 py-2 rounded-lg border outline-none font-mono text-sm ${theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-white border-gray-200'}`} />
                              </div>
                            </div>
                            {(editingProblem.test_cases || []).length > 1 && (
                              <button onClick={() => removeEditTestCase(idx)} className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-500/10 transition-all opacity-0 group-hover/tc:opacity-100">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-3 justify-end pt-2">
                      <button onClick={() => setEditingProblem(null)} className={`px-5 py-2 rounded-xl font-medium transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-100 hover:bg-gray-200'}`}>
                        Hủy bỏ
                      </button>
                      <button onClick={() => handleUpdate(problem.id)} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all active:scale-95">
                        <Save size={16} /> Lưu thay đổi
                      </button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-6">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`font-mono text-xs px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'}`}>#{problem.id}</span>
                          <h3 className="text-lg font-bold truncate">{problem.title}</h3>
                        </div>

                        <div className="flex items-center gap-3 mb-4">
                          <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${problem.difficulty?.toLowerCase() === 'easy' ? 'bg-teal-500/10 text-teal-500 border-teal-500/20' :
                            problem.difficulty?.toLowerCase() === 'medium' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                              'bg-rose-500/10 text-rose-500 border-rose-500/20'
                            }`}>
                            {problem.difficulty ? problem.difficulty.charAt(0).toUpperCase() + problem.difficulty.slice(1) : 'Unknown'}
                          </span>
                          <span className={`text-xs flex items-center gap-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                            • {problem.test_case_count} test cases
                          </span>
                          {problem.problem_type && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${theme === 'dark' ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                              {problem.problem_type}
                            </span>
                          )}
                        </div>

                        <div className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                          <div
                            style={(expandedIds.has(problem.id) ? { overflowWrap: 'anywhere', wordBreak: 'break-word' } : ({
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical' as const,
                              overflow: 'hidden',
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word'
                            } as any))}
                          >
                            {problem.description || <span className="italic opacity-50">Không có mô tả</span>}
                          </div>
                          {problem.description && problem.description.length > 150 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpanded(problem.id); }}
                              className="mt-1 text-xs font-medium text-indigo-500 hover:text-indigo-400 hover:underline"
                            >
                              {expandedIds.has(problem.id) ? 'Thu gọn' : 'Xem thêm...'}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={async () => {
                            try {
                              // Load full details for editing
                              const headers: Record<string, string> = {};
                              if (token) headers['Authorization'] = `Bearer ${token}`;
                              const res = await fetch(`${API_BASE_URL}/api/admin/problems/${problem.id}`, { headers });
                              if (!res.ok) throw new Error('Failed to load problem');
                              const data = await res.json();
                              setEditingProblem({
                                id: data.id,
                                title: data.title,
                                description: data.description,
                                difficulty: data.difficulty,
                                problem_type_id: data.problem_type_id,
                                problem_type: data.problem_type,
                                test_case_count: data.test_cases ? data.test_cases.length : 0,
                                test_cases: data.test_cases || []
                              });
                            } catch (err: any) {
                              setError(err.message || 'Failed to load problem');
                            }
                          }}
                          className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-blue-400' : 'bg-gray-100 hover:bg-gray-200 text-blue-600'}`}
                          title="Chỉnh sửa"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(problem.id)}
                          className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-red-500/20 text-red-400' : 'bg-gray-100 hover:bg-red-50 text-red-600'}`}
                          title="Xóa"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && (
        <div className="max-w-7xl mx-auto px-6 pb-10">
          <div className="flex items-center justify-between">
            <div className={`text-sm ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>
              Đang xem trang <span className="font-medium text-current">{page + 1}</span> trên tổng số <span className="font-medium text-current">{Math.max(1, Math.ceil(total / pageSize))}</span>
            </div>

            <div className="flex gap-2">
              <button
                disabled={page <= 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${page <= 0
                  ? 'opacity-50 cursor-not-allowed'
                  : theme === 'dark' ? 'hover:bg-white/10 active:scale-95' : 'hover:bg-gray-100 active:scale-95'
                  } ${theme === 'dark' ? 'bg-white/5 border border-white/5' : 'bg-white border border-gray-200'}`}
              >
                Trước
              </button>
              <button
                disabled={(page + 1) >= Math.max(1, Math.ceil(total / pageSize))}
                onClick={() => setPage(p => p + 1)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${(page + 1) >= Math.max(1, Math.ceil(total / pageSize))
                  ? 'opacity-50 cursor-not-allowed'
                  : theme === 'dark' ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 active:scale-95' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 active:scale-95'
                  }`}
              >
                Tiếp theo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal - Redesigned */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => { setShowCreateModal(false); resetForm(); }}
          />

          <div className={`relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border transform transition-all ${theme === 'dark' ? 'bg-gray-900 border-white/10' : 'bg-white border-gray-100'}`}>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-dashed border-gray-200 dark:border-gray-800">
                <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-500 to-teal-500">
                  Tạo bài tập mới
                </h2>
                <button onClick={() => { setShowCreateModal(false); resetForm(); }} className="text-gray-400 hover:text-gray-500">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Tiêu đề bài tập</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ví dụ: Tính tổng hai số"
                    className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${theme === 'dark' ? 'bg-gray-800 border-white/10 focus:border-emerald-500/50' : 'bg-gray-50 border-gray-200'}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Mô tả chi tiết</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Mô tả nội dung bài tập, yêu cầu input/output..."
                    rows={5}
                    className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${theme === 'dark' ? 'bg-gray-800 border-white/10 focus:border-emerald-500/50' : 'bg-gray-50 border-gray-200'}`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Độ khó</label>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value as any)}
                      className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${theme === 'dark' ? 'bg-gray-800 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                    >
                      <option value="easy">Easy (Dễ)</option>
                      <option value="medium">Medium (Vừa)</option>
                      <option value="hard">Hard (Khó)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1.5">Loại bài tập</label>
                    <select value={selectedProblemType || ''} onChange={(e) => setSelectedProblemType(e.target.value || null)} className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${theme === 'dark' ? 'bg-gray-800 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                      <option value="">-- Chọn loại --</option>
                      {problemTypes.map(pt => <option key={pt.id} value={String(pt.id)}>{pt.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium">Test Cases (Mẫu)</label>
                    <button onClick={addTestCase} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors">
                      + Thêm Test Case
                    </button>
                  </div>
                  <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                    {testCases.map((tc, idx) => (
                      <div key={idx} className={`p-4 rounded-xl border relative ${theme === 'dark' ? 'bg-gray-800/50 border-white/10' : 'bg-gray-50/50 border-gray-200'}`}>
                        <div className="grid grid-cols-2 gap-4">
                          <input type="text" placeholder="Input (e.g. 1 2)" value={tc.input} onChange={(e) => updateTestCase(idx, 'input', e.target.value)} className={`w-full px-3 py-2 rounded-lg border outline-none font-mono text-sm ${theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-white border-gray-200'}`} />
                          <input type="text" placeholder="Output (e.g. 3)" value={tc.expected_output} onChange={(e) => updateTestCase(idx, 'expected_output', e.target.value)} className={`w-full px-3 py-2 rounded-lg border outline-none font-mono text-sm ${theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-white border-gray-200'}`} />
                        </div>
                        {testCases.length > 1 && (
                          <button onClick={() => removeTestCase(idx)} className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full shadow hover:bg-red-600">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={handleCreate} className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all active:scale-95">
                  Tạo bài tập ngay
                </button>
                <button onClick={() => { setShowCreateModal(false); resetForm(); }} className={`px-5 py-2.5 rounded-xl font-medium transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-100 hover:bg-gray-200'}`}>
                  Hủy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProblemManager;
