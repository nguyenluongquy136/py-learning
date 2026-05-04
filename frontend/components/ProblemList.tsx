import React, { useEffect, useState, useMemo } from 'react';
import { getProblems, getProblemTypes, ProblemType } from '../services/api';
import { Code, Target, BookOpen, TrendingUp, CheckCircle, Book, Sparkles } from 'lucide-react';

export interface ProblemSummary {
  id: number;
  title: string;
  description: string;
  difficulty?: string;
  problem_type?: string;
  completed?: boolean;
}

interface Props {
  onSelect?: (p: ProblemSummary) => void;
  theme?: 'dark' | 'light';
  selectedProblemId?: number;
  refreshTrigger?: number;
  showHeader?: boolean;
  embedded?: boolean;
}

const ProblemList: React.FC<Props> = ({
  onSelect,
  theme = 'dark',
  selectedProblemId,
  refreshTrigger = 0,
  showHeader = true,
  embedded = false
}) => {
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<'all' | 'todo' | 'done'>('all');
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [reloadSeq, setReloadSeq] = useState(0);
  const [problemTypes, setProblemTypes] = useState<ProblemType[]>([]);

  // Tải danh sách loại bài tập từ database khi component mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const types = await getProblemTypes();
        if (!cancelled) setProblemTypes(types);
      } catch (err) {
        console.error('Failed to load problem types:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Tải danh sách bài tập khi bộ lọc, phân trang hoặc trigger thay đổi
  // Debounce input tìm kiếm để tránh gọi API quá nhiều
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await getProblems({ search: searchDebounced || undefined, difficulty: difficultyFilter, problem_type: typeFilter, limit, offset });
        if (cancelled) return;
        // Backend trả về { total, limit, offset, items }
        setProblems(res.items || []);
        setTotal(typeof res.total === 'number' ? res.total : (res.items?.length || 0));
        setError(null);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Không tải được danh sách bài tập');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshTrigger, searchDebounced, difficultyFilter, typeFilter, limit, offset, reloadSeq]);

  // Khi query thay đổi, đóng các mô tả mở rộng (tránh hiển thị sai lệch)
  useEffect(() => {
    setExpandedIds(new Set());
  }, [searchDebounced, difficultyFilter, typeFilter, statusFilter, limit, offset, refreshTrigger]);

  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty?.toLowerCase()) {
      case 'easy':
        return 'bg-green-600 text-white';
      case 'medium':
        return 'bg-yellow-600 text-white';
      case 'hard':
        return 'bg-red-600 text-white';
      default:
        return theme === 'dark' ? 'bg-zinc-600 text-zinc-200' : 'bg-gray-600 text-white';
    }
  };

  const getProblemTypeIcon = (type?: string) => {
    switch (type?.toLowerCase()) {
      case 'algorithm':
        return <Target size={14} />;
      case 'data structure':
        return <BookOpen size={14} />;
      case 'math':
        return <TrendingUp size={14} />;
      default:
        return <Code size={14} />;
    }
  };

  const visibleProblems = useMemo(() => {
    if (statusFilter === 'all') return problems;
    if (statusFilter === 'done') return problems.filter(p => !!p.completed);
    return problems.filter(p => !p.completed);
  }, [problems, statusFilter]);

  const completedInPage = useMemo(() => problems.filter(p => p.completed).length, [problems]);

  const pageStart = total > 0 ? Math.min(offset + 1, total) : (problems.length > 0 ? offset + 1 : 0);
  const pageEnd = total > 0 ? Math.min(offset + limit, total) : (offset + problems.length);
  const hasPrev = offset > 0;
  const hasNext = total > 0 ? (offset + limit) < total : problems.length === limit;

  const toggleExpanded = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={`flex flex-col h-full max-h-full overflow-x-hidden ${embedded ? '' : 'border-r'} ${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-white'} ${embedded ? '' : (theme === 'dark' ? 'border-zinc-800' : 'border-gray-300')}`}>
      {/* Header */}
      {showHeader && (
        <div className={`p-3 border-b flex items-center justify-between ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-300 bg-gray-50'}`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center">
              <Book size={16} className="text-white" />
            </div>
            <div>
              <h3 className={`font-medium text-sm ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>
                Danh sách bài tập
              </h3>
              <p className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                {total ? `${total} bài tập` : `${problems.length} bài tập`} • {completedInPage} hoàn thành (trang này)
                {pageStart > 0 && pageEnd > 0 ? ` • ${pageStart}-${pageEnd}` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className={`px-3 py-2 border-b flex flex-wrap items-center gap-2 ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-gray-50'}`}>
        <div className={`relative flex items-center border rounded flex-1 min-w-[180px] ${theme === 'dark' ? 'border-zinc-700 bg-zinc-900' : 'border-gray-200 bg-white'}`}>
          <input
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setOffset(0); }}
            placeholder="Tìm kiếm bài tập..."
            className={`text-sm px-3 py-1.5 outline-none w-full min-w-0 ${theme === 'dark' ? 'bg-transparent text-zinc-200' : 'bg-transparent text-gray-800'}`}
          />
          {searchTerm && (
            <button onClick={() => { setSearchTerm(''); setSearchDebounced(''); setOffset(0); }} className={`px-2 py-1 ${theme === 'dark' ? 'text-zinc-400 hover:text-zinc-200' : 'text-gray-500 hover:text-gray-800'}`} title="Clear search">✕</button>
          )}
        </div>
        <select value={difficultyFilter || ''} onChange={e => { setDifficultyFilter(e.target.value || undefined); setOffset(0); }} className={`text-sm px-2 py-1 rounded ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-gray-200 text-gray-800'}`}>
          <option value="">Tất cả</option>
          <option value="Easy">Easy</option>
          <option value="Medium">Medium</option>
          <option value="Hard">Hard</option>
        </select>
        <select value={typeFilter || ''} onChange={e => { setTypeFilter(e.target.value || undefined); setOffset(0); }} className={`text-sm px-2 py-1 rounded ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-gray-200 text-gray-800'}`}>
          <option value="">Tất cả loại</option>
          {problemTypes.map(pt => (
            <option key={pt.id} value={pt.name}>{pt.name}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as any); setOffset(0); }} className={`text-sm px-2 py-1 rounded ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-gray-200 text-gray-800'}`}>
          <option value="all">Tất cả</option>
          <option value="todo">Chưa làm</option>
          <option value="done">Đã làm</option>
        </select>
        <button onClick={() => { setDifficultyFilter(undefined); setTypeFilter(undefined); setStatusFilter('all'); setSearchTerm(''); setSearchDebounced(''); setOffset(0); }} className={`text-sm ml-2 px-2 py-1 rounded ${theme === 'dark' ? 'bg-zinc-800 text-zinc-200' : 'bg-gray-100 text-gray-800'}`}>Reset</button>
      </div>
      {/* Problems List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
        {error && !isLoading && (
          <div className={`p-4 rounded-lg border ${theme === 'dark' ? 'border-red-800 bg-red-900/20 text-red-200' : 'border-red-200 bg-red-50 text-red-800'}`}>
            <div className="text-sm font-medium mb-1">Không tải được danh sách bài tập</div>
            <div className="text-xs opacity-90">{error}</div>
            <button
              onClick={() => setReloadSeq(s => s + 1)}
              className={`mt-3 text-xs px-2 py-1 rounded ${theme === 'dark' ? 'bg-red-800 hover:bg-red-700 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}`}
            >
              Thử lại
            </button>
          </div>
        )}

        {isLoading && problems.length === 0 && (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`p-4 rounded-lg border ${theme === 'dark' ? 'bg-zinc-900/70 border-zinc-800' : 'bg-white border-gray-200'}`}>
                <div className={`h-4 w-3/5 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                <div className={`mt-3 h-3 w-2/5 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                <div className={`mt-3 h-3 w-full rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                <div className={`mt-2 h-3 w-5/6 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
              </div>
            ))}
          </div>
        )}

        {visibleProblems.map(p => {
          const isSelected = selectedProblemId === p.id;
          const isCompleted = !!p.completed;
          const isExpanded = expandedIds.has(p.id);
          const shouldShowToggle = !!p.description && (
            p.description.length > 150 || p.description.split('\n').length > 4
          );

          return (
            <div
              key={p.id}
              onClick={() => onSelect && onSelect(p)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (!onSelect) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(p);
                }
              }}
              aria-selected={isSelected}
              className={`p-4 rounded-lg border transition-all cursor-pointer hover:shadow-lg hover:scale-[1.02] ${isSelected
                ? theme === 'dark'
                  ? 'bg-indigo-900/40 border-indigo-500 ring-2 ring-indigo-500/30 shadow-lg shadow-indigo-500/20'
                  : 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500/30 shadow-lg shadow-indigo-500/20'
                : theme === 'dark'
                  ? 'bg-zinc-900/70 border-zinc-700 hover:bg-zinc-800/70 hover:border-zinc-600'
                  : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                }`}
            >
              {/* Header with status and difficulty */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {isCompleted && (
                    <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
                  )}
                  <h4 className={`font-semibold text-sm leading-tight flex-1 pr-2 ${isSelected
                    ? theme === 'dark' ? 'text-indigo-100' : 'text-indigo-900'
                    : theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'
                    }`}>
                    {p.title}
                  </h4>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  {p.difficulty && (
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${getDifficultyColor(p.difficulty)}`}>
                      {p.difficulty}
                    </span>
                  )}
                </div>
              </div>

              {/* Problem type */}
              {p.problem_type && (
                <div className="flex items-center gap-2 mb-3">
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${theme === 'dark' ? 'bg-zinc-800 text-zinc-300' : 'bg-gray-100 text-gray-600'
                    }`}>
                    {getProblemTypeIcon(p.problem_type)}
                    <span className="capitalize">{p.problem_type}</span>
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="relative">
                <div className={`text-xs leading-relaxed ${isExpanded ? 'max-h-56 overflow-y-auto pr-1' : ''} ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'
                  }`} style={isExpanded ? { lineHeight: '1.5', overflowWrap: 'anywhere', wordBreak: 'break-word' } : ({
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical' as const,
                    lineHeight: '1.5',
                    overflow: 'hidden',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word'
                  } as any)}>
                  {p.description}
                </div>
                {shouldShowToggle && (
                  <button
                    className={`text-xs mt-1 px-2 py-0.5 rounded transition-colors ${theme === 'dark'
                      ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                      }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(p.id);
                    }}
                  >
                    {isExpanded ? 'Thu gọn' : 'Xem thêm'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {/* Pagination */}
        {problems.length > 0 && (
          <div className={`flex items-center justify-between px-4 py-3 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <button
                disabled={!hasPrev}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${!hasPrev
                  ? theme === 'dark' ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : theme === 'dark' ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                Trước
              </button>
              <button
                disabled={!hasNext}
                onClick={() => setOffset(offset + limit)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${!hasNext
                  ? theme === 'dark' ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : theme === 'dark' ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                Tiếp
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Hiển thị:</span>
              <select
                value={limit}
                onChange={e => { setLimit(Number(e.target.value)); setOffset(0); }}
                className={`text-xs px-2 py-1 rounded ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-gray-200 text-gray-800'}`}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        )}

        {/* Empty State */}
        {visibleProblems.length === 0 && !isLoading && !error && (
          <div className={`flex flex-col items-center justify-center py-12 px-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-100'}`}>
              <Book size={32} className="opacity-50" />
            </div>
            <h4 className={`font-medium text-sm mb-2 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
              Không có bài tập phù hợp
            </h4>
            <p className="text-xs text-center">
              Thử đổi bộ lọc hoặc xoá từ khoá tìm kiếm.
            </p>
            <button
              onClick={() => { setDifficultyFilter(undefined); setTypeFilter(undefined); setStatusFilter('all'); setSearchTerm(''); setSearchDebounced(''); setOffset(0); }}
              className={`mt-4 text-xs px-3 py-1.5 rounded ${theme === 'dark' ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}
            >
              Xoá bộ lọc
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProblemList;
