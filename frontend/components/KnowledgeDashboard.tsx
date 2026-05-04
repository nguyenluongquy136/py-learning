import React, { useMemo } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { UserMastery } from '../types';
import { BarChart3, Radar as RadarIcon, Activity, Download } from 'lucide-react';
import { API_BASE_URL } from '../services/api';

interface KnowledgeDashboardProps {
  masteryData: UserMastery[];
  report?: {
    summary?: {
      solved_sessions: number;
      avg_time_solved_seconds?: number | null;
      avg_hints_per_solved?: number | null;
      hint_helpful_rate?: number | null;
      avg_attempts_per_solved_problem?: number | null;
    };
    by_concept?: Array<{
      concept: string;
      solved_sessions: number;
      avg_time_solved_seconds?: number | null;
      avg_hints_per_solved?: number | null;
      hint_helpful_rate?: number | null;
    }>;
  } | null;
  theme?: 'dark' | 'light';
}

const KnowledgeDashboard: React.FC<KnowledgeDashboardProps> = ({ masteryData, report, theme = 'dark' }) => {
  const isEmpty = !masteryData || masteryData.length === 0;
  const summary = report?.summary;

  const downloadCsv = (kind: 'summary' | 'sessions' | 'hints') => {
    const token = localStorage.getItem('token');
    const url = `${API_BASE_URL}/api/ai/report/export?kind=${kind}`;

    // Authenticated download: fetch blob with Authorization header.
    // (New tab can't include Authorization header reliably.)
    fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        const href = URL.createObjectURL(blob);
        a.href = href;
        a.download = `learning_${kind}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(href);
      })
      .catch(() => { });
  };

  const stats = useMemo(() => {
    if (!masteryData || masteryData.length === 0) {
      return { avg: 0, totalAttempts: 0, best: null as UserMastery | null, worst: null as UserMastery | null };
    }
    const totalAttempts = masteryData.reduce((s, x) => s + (x.attempts || 0), 0);
    const avg = masteryData.reduce((s, x) => s + (x.score || 0), 0) / masteryData.length;
    const best = masteryData.reduce((a, b) => (b.score > a.score ? b : a));
    const worst = masteryData.reduce((a, b) => (b.score < a.score ? b : a));
    return { avg, totalAttempts, best, worst };
  }, [masteryData]);

  return (
    <div className="p-6 md:p-10 space-y-6 overflow-y-auto h-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className={`text-xl md:text-2xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
            Bảng phân tích
          </h2>
          <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
            Tổng quan mức độ thành thạo và lịch sử luyện tập theo chủ đề.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              downloadCsv('summary');
            }}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${theme === 'dark'
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
              }`}
            title="Download CSV (summary)"
          >
            <Download size={16} />
            Summary CSV
          </button>
          <button
            onClick={() => downloadCsv('sessions')}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${theme === 'dark'
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
              }`}
            title="Download CSV (sessions)"
          >
            <Download size={16} />
            Sessions CSV
          </button>
          <button
            onClick={() => downloadCsv('hints')}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${theme === 'dark'
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
              }`}
            title="Download CSV (hints)"
          >
            <Download size={16} />
            Hints CSV
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className={`rounded-2xl border p-10 text-center ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <div className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center ${theme === 'dark' ? 'bg-zinc-900' : 'bg-gray-100'}`}>
            <Activity size={22} className={theme === 'dark' ? 'text-emerald-300' : 'text-emerald-600'} />
          </div>
          <h3 className={`mt-4 font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Chưa có dữ liệu</h3>
          <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
            Hãy làm vài bài tập và chạy test để hệ thống bắt đầu thống kê.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Điểm trung bình</div>
                  <div className={`mt-1 text-2xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
                    {Math.round(stats.avg)}%
                  </div>
                </div>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${theme === 'dark' ? 'bg-indigo-900/30' : 'bg-indigo-50'}`}>
                  <RadarIcon size={18} className={theme === 'dark' ? 'text-indigo-300' : 'text-indigo-600'} />
                </div>
              </div>
              <div className={`mt-3 text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-600'}`}>
                Mạnh nhất: <span className={theme === 'dark' ? 'text-zinc-300' : 'text-gray-800'}>{stats.best?.topic}</span>
              </div>
            </div>

            <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Tổng lượt luyện</div>
                  <div className={`mt-1 text-2xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
                    {stats.totalAttempts}
                  </div>
                </div>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${theme === 'dark' ? 'bg-emerald-900/20' : 'bg-emerald-50'}`}>
                  <BarChart3 size={18} className={theme === 'dark' ? 'text-emerald-300' : 'text-emerald-600'} />
                </div>
              </div>
              <div className={`mt-3 text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-600'}`}>
                Cần cải thiện: <span className={theme === 'dark' ? 'text-zinc-300' : 'text-gray-800'}>{stats.worst?.topic}</span>
              </div>
            </div>

            <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
              <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Gợi ý</div>
              <div className={`mt-1 text-sm font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>
                Ưu tiên ôn: {stats.worst?.topic}
              </div>
              <p className={`mt-2 text-xs leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                Làm thêm 3–5 bài theo chủ đề này và nhờ “Gợi ý AI” khi bị kẹt để cải thiện nhanh hơn.
              </p>
            </div>
          </div>

          {/* Direction A metrics (time/hints) */}
          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
                <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Số phiên đã giải</div>
                <div className={`mt-1 text-2xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
                  {summary.solved_sessions ?? 0}
                </div>
              </div>
              <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
                <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Thời gian TB</div>
                <div className={`mt-1 text-2xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
                  {summary.avg_time_solved_seconds != null ? `${Math.round(summary.avg_time_solved_seconds / 60)}m` : '—'}
                </div>
              </div>
              <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
                <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Gợi ý TB / bài giải</div>
                <div className={`mt-1 text-2xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
                  {summary.avg_hints_per_solved != null ? summary.avg_hints_per_solved.toFixed(2) : '—'}
                </div>
              </div>
              <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
                <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Tỷ lệ gợi ý hữu ích</div>
                <div className={`mt-1 text-2xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
                  {summary.hint_helpful_rate != null ? `${Math.round(summary.hint_helpful_rate * 100)}%` : '—'}
                </div>
              </div>
            </div>
          )}

          {/* Breakdown table */}
          {(report?.by_concept && report.by_concept.length > 0) && (
            <div className={`border rounded-2xl p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
              <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Theo concept</h3>
              <div className={`mt-3 overflow-x-auto text-sm ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-800'}`}>
                <table className="min-w-full">
                  <thead>
                    <tr className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}>
                      <th className="text-left py-2 pr-4">Concept</th>
                      <th className="text-right py-2 pr-4">Solved</th>
                      <th className="text-right py-2 pr-4">Avg time</th>
                      <th className="text-right py-2 pr-4">Hints</th>
                      <th className="text-right py-2">Helpful</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_concept.map((r) => (
                      <tr key={r.concept} className={theme === 'dark' ? 'border-t border-zinc-800' : 'border-t border-gray-200'}>
                        <td className="py-2 pr-4">{r.concept}</td>
                        <td className="py-2 pr-4 text-right">{r.solved_sessions}</td>
                        <td className="py-2 pr-4 text-right">{r.avg_time_solved_seconds != null ? `${Math.round(r.avg_time_solved_seconds / 60)}m` : '—'}</td>
                        <td className="py-2 pr-4 text-right">{r.avg_hints_per_solved != null ? r.avg_hints_per_solved.toFixed(2) : '—'}</td>
                        <td className="py-2 text-right">{r.hint_helpful_rate != null ? `${Math.round(r.hint_helpful_rate * 100)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className={`border rounded-2xl p-4 shadow-lg ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Độ thành thạo kiến thức</h3>
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                    Mức độ thành thạo theo chủ đề
                  </p>
                </div>
              </div>
              <div className="h-64 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={masteryData}>
                    <PolarGrid stroke={theme === 'dark' ? '#3f3f46' : '#d1d5db'} />
                    <PolarAngleAxis dataKey="topic" tick={{ fill: theme === 'dark' ? '#a1a1aa' : '#6b7280', fontSize: 12 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                      name="Mastery"
                      dataKey="score"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      fill="#8b5cf6"
                      fillOpacity={0.4}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={`border rounded-2xl p-4 shadow-lg ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Hoạt động học tập</h3>
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                    Lượt luyện tập theo chủ đề
                  </p>
                </div>
              </div>
              <div className="h-64 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={masteryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#27272a' : '#e5e7eb'} vertical={false} />
                    <XAxis dataKey="topic" tick={{ fill: theme === 'dark' ? '#71717a' : '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: theme === 'dark' ? '#71717a' : '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff',
                        borderColor: theme === 'dark' ? '#27272a' : '#d1d5db',
                        color: theme === 'dark' ? '#e4e4e7' : '#1f2937'
                      }}
                      itemStyle={{ color: theme === 'dark' ? '#e4e4e7' : '#1f2937' }}
                      cursor={{ fill: theme === 'dark' ? '#27272a' : '#f3f4f6' }}
                    />
                    <Bar dataKey="attempts" fill="#10b981" radius={[6, 6, 0, 0]} name="Attempts" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className={`border rounded-2xl p-4 ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800' : 'bg-gray-50 border-gray-200'}`}>
            <h4 className={`text-sm font-mono mb-2 uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>Ghi chú dữ liệu</h4>
            <div className={`text-xs space-y-1 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
              <p>- Dashboard tổng hợp từ lịch sử nộp bài, số lần thử và mức độ thành thạo theo chủ đề.</p>
              <p>- Nếu chưa có dữ liệu, hãy làm và nộp ít nhất 1 bài để hệ thống bắt đầu ghi nhận.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default KnowledgeDashboard;
