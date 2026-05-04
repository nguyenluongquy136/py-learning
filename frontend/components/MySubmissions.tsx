import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../services/api';
import { ArrowLeft, FileText, RefreshCw, Search, AlertCircle, CheckCircle, XCircle, Code, X, Copy } from 'lucide-react';

interface SubmissionItem {
  id: number;
  problem_id: number;
  problem_title: string | null;
  passed_all: boolean;
  submitted_at: string | null;
}

interface SubmissionsResponse {
  total: number;
  skip: number;
  limit: number;
  items: SubmissionItem[];
}

interface SubmissionDetail extends SubmissionItem {
  code: string;
  results: any;
}

interface Props {
  theme: 'dark' | 'light';
  onClose: () => void;
}

const MySubmissions: React.FC<Props> = ({ theme, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SubmissionsResponse | null>(null);

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [passedFilter, setPassedFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [query, setQuery] = useState('');
  const [serverQuery, setServerQuery] = useState('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);

  const skip = page * pageSize;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const params = new URLSearchParams();
      params.set('skip', String(skip));
      params.set('limit', String(pageSize));
      if (passedFilter === 'passed') params.set('passed', 'true');
      if (passedFilter === 'failed') params.set('passed', 'false');
      if (serverQuery.trim()) params.set('q', serverQuery.trim());

      const res = await fetch(`${API_BASE_URL}/submissions?${params}`, { headers });
      if (!res.ok) throw new Error('Không thể tải danh sách bài nộp');
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Lỗi tải dữ liệu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, passedFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      setServerQuery(query);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverQuery]);

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const canPrev = page > 0;
  const canNext = (page + 1) < totalPages;

  const filteredItems = useMemo(() => items, [items]);

  const openDetail = async (id: number) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE_URL}/submissions/${id}`, { headers });
      if (!res.ok) throw new Error('Không thể tải chi tiết bài nộp');
      const json = await res.json();
      setDetail(json);
    } catch (e: any) {
      setDetailError(e?.message || 'Lỗi tải chi tiết');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-gray-50 text-gray-900'} overflow-hidden`}>
      <div className={`border-b sticky top-0 z-10 backdrop-blur ${theme === 'dark' ? 'border-zinc-800 bg-[#09090b]/80' : 'border-gray-200 bg-gray-50/80'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <FileText size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-2xl font-bold truncate">Bài nộp của tôi</h1>
              <p className={`text-xs md:text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                {total.toLocaleString()} bản ghi
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${theme === 'dark'
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                }`}
              title="Làm mới"
            >
              <RefreshCw size={16} />
              <span className="hidden sm:inline">Làm mới</span>
            </button>
            <button
              onClick={onClose}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${theme === 'dark'
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                }`}
              title="Quay lại"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Quay lại</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4 overflow-y-auto h-[calc(100vh-73px)]">
        {error && (
          <div className={`rounded-xl border p-3 flex items-start gap-2 ${theme === 'dark' ? 'bg-red-900/10 border-red-800 text-red-200' : 'bg-red-50 border-red-200 text-red-800'}`}>
            <AlertCircle size={18} className="mt-0.5" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className={`relative flex items-center border rounded-lg flex-1 min-w-[240px] ${theme === 'dark' ? 'border-zinc-700 bg-zinc-900' : 'border-gray-200 bg-white'}`}>
              <Search size={16} className={`absolute left-3 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-400'}`} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm theo id/problem (server-side)..."
                className={`w-full pl-9 pr-3 py-2 text-sm outline-none bg-transparent ${theme === 'dark' ? 'text-zinc-200 placeholder-zinc-500' : 'text-gray-800 placeholder-gray-400'}`}
              />
            </div>
            <select
              value={passedFilter}
              onChange={(e) => { setPassedFilter(e.target.value as any); setPage(0); }}
              className={`text-sm px-3 py-2 rounded-lg border ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-gray-200 text-gray-800'}`}
            >
              <option value="all">Tất cả</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
              className={`text-sm px-3 py-2 rounded-lg border ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-gray-200 text-gray-800'}`}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <div className={`rounded-2xl border ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <div className={`px-4 py-3 border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'} flex items-center justify-between`}>
            <div className="text-sm font-semibold">Danh sách</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
              Trang {page + 1}/{totalPages} • hiển thị {filteredItems.length}/{items.length}
            </div>
          </div>

          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={`h-10 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-100'}`} />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr className={`text-left text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                    <th className="py-3 px-4 font-medium">ID</th>
                    <th className="py-3 px-4 font-medium">Bài tập</th>
                    <th className="py-3 px-4 font-medium">Trạng thái</th>
                    <th className="py-3 px-4 font-medium">Ngày nộp</th>
                    <th className="py-3 px-4 font-medium text-right">Xem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={`py-10 px-4 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                        Không có bản ghi phù hợp.
                      </td>
                    </tr>
                  ) : filteredItems.map(it => (
                    <tr key={it.id} className={`border-t ${theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-900/40' : 'border-gray-100 hover:bg-gray-50'}`}>
                      <td className="py-3 px-4 font-mono text-xs">{it.id}</td>
                      <td className="py-3 px-4">
                        <div className="text-sm font-medium">{it.problem_title || '—'}</div>
                        <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-600'}`}>problem_id: {it.problem_id}</div>
                      </td>
                      <td className="py-3 px-4">
                        {it.passed_all ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-emerald-600 text-white">
                            <CheckCircle size={12} />
                            Passed
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${theme === 'dark' ? 'bg-red-900/30 text-red-200' : 'bg-red-50 text-red-700'}`}>
                            <XCircle size={12} />
                            Failed
                          </span>
                        )}
                      </td>
                      <td className={`py-3 px-4 text-sm ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-800'}`}>
                        {it.submitted_at ? new Date(it.submitted_at).toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => openDetail(it.id)}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${theme === 'dark'
                            ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                            : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                            }`}
                          title="Xem code & kết quả"
                        >
                          <Code size={12} />
                          Xem
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={`px-4 py-3 border-t flex items-center justify-between ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
            <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-600'}`}>
              Tổng: {total.toLocaleString()} • Trang {page + 1}/{totalPages}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={!canPrev}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${!canPrev
                  ? theme === 'dark' ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : theme === 'dark' ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50'
                  }`}
              >
                Trước
              </button>
              <button
                disabled={!canNext}
                onClick={() => setPage(p => p + 1)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${!canNext
                  ? theme === 'dark' ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : theme === 'dark' ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50'
                  }`}
              >
                Tiếp
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedId !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className={`w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-2xl border ${theme === 'dark' ? 'bg-[#09090b] border-zinc-800' : 'bg-white border-gray-200'}`}>
            <div className={`px-4 py-3 border-b flex items-center justify-between ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">Chi tiết bài nộp #{selectedId}</div>
                <div className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'} truncate`}>
                  {detail?.problem_title ? `Problem: ${detail.problem_title}` : ''}
                </div>
              </div>
              <button
                onClick={() => { setSelectedId(null); setDetail(null); setDetailError(null); }}
                className={`p-2 rounded-lg ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-300' : 'hover:bg-gray-100 text-gray-700'}`}
                title="Đóng"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(88vh-52px)]">
              {detailLoading && (
                <div className={`rounded-2xl border p-6 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-gray-50 border-gray-200'}`}>
                  <div className={`h-4 w-40 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                  <div className={`mt-4 h-48 w-full rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                </div>
              )}

              {detailError && !detailLoading && (
                <div className={`rounded-xl border p-3 flex items-start gap-2 ${theme === 'dark' ? 'bg-red-900/10 border-red-800 text-red-200' : 'bg-red-50 border-red-200 text-red-800'}`}>
                  <AlertCircle size={18} className="mt-0.5" />
                  <div className="text-sm">{detailError}</div>
                </div>
              )}

              {detail && !detailLoading && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className={`rounded-2xl border overflow-hidden ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
                    <div className={`px-4 py-3 border-b flex items-center justify-between ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
                      <div className="text-sm font-semibold">Code</div>
                      <button
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(detail.code || ''); } catch { }
                        }}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                          }`}
                        title="Copy code"
                      >
                        <Copy size={12} />
                        Copy
                      </button>
                    </div>
                    <pre className={`p-4 text-xs overflow-auto max-h-[50vh] whitespace-pre ${theme === 'dark' ? 'text-zinc-200 bg-[#0b0b0f]' : 'text-gray-900 bg-gray-50'}`}>
                      {detail.code}
                    </pre>
                  </div>

                  <div className={`rounded-2xl border overflow-hidden ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
                    <div className={`px-4 py-3 border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
                      <div className="text-sm font-semibold">Kết quả test (results)</div>
                      <div className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                        passed_all: {String(detail.passed_all)}
                      </div>
                    </div>
                    <pre className={`p-4 text-xs overflow-auto max-h-[50vh] ${theme === 'dark' ? 'text-zinc-200 bg-[#0b0b0f]' : 'text-gray-900 bg-gray-50'}`}>
                      {JSON.stringify(detail.results ?? null, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MySubmissions;


