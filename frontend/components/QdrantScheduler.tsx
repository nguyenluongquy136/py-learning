import React, { useState, useEffect } from 'react';
import { Calendar, Play, Pause, Settings, Database, Clock, CheckCircle, AlertCircle, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { API_BASE_URL } from '../services/api';

interface SchedulerConfig {
  auto_chunk_enabled: boolean;
  auto_chunk_interval_hours: number;
  auto_chunk_limit: number;
  is_running: boolean;
  total_schedules: number;
  pending_schedules: number;
  running_schedules: number;
}

interface ChunkingSchedule {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  is_passed_only: boolean;
  problem_id: string | null;
  limit: number;
  submissions_processed: number;
  points_created: number;
  error_message: string | null;
  scheduled_at?: string | null;
}

interface QdrantSchedulerProps {
  theme: 'dark' | 'light';
  token?: string;
  onBack: () => void;
}

const QdrantScheduler: React.FC<QdrantSchedulerProps> = ({ theme, token, onBack }) => {
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [schedules, setSchedules] = useState<ChunkingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Trạng thái chỉnh config (chỉ phục vụ UI)
  const [editingConfig, setEditingConfig] = useState(false);
  const [tempEnabled, setTempEnabled] = useState(true);
  const [tempInterval, setTempInterval] = useState(6);
  const [tempLimit, setTempLimit] = useState(500);

  // Tạo schedule thủ công
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [scheduleName, setScheduleName] = useState('');
  const [schedulePassedOnly, setSchedulePassedOnly] = useState(true);
  const [scheduleLimit, setScheduleLimit] = useState(100);
  const [scheduleScheduledAt, setScheduleScheduledAt] = useState<string | null>(null);

  // Import trực tiếp vào Qdrant (CSV)
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [problemsList, setProblemsList] = useState<Array<{ id: number, title: string }>>([]);
  const [selectedProblem, setSelectedProblem] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{
    import_id: string;
    status: string;
    total: number;
    processed: number;
    imported: number;
    errors: string[];
  } | null>(null);
  const [importPolling, setImportPolling] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadData();
    loadData();
    // const interval = setInterval(loadData, 10000); // Tự refresh mỗi 10s
    // return () => clearInterval(interval);
  }, []);

  // Cleanup polling khi component unmount
  useEffect(() => {
    return () => {
      if (importPolling) {
        clearInterval(importPolling);
      }
    };
  }, [importPolling]);

  useEffect(() => {
    // Load danh sách bài (tuỳ chọn) để gắn problem_id khi import
    (async () => {
      try {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE_URL}/api/admin/problems/options`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        // Endpoint returns array directly
        setProblemsList(data);
      } catch (e) { }
    })();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Load config
      const configRes = await fetch(`${API_BASE_URL}/api/admin/scheduler/config`, { headers });
      if (!configRes.ok) throw new Error('Failed to load scheduler config');
      const configData = await configRes.json();
      setConfig(configData);
      setTempEnabled(configData.auto_chunk_enabled);
      setTempInterval(configData.auto_chunk_interval_hours);
      setTempLimit(configData.auto_chunk_limit);

      // Load schedules
      const schedulesRes = await fetch(`${API_BASE_URL}/api/admin/scheduler/schedules?limit=20`, { headers });
      if (!schedulesRes.ok) throw new Error('Failed to load schedules');
      const schedulesData = await schedulesRes.json();
      setSchedules(schedulesData.schedules || []);

    } catch (err: any) {
      setError(err.message || 'Failed to load scheduler data');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/api/admin/scheduler/config`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          auto_chunk_enabled: tempEnabled,
          auto_chunk_interval_hours: tempInterval,
          auto_chunk_limit: tempLimit
        })
      });

      if (!res.ok) throw new Error('Failed to update config');

      setSuccess('Scheduler config updated!');
      setEditingConfig(false);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update config');
    }
  };

  const createSchedule = async () => {
    if (!scheduleName.trim()) {
      setError('Schedule name is required');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/api/admin/scheduler/schedules`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: scheduleName,
          is_passed_only: schedulePassedOnly,
          limit: scheduleLimit,
          scheduled_at: scheduleScheduledAt || null
        })
      });

      if (!res.ok) throw new Error('Failed to create schedule');

      setSuccess('Schedule created and scheduled!');
      setShowCreateSchedule(false);
      setScheduleName('');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create schedule');
    }
  };

  const chunkNow = async () => {
    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/api/admin/qdrant/chunk-submissions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          is_passed_only: false,
          limit: 100
        })
      });

      if (!res.ok) throw new Error('Failed to chunk submissions');

      const data = await res.json();
      setSuccess(`Chunked ${data.submissions_processed} submissions into ${data.chunked_count} points!`);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to chunk submissions');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-500';
      case 'running': return 'text-blue-500';
      case 'failed': return 'text-red-500';
      case 'pending': return 'text-yellow-500';
      default: return 'text-zinc-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle size={16} />;
      case 'running': return <Loader2 size={16} className="animate-spin" />;
      case 'failed': return <AlertCircle size={16} />;
      case 'pending': return <Clock size={16} />;
      default: return null;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const cancelSchedule = async (scheduleId: string) => {
    if (!confirm('Bạn có chắc chắn muốn hủy lịch này?')) return;

    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/api/admin/scheduler/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Không thể hủy lịch');
      }

      setSuccess('Đã hủy lịch thành công!');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Không thể hủy lịch');
    }
  };

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header with Glassmorphism */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b transition-colors duration-300 ${theme === 'dark' ? 'border-white/10 bg-[#09090b]/80' : 'border-gray-200/50 bg-white/70'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
                  <Database className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight">Qdrant Scheduler</h1>
                  <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Quản lý RAG & Knowledge Base</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={loadData}
                disabled={loading}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 active:scale-95 ${theme === 'dark'
                  ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
                  : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-sm'
                  }`}
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                Làm mới
              </button>

              <button
                onClick={chunkNow}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-emerald-500/25 transition-all duration-200 active:scale-95"
              >
                <Play size={16} />
                Chạy Chunking
              </button>

              <button
                onClick={() => {
                  // Reset state trước khi mở modal
                  setImportFile(null);
                  setImportProgress(null);
                  setSelectedProblem(null);
                  if (importPolling) clearInterval(importPolling);
                  setImportPolling(null);
                  setShowImportModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-indigo-500/25 transition-all duration-200 active:scale-95"
              >
                <Database size={16} />
                Import Dữ liệu
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-500 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {success && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-emerald-500 animate-in fade-in slide-in-from-top-2">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{success}</span>
          </div>
        )}

        {/* Stats & Config Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Config Card */}
          <div className={`col-span-1 lg:col-span-2 rounded-2xl border backdrop-blur-md transition-all ${theme === 'dark' ? 'bg-gray-800/40 border-white/10' : 'bg-white/60 border-gray-200/60 shadow-sm'}`}>
            <div className={`p-5 border-b flex items-center justify-between ${theme === 'dark' ? 'border-white/5' : 'border-gray-100'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                  <Settings className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-semibold">Cấu hình hệ thống</h2>
              </div>
              {!editingConfig ? (
                <button
                  onClick={() => setEditingConfig(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors"
                >
                  Chỉnh sửa
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={saveConfig} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors">Lưu</button>
                  <button onClick={() => setEditingConfig(false)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-500/10 text-gray-500 hover:bg-gray-500/20 transition-colors">Hủy</button>
                </div>
              )}
            </div>

            <div className="p-6">
              {config ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div>
                      <label className={`text-xs uppercase font-bold tracking-wider mb-2 block ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        Tự động Chunking
                      </label>
                      {editingConfig ? (
                        <select
                          value={tempEnabled ? 'enabled' : 'disabled'}
                          onChange={(e) => setTempEnabled(e.target.value === 'enabled')}
                          className={`w-full px-3 py-2 rounded-lg border outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all ${theme === 'dark' ? 'bg-gray-900/50 border-white/10 focus:border-indigo-500/50' : 'bg-white border-gray-200'}`}
                        >
                          <option value="enabled">Bật (Enabled)</option>
                          <option value="disabled">Tắt (Disabled)</option>
                        </select>
                      ) : (
                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border ${config.auto_chunk_enabled ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-gray-500/10 text-gray-500 border-gray-500/20'}`}>
                          <div className={`w-2 h-2 rounded-full ${config.auto_chunk_enabled ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                          {config.auto_chunk_enabled ? 'Đang bật' : 'Đang tắt'}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={`text-xs uppercase font-bold tracking-wider mb-2 block ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        Trạng thái tiến trình
                      </label>
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border ${config.is_running ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'}`}>
                        <div className={`w-2 h-2 rounded-full animate-pulse ${config.is_running ? 'bg-blue-500' : 'bg-amber-500'}`} />
                        {config.is_running ? 'Hệ thống đang chạy' : 'Đang chờ tác vụ'}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className={`text-xs uppercase font-bold tracking-wider mb-2 block ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        Chu kỳ tự động (Giờ)
                      </label>
                      {editingConfig ? (
                        <input
                          type="number"
                          value={tempInterval}
                          onChange={(e) => setTempInterval(parseInt(e.target.value))}
                          min={1}
                          className={`w-full px-3 py-2 rounded-lg border outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all ${theme === 'dark' ? 'bg-gray-900/50 border-white/10 focus:border-indigo-500/50' : 'bg-white border-gray-200'}`}
                        />
                      ) : (
                        <div className={`text-2xl font-mono font-medium ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                          {config.auto_chunk_interval_hours} <span className="text-sm text-gray-500">giờ/lần</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={`text-xs uppercase font-bold tracking-wider mb-2 block ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        Batch Size (Record/Lần)
                      </label>
                      {editingConfig ? (
                        <input
                          type="number"
                          value={tempLimit}
                          onChange={(e) => setTempLimit(parseInt(e.target.value))}
                          min={1}
                          className={`w-full px-3 py-2 rounded-lg border outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all ${theme === 'dark' ? 'bg-gray-900/50 border-white/10 focus:border-indigo-500/50' : 'bg-white border-gray-200'}`}
                        />
                      ) : (
                        <div className={`text-2xl font-mono font-medium ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                          {config.auto_chunk_limit} <span className="text-sm text-gray-500">bài nộp</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-10 opacity-50">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Quick Stats Cards */}
          <div className="space-y-4">
            {[
              { label: 'Tổng số Lịch', value: config?.total_schedules, icon: Calendar, color: 'text-purple-500', bg: 'bg-purple-500/10' },
              { label: 'Đang chờ', value: config?.pending_schedules, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
              { label: 'Đang chạy', value: config?.running_schedules, icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            ].map((stat, i) => (
              <div key={i} className={`p-4 rounded-2xl border backdrop-blur-md flex items-center justify-between transition-transform hover:scale-[1.02] ${theme === 'dark' ? 'bg-gray-800/40 border-white/10' : 'bg-white/60 border-gray-200/60 shadow-sm'}`}>
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                    <stat.icon size={20} className={stat.label === 'Đang chạy' && config?.running_schedules ? 'animate-spin' : ''} />
                  </div>
                  <div>
                    <div className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{stat.label}</div>
                    <div className="text-2xl font-bold tracking-tight">{stat.value ?? '-'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Schedules Table */}
        <div className={`rounded-2xl border backdrop-blur-xl overflow-hidden ${theme === 'dark' ? 'bg-gray-800/40 border-white/10' : 'bg-white/80 border-gray-200/60 shadow-sm'}`}>
          <div className={`p-6 border-b flex items-center justify-between ${theme === 'dark' ? 'border-white/5' : 'border-gray-100'}`}>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block"></span>
              Lịch sử thực thi
            </h2>
            <button
              onClick={() => setShowCreateSchedule(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-all active:scale-95 shadow-lg shadow-indigo-600/20"
            >
              + Tạo lịch mới
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`text-xs uppercase tracking-wider ${theme === 'dark' ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                  <th className="text-left py-4 px-6 font-semibold">Trạng thái</th>
                  <th className="text-left py-4 px-6 font-semibold">Tên Job</th>
                  <th className="text-left py-4 px-6 font-semibold">Thời gian</th>
                  <th className="text-left py-4 px-6 font-semibold">Processed</th>
                  <th className="text-left py-4 px-6 font-semibold">Points</th>
                  <th className="text-center py-4 px-6 font-semibold">Thao tác</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${theme === 'dark' ? 'divide-white/5' : 'divide-gray-100'}`}>
                {loading && schedules.length === 0 ? (
                  [...Array(3)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="py-4 px-6">
                        <div className={`h-8 rounded ${theme === 'dark' ? 'bg-white/5' : 'bg-gray-100'} animate-pulse`} />
                      </td>
                    </tr>
                  ))
                ) : schedules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-gray-500 text-sm">
                      Chưa có dữ liệu nào.
                    </td>
                  </tr>
                ) : (
                  schedules.map((schedule) => (
                    <tr
                      key={schedule.id}
                      className={`group transition-colors ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}
                    >
                      <td className="py-4 px-6">
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${schedule.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                          schedule.status === 'running' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                            schedule.status === 'failed' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                              'bg-amber-500/10 text-amber-500 border-amber-500/20'
                          }`}>
                          {getStatusIcon(schedule.status)}
                          <span className="capitalize">{schedule.status}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm font-medium">{schedule.name}</td>
                      <td className="py-4 px-6 text-sm text-gray-500 font-mono text-xs">
                        <div>{formatDate(schedule.created_at)}</div>
                        {schedule.scheduled_at && <div className="text-indigo-400">Scheduled: {formatDate(schedule.scheduled_at)}</div>}
                      </td>
                      <td className="py-4 px-6 text-sm">
                        <span className={`font-mono ${schedule.submissions_processed > 0 ? 'text-indigo-500' : 'text-gray-400'}`}>
                          {schedule.submissions_processed}
                        </span>
                        <span className="text-gray-500 text-xs ml-1">items</span>
                      </td>
                      <td className="py-4 px-6 text-sm">
                        <span className={`font-mono font-bold ${schedule.points_created > 0 ? 'text-emerald-500' : 'text-gray-400'}`}>
                          +{schedule.points_created}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        {schedule.status === 'pending' ? (
                          <button
                            onClick={() => cancelSchedule(schedule.id)}
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/20 transition-colors"
                            title="Hủy lịch"
                          >
                            <Trash2 size={16} />
                          </button>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modern Modal Wrapper */}
      {(showCreateSchedule || showImportModal) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => { setShowCreateSchedule(false); setShowImportModal(false); }}
          />

          {/* Modal Content */}
          <div className={`relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border transform transition-all scale-100 ${theme === 'dark' ? 'bg-gray-900 border-white/10' : 'bg-white border-gray-100'}`}>

            {showCreateSchedule ? (
              <div className="p-6 space-y-5">
                <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-600">
                  Tạo lịch Chunking mới
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Tên Schedule</label>
                    <input
                      type="text"
                      placeholder="Ví dụ: Daily Chunking - Easy Problems"
                      value={scheduleName}
                      onChange={e => setScheduleName(e.target.value)}
                      className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all ${theme === 'dark' ? 'bg-gray-800 border-white/10 focus:border-indigo-500/50' : 'bg-gray-50 border-gray-200'}`}
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Số lượng tối đa</label>
                      <input
                        type="number"
                        value={scheduleLimit}
                        onChange={e => setScheduleLimit(parseInt(e.target.value))}
                        className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all ${theme === 'dark' ? 'bg-gray-800 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Thời gian (Optional)</label>
                      <input
                        type="datetime-local"
                        value={scheduleScheduledAt || ''}
                        onChange={e => setScheduleScheduledAt(e.target.value)}
                        className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm ${theme === 'dark' ? 'bg-gray-800 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                      />
                    </div>
                  </div>
                  <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${theme === 'dark' ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={schedulePassedOnly}
                      onChange={e => setSchedulePassedOnly(e.target.checked)}
                      className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Chỉ bài nộp đã Passed</div>
                      <div className="text-xs text-gray-500">Giới hạn chỉ xử lý các submission đúng (Recommended)</div>
                    </div>
                  </label>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={createSchedule} className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-medium shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all active:scale-95">
                    Xác nhận tạo
                  </button>
                  <button onClick={() => setShowCreateSchedule(false)} className={`px-5 py-2.5 rounded-xl font-medium transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-100 hover:bg-gray-200'}`}>
                    Hủy
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-5">
                <div className="flex items-center gap-4 mb-2">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                    <Database size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Import Dữ liệu</h3>
                    <p className="text-sm text-gray-500">Tải lên file CSV/JSON để training Qdrant</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Chọn bài tập (Optional)</label>
                    <select
                      value={selectedProblem || ''}
                      onChange={(e) => setSelectedProblem(e.target.value || null)}
                      className={`w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-blue-500/50 ${theme === 'dark' ? 'bg-gray-800 border-white/10' : 'bg-gray-50 border-gray-200'} scrollbar-thin`}
                    >
                      <option value="">-- Tự động nhận diện từ File --</option>
                      {problemsList.map(p => (
                        <option key={p.id} value={String(p.id)}>
                          #{p.id} - {p.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${theme === 'dark' ? 'border-white/10 hover:border-blue-500/50 hover:bg-blue-500/5' : 'border-gray-200 hover:border-blue-500/50 hover:bg-blue-50'}`}>
                    <input
                      type="file"
                      id="fileImport"
                      className="hidden"
                      accept=".csv,.jsonl,.json,.py,.txt"
                      onChange={(e) => setImportFile(e.target.files ? e.target.files[0] : null)}
                    />
                    <label htmlFor="fileImport" className="cursor-pointer block">
                      {importFile ? (
                        <div className="text-blue-500 font-medium break-all">
                          {importFile.name}
                        </div>
                      ) : (
                        <>
                          <div className="text-gray-400 mb-2">Click để chọn file</div>
                          <div className="text-xs text-gray-500">Hỗ trợ .csv, .jsonl, .txt</div>
                        </>
                      )}
                    </label>
                  </div>

                  {importProgress && (
                    <div className="bg-gray-500/5 rounded-xl p-4 space-y-3">
                      <div className="flex justify-between text-sm font-medium">
                        <span>Trạng thái:
                          <span className={
                            importProgress.status === 'completed' ? 'text-emerald-500 ml-1' :
                              importProgress.status === 'failed' ? 'text-red-500 ml-1' : 'text-blue-500 ml-1'
                          }>
                            {importProgress.status.toUpperCase()}
                          </span>
                        </span>
                        <span>{Math.round((importProgress.processed / (importProgress.total || 1)) * 100)}%</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${importProgress.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'}`}
                          style={{ width: `${(importProgress.processed / (importProgress.total || 1)) * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Processed: {importProgress.processed}/{importProgress.total}</span>
                        <span>Imported: {importProgress.imported}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={async () => {
                      // Re-use logic from previous version, adapted for UI
                      if (!importFile) { setError('Chưa chọn file'); return; }
                      if (importProgress && importProgress.status === 'processing') return;
                      setError(null); setSuccess(null); setImportProgress(null);
                      try {
                        const form = new FormData();
                        form.append('file', importFile);
                        if (selectedProblem) form.append('problem_id', selectedProblem);
                        const headers: Record<string, string> = {};
                        if (token) headers['Authorization'] = `Bearer ${token}`;
                        const res = await fetch(`${API_BASE_URL}/api/admin/qdrant/import`, { method: 'POST', headers, body: form });
                        if (!res.ok) { const txt = await res.text(); throw new Error(txt || 'Import thất bại'); }
                        const data = await res.json();

                        setImportProgress({
                          import_id: data.import_id,
                          status: 'processing',
                          total: data.total,
                          processed: 0,
                          imported: 0,
                          errors: []
                        });

                        const pollProgress = async () => {
                          try {
                            const progressRes = await fetch(`${API_BASE_URL}/api/admin/qdrant/import/${data.import_id}/progress`, { headers });
                            if (progressRes.ok) {
                              const progressData = await progressRes.json();
                              setImportProgress(progressData);
                              if (progressData.status === 'completed' || progressData.status === 'failed') {
                                clearInterval(interval);
                                setImportPolling(null);
                                setSuccess(`Hoàn tất: ${progressData.imported} chunks.`);
                                if (progressData.status === 'completed') {
                                  setTimeout(() => {
                                    setShowImportModal(false);
                                    setImportFile(null);
                                    setImportProgress(null);
                                    loadData();
                                  }, 1000);
                                }
                              }
                            } else if (progressRes.status === 404) {
                              // Import ID không tồn tại, dừng polling
                              clearInterval(interval);
                              setImportPolling(null);
                              setImportProgress(null);
                              console.warn('Import ID not found, stopping poll');
                            }
                          } catch (e) {
                            console.error(e);
                            // Dừng polling nếu có lỗi nghiêm trọng
                            clearInterval(interval);
                            setImportPolling(null);
                          }
                        };
                        const interval = setInterval(pollProgress, 2000);
                        setImportPolling(interval);
                        pollProgress();
                      } catch (err: any) { setError(err.message); }
                    }}
                    disabled={importProgress?.status === 'processing'}
                    className={`flex-1 py-2.5 rounded-xl font-medium text-white shadow-lg transition-all active:scale-95 ${importProgress?.status === 'processing' ? 'bg-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-cyan-600 shadow-blue-500/25 hover:shadow-blue-500/40'}`}
                  >
                    {importProgress?.status === 'processing' ? <Loader2 className="animate-spin mx-auto" /> : 'Bắt đầu Import'}
                  </button>
                  <button onClick={() => {
                    setShowImportModal(false);
                    setImportFile(null);
                    setImportProgress(null);
                    if (importPolling) { clearInterval(importPolling); setImportPolling(null); }
                  }} className={`px-5 py-2.5 rounded-xl font-medium transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-100 hover:bg-gray-200'}`}>
                    Đóng
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default QdrantScheduler;
