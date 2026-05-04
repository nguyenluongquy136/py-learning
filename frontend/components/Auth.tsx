import React, { useMemo, useState } from 'react';
import { API_BASE_URL } from '../services/api';
import { User, Lock, BrainCircuit, Eye, EyeOff, Loader2 } from 'lucide-react';

interface Props {
  onLogin?: () => void;
  onClose?: () => void;
  theme?: 'dark' | 'light';
}

const Auth: React.FC<Props> = ({ onLogin, onClose, theme = 'dark' }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const canSubmit = useMemo(() => {
    return username.trim().length > 0 && password.length > 0 && !isLoading;
  }, [username, password, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      if (isRegister) {
        const r = await fetch(`${API_BASE_URL}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        if (!r.ok) {
          const errorData = await r.json();
          throw new Error(errorData.detail || 'Đăng ký thất bại');
        }

        setSuccess('Đã tạo tài khoản! Vui lòng đăng nhập.');
        setIsRegister(false);
        setPassword('');
      } else {
        const r = await fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        if (!r.ok) {
          const errorData = await r.json();
          throw new Error(errorData.detail || 'Đăng nhập thất bại');
        }

        const data = await r.json();
        const token = data?.access_token;
        if (token) {
          localStorage.setItem('token', token);
          localStorage.setItem('username', username);
          if (onLogin) onLogin();
          if (onClose) onClose();
        }
      }
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className={`relative p-8 rounded-2xl border shadow-2xl overflow-hidden ${theme === 'dark' ? 'bg-[#0f1724] border-zinc-800' : 'bg-white border-gray-200'
        }`}>
        <div className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-30 ${theme === 'dark' ? 'bg-indigo-500' : 'bg-indigo-300'
          }`} />
        <div className={`absolute -bottom-24 -left-24 w-64 h-64 rounded-full blur-3xl opacity-20 ${theme === 'dark' ? 'bg-emerald-500' : 'bg-emerald-300'
          }`} />

        <div className="relative">
          <div className="flex items-center justify-center mb-6">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <BrainCircuit className="text-white" size={32} />
            </div>
          </div>

          <h2 className={`text-2xl font-bold text-center mb-2 ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'
            }`}>
            {isRegister ? 'Tạo tài khoản' : 'Chào mừng trở lại'}
          </h2>
          <p className={`text-center text-sm mb-6 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'
            }`}>
            {isRegister ? 'Bắt đầu hành trình học tập' : 'Tiếp tục học cùng AI'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-700'
                }`}>
                Tên đăng nhập
              </label>
              <div className="relative">
                <User className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-400'
                  }`} size={18} />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:border-indigo-500 transition-colors ${theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-500'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                    }`}
                  placeholder="Nhập tên đăng nhập"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-700'
                }`}>
                Mật khẩu
              </label>
              <div className="relative">
                <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-400'
                  }`} size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  className={`w-full pl-10 pr-10 py-2.5 border rounded-lg focus:outline-none focus:border-indigo-500 transition-colors ${theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-500'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                    }`}
                  placeholder="Nhập mật khẩu"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded transition-colors ${theme === 'dark' ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                    }`}
                  title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className={`p-3 border rounded-lg ${theme === 'dark' ? 'bg-red-900/20 border-red-700' : 'bg-red-50 border-red-300'
                }`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-red-400' : 'text-red-700'
                  }`}>{error}</p>
              </div>
            )}

            {success && (
              <div className={`p-3 border rounded-lg ${theme === 'dark' ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-300'
                }`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-green-400' : 'text-green-700'
                  }`}>{success}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className={`w-full py-2.5 font-medium rounded-lg transition-colors ${!canSubmit
                  ? theme === 'dark' ? 'bg-zinc-700 cursor-not-allowed text-zinc-400' : 'bg-gray-300 cursor-not-allowed text-gray-500'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
            >
              {isLoading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Đang xử lý...
                </span>
              ) : (isRegister ? 'Đăng ký' : 'Đăng nhập')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
                setSuccess(null);
              }}
              className={`text-sm transition-colors ${theme === 'dark' ? 'text-indigo-300 hover:text-indigo-200' : 'text-indigo-600 hover:text-indigo-700'}`}
            >
              {isRegister ? 'Đã có tài khoản? Đăng nhập' : "Chưa có tài khoản? Đăng ký"}
            </button>
          </div>
        </div>
      </div>
      <p className={`mt-4 text-center text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
        Tip: Sau khi đăng nhập, vào “Bài tập” để chọn bài và bắt đầu luyện.
      </p>
    </div>
  );
};

export default Auth;
