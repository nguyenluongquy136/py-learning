import React, { useState, useEffect } from 'react';
import { Users, FileCode, Database, Activity, Calendar, TrendingUp, Shield, AlertCircle, RefreshCw, ArrowLeft, FileText, Tag } from 'lucide-react';
import { API_BASE_URL } from '../services/api';

interface SystemStats {
  users_total: number;
  users_admin: number;
  problems_total: number;
  submissions_total: number;
  submissions_passed: number;
  qdrant_points: number;
  qdrant_collections: any;
}

interface User {
  id: number;
  username: string;
  is_admin: number;
  submission_count: number;
}

interface AdminDashboardProps {
  theme: 'dark' | 'light';
  token?: string;
  onNavigate: (view: 'dashboard' | 'users' | 'problems' | 'scheduler') => void;
  onBack?: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ theme, token, onNavigate, onBack }) => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Tải thống kê
      const statsRes = await fetch(`${API_BASE_URL}/api/admin/stats`, { headers });
      if (!statsRes.ok) throw new Error('Failed to load stats');
      const statsData = await statsRes.json();
      setStats(statsData);

      // Tải người dùng gần đây
      const usersRes = await fetch(`${API_BASE_URL}/api/admin/users?limit=10&skip=0`, { headers });
      if (!usersRes.ok) throw new Error('Failed to load users');
      const usersData = await usersRes.json();
      setUsers(usersData.items || []);

    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className={`rounded-2xl border p-10 text-center ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
            <Activity className="w-10 h-10 animate-spin mx-auto mb-4 text-indigo-500" />
            <div className="text-sm font-medium">Đang tải giao diện quản trị…</div>
            <div className={`text-xs mt-1 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>Vui lòng chờ trong giây lát.</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className={`rounded-2xl border p-10 text-center ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
            <AlertCircle className="w-10 h-10 mx-auto mb-4 text-red-500" />
            <div className="text-sm font-semibold">Không tải được dữ liệu Admin</div>
            <div className={`text-xs mt-1 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>{error}</div>
            <button
              onClick={loadDashboardData}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
            >
              <RefreshCw size={16} />
              Thử lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  const passRate = stats && stats.submissions_total > 0
    ? ((stats.submissions_passed / stats.submissions_total) * 100).toFixed(1)
    : '0.0';

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header */}
      <div className={`border-b sticky top-0 z-10 backdrop-blur ${theme === 'dark' ? 'border-zinc-800 bg-[#09090b]/80' : 'border-gray-200 bg-gray-50/80'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-2xl font-bold">Bảng điều khiển Admin</h1>
            </div>
            <div className="flex items-center gap-3">
              {onBack && (
                <button
                  onClick={onBack}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'}`}
                >
                  <ArrowLeft size={16} />
                  Quay lại
                </button>
              )}
              <button
                onClick={loadDashboardData}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
              >
                <RefreshCw size={16} />
                Làm mới
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Tổng người dùng"
            value={stats?.users_total || 0}
            subtitle={`${stats?.users_admin || 0} quản trị viên`}
            icon={<Users className="w-6 h-6" />}
            color="blue"
            theme={theme}
            onClick={() => onNavigate('users')}
          />

          <StatCard
            title="Bài tập"
            value={stats?.problems_total || 0}
            subtitle="Bài tập lập trình"
            icon={<FileCode className="w-6 h-6" />}
            color="green"
            theme={theme}
            onClick={() => onNavigate('problems')}
          />

          <StatCard
            title="Bài nộp"
            value={stats?.submissions_total || 0}
            subtitle={`${passRate}% tỷ lệ đạt`}
            icon={<TrendingUp className="w-6 h-6" />}
            color="purple"
            theme={theme}
          />

          <StatCard
            title="Điểm Qdrant"
            value={stats?.qdrant_points || 0}
            subtitle="Cơ sở tri thức"
            icon={<Database className="w-6 h-6" />}
            color="orange"
            theme={theme}
            onClick={() => onNavigate('scheduler')}
          />
        </div>

        {/* Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <NavCard
            title="Quản lý người dùng"
            description="Xem và quản lý tài khoản người dùng, chuyển quyền quản trị"
            icon={<Users className="w-8 h-8" />}
            color="blue"
            theme={theme}
            onClick={() => onNavigate('users')}
          />

          <NavCard
            title="Quản lý bài tập"
            description="Tạo, sửa và xóa bài tập lập trình"
            icon={<FileCode className="w-8 h-8" />}
            color="green"
            theme={theme}
            onClick={() => onNavigate('problems')}
          />

          <NavCard
            title="Loại bài tập"
            description="Quản lý danh mục/thể loại bài tập"
            icon={<Tag className="w-8 h-8" />}
            color="purple"
            theme={theme}
            onClick={() => onNavigate('problem-types' as any)}
          />

          <NavCard
            title="Bài nộp"
            description="Xem danh sách submissions, lọc theo trạng thái pass/fail"
            icon={<FileText className="w-8 h-8" />}
            color="blue"
            theme={theme}
            onClick={() => onNavigate('submissions' as any)}
          />

          <NavCard
            title="Lịch Qdrant"
            description="Lên lịch và quản lý việc chunk dữ liệu vào Qdrant"
            icon={<Calendar className="w-8 h-8" />}
            color="purple"
            theme={theme}
            onClick={() => onNavigate('scheduler')}
          />
        </div>

        {/* Recent Users */}
        <div className={`rounded-2xl border ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'} p-6`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Người dùng gần đây</h2>
            <button
              onClick={() => onNavigate('users')}
              className="text-indigo-400 hover:text-indigo-300 text-sm"
            >
              Xem tất cả →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className={`border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
                  <th className="text-left py-2 px-3 text-sm font-medium">Username</th>
                  <th className="text-left py-2 px-3 text-sm font-medium">Vai trò</th>
                  <th className="text-left py-2 px-3 text-sm font-medium">Bài nộp</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={3} className={`py-6 px-3 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                      Chưa có người dùng nào.
                    </td>
                  </tr>
                ) : users.map((user) => (
                  <tr
                    key={user.id}
                    className={`border-b ${theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-800/50' : 'border-gray-100 hover:bg-gray-50'}`}
                  >
                    <td className="py-3 px-3 font-medium">{user.username}</td>
                    <td className="py-3 px-3">
                      {user.is_admin ? (
                        <span className="px-2 py-1 bg-indigo-600 text-white text-xs rounded-lg">Quản trị</span>
                      ) : (
                        <span className={`px-2 py-1 text-xs rounded-lg ${theme === 'dark' ? 'bg-zinc-800 text-zinc-300' : 'bg-gray-100 text-gray-700'}`}>Người dùng</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-sm">{user.submission_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Qdrant Info */}
        {stats?.qdrant_collections && (
          <div className={`rounded-2xl border ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'} p-6`}>
            <h2 className="text-xl font-semibold mb-4">Bộ sưu tập Qdrant</h2>
            <pre className={`text-sm overflow-auto p-4 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-100'}`}>
              {JSON.stringify(stats.qdrant_collections, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

// Stat Card Component
interface StatCardProps {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'orange';
  theme: 'dark' | 'light';
  onClick?: () => void;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, color, theme, onClick }) => {
  const colorClasses = {
    blue: 'bg-indigo-600',
    green: 'bg-green-600',
    purple: 'bg-purple-600',
    orange: 'bg-orange-600'
  };

  return (
    <div
      className={`rounded-2xl border p-6 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'} ${onClick ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]} text-white`}>
          {icon}
        </div>
      </div>
      <h3 className="text-3xl font-bold mb-1">{value.toLocaleString()}</h3>
      <p className={`text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>{title}</p>
      <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>{subtitle}</p>
    </div>
  );
};

// Navigation Card Component
interface NavCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple';
  theme: 'dark' | 'light';
  onClick: () => void;
}

const NavCard: React.FC<NavCardProps> = ({ title, description, icon, color, theme, onClick }) => {
  const colorClasses = {
    blue: 'border-indigo-500 hover:border-indigo-400',
    green: 'border-green-500 hover:border-green-400',
    purple: 'border-purple-500 hover:border-purple-400'
  };
  const iconColor = {
    blue: 'text-indigo-500',
    green: 'text-green-500',
    purple: 'text-purple-500'
  }[color];

  return (
    <div
      className={`rounded-2xl border-2 p-6 cursor-pointer transition-all ${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-white'} ${colorClasses[color]}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={iconColor}>{icon}</div>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <p className={`text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>{description}</p>
    </div>
  );
};

export default AdminDashboard;
