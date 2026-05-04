import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../services/api';
import { Users, RefreshCw, ArrowLeft, Shield, User as UserIcon, Search, AlertCircle, Trash2 } from 'lucide-react';

interface User {
  id: number;
  username: string;
  is_admin: number;
  submission_count: number;
}

interface UsersResponse {
  total: number;
  skip: number;
  limit: number;
  items: User[];
}

interface Props {
  theme: 'dark' | 'light';
  token?: string;
  onBack: () => void;
}

const UserManager: React.FC<Props> = ({ theme, token, onBack }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true); setError(null);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const skip = Math.max(page, 0) * Math.max(pageSize, 1);
      const params = new URLSearchParams({ skip: String(skip), limit: String(pageSize) });
      const q = search.trim();
      if (q) params.set('q', q);
      const res = await fetch(`${API_BASE_URL}/api/admin/users?${params.toString()}`, { headers });
      if (!res.ok) throw new Error('Không thể tải danh sách người dùng');
      const data: UsersResponse = await res.json();
      setUsers(data.items || []);
      setTotal(data.total || 0);
    } catch (err: any) { setError(err.message || 'Lỗi'); }
    finally { setLoading(false); }
  };

  const toggleAdmin = async (u: User) => {
    setError(null);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE_URL}/api/admin/users/${u.id}`, {
        method: 'PATCH', headers, body: JSON.stringify({ is_admin: u.is_admin ? 0 : 1 })
      });
      if (!res.ok) throw new Error('Cập nhật thất bại');
      await loadUsers();
    } catch (err: any) { setError(err.message || 'Lỗi'); }
  };

  const deleteUser = async (u: User) => {
    if (!confirm(`Xóa người dùng ${u.username}?`)) return;
    setError(null);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE_URL}/api/admin/users/${u.id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error('Xóa thất bại');
      await loadUsers();
    } catch (err: any) { setError(err.message || 'Lỗi'); }
  };

  const filteredUsers = useMemo(() => users, [users]);

  useEffect(() => {
    // Tải lại khi phân trang thay đổi
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0);
      loadUsers();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
      <div className={`border-b sticky top-0 z-10 backdrop-blur ${theme === 'dark' ? 'border-zinc-800 bg-[#09090b]/80' : 'border-gray-200 bg-gray-50/80'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Users size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-2xl font-bold truncate">Quản lý người dùng</h1>
              <p className={`text-xs md:text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                {total.toLocaleString()} người dùng
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadUsers}
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
              onClick={onBack}
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

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {error && (
          <div className={`rounded-xl border p-3 flex items-start gap-2 ${theme === 'dark' ? 'bg-red-900/10 border-red-800 text-red-200' : 'bg-red-50 border-red-200 text-red-800'}`}>
            <AlertCircle size={18} className="mt-0.5" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        <div className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className={`relative flex items-center border rounded-lg flex-1 min-w-[220px] ${theme === 'dark' ? 'border-zinc-700 bg-zinc-900' : 'border-gray-200 bg-white'}`}>
              <Search size={16} className={`absolute left-3 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-400'}`} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm theo username hoặc ID..."
                className={`w-full pl-9 pr-3 py-2 text-sm outline-none bg-transparent ${theme === 'dark' ? 'text-zinc-200 placeholder-zinc-500' : 'text-gray-800 placeholder-gray-400'}`}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>Hiển thị</span>
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
        </div>

        {loading ? (
          <div className={`rounded-2xl border p-6 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
            <div className={`h-4 w-40 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`h-10 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-100'}`} />
              ))}
            </div>
          </div>
        ) : (
          <div className={`rounded-2xl border ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
            <div className={`px-4 py-3 border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'} flex items-center justify-between`}>
              <div className="text-sm font-semibold">Danh sách</div>
              <div className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                Trang {page + 1} • hiển thị {filteredUsers.length}/{users.length}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className={`text-left text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                    <th className="py-3 px-4 font-medium">Username</th>
                    <th className="py-3 px-4 font-medium">Vai trò</th>
                    <th className="py-3 px-4 font-medium">Bài nộp</th>
                    <th className="py-3 px-4 font-medium text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className={`py-10 px-4 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                        Không tìm thấy người dùng phù hợp.
                      </td>
                    </tr>
                  ) : filteredUsers.map(u => (
                    <tr key={u.id} className={`border-t ${theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-900/40' : 'border-gray-100 hover:bg-gray-50'}`}>
                      <td className="py-3 px-4 font-medium">{u.username}</td>
                      <td className="py-3 px-4">
                        {u.is_admin ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-indigo-600 text-white">
                            <Shield size={12} />
                            Admin
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${theme === 'dark' ? 'bg-zinc-800 text-zinc-300' : 'bg-gray-100 text-gray-700'}`}>
                            <UserIcon size={12} />
                            Người dùng
                          </span>
                        )}
                      </td>
                      <td className={`py-3 px-4 text-sm ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>{u.submission_count}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => toggleAdmin(u)}
                          className={`mr-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${u.is_admin
                            ? theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                            }`}
                        >
                          {u.is_admin ? 'Hạ quyền' : 'Thăng quyền'}
                        </button>
                        <button
                          onClick={() => deleteUser(u)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors inline-flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          Xóa
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`px-4 py-3 border-t flex items-center justify-between ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
              <div className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-600'}`}>
                Trang {page + 1}/{Math.max(1, Math.ceil(total / pageSize))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${page <= 0
                      ? theme === 'dark' ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : theme === 'dark' ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50'
                    }`}
                >
                  Trước
                </button>
                <button
                  disabled={(page + 1) >= Math.max(1, Math.ceil(total / pageSize))}
                  onClick={() => setPage(p => p + 1)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${(page + 1) >= Math.max(1, Math.ceil(total / pageSize))
                      ? theme === 'dark' ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : theme === 'dark' ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50'
                    }`}
                >
                  Tiếp
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div >
  );
};

export default UserManager;
