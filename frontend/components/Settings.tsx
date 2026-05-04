import React, { useEffect, useMemo, useState } from 'react';
import { User, LogOut, Key, Moon, Sun, Monitor, Copy, Check, Plug, AlertTriangle } from 'lucide-react';
import { API_BASE_URL, getWebSocketUrl } from '../services/api';

interface SettingsProps {
  isLoggedIn: boolean;
  onLogout: () => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  isAdmin: boolean;
}

const Settings: React.FC<SettingsProps> = ({ isLoggedIn, onLogout, theme, onThemeChange, isAdmin }) => {
  const username = isLoggedIn ? localStorage.getItem('username') || 'User' : 'Guest';
  const [copiedKey, setCopiedKey] = useState<'api' | 'ws' | null>(null);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [backendConfig, setBackendConfig] = useState<{ enable_ws_terminal?: boolean } | null>(null);

  const wsUrl = useMemo(() => getWebSocketUrl('/ws/terminal'), []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setBackendStatus('checking');
        const resp = await fetch(`${API_BASE_URL}/health`);
        if (!resp.ok) throw new Error('health not ok');
        if (!cancelled) setBackendStatus('ok');
      } catch {
        if (!cancelled) setBackendStatus('error');
      }

      try {
        const cfg = await fetch(`${API_BASE_URL}/api/config`).then(r => r.json());
        if (!cancelled) setBackendConfig(cfg);
      } catch {
        if (!cancelled) setBackendConfig(null);
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = () => {
    onLogout();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>Cài đặt</h2>
          <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
            Tuỳ chỉnh giao diện, tài khoản và cấu hình kết nối.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className={`border rounded-2xl p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-3 mb-3">
            <Plug size={20} className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'} />
            <h3 className={`font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Kết nối</h3>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className={`text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
              Trạng thái Backend
            </div>
            <div className="flex items-center gap-2">
              {backendStatus === 'checking' && (
                <span className={`text-sm ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-700'}`}>Đang kiểm tra...</span>
              )}
              {backendStatus === 'ok' && (
                <span className="text-sm text-emerald-500">Đã kết nối</span>
              )}
              {backendStatus === 'error' && (
                <span className="flex items-center gap-2 text-sm text-red-500">
                  <AlertTriangle size={16} />
                  Mất kết nối
                </span>
              )}
            </div>
          </div>

          <div className="mt-3 text-sm">
            <div className={`flex items-center justify-between gap-3 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
              <span>WS terminal</span>
              <span className={`${backendConfig?.enable_ws_terminal ? 'text-emerald-500' : 'text-zinc-500'}`}>
                {backendConfig?.enable_ws_terminal ? 'Đã bật' : 'Đã tắt'}
              </span>
            </div>
          </div>
        </div>

        <div className={`border rounded-2xl p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-3 mb-3">
            <User size={20} className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'} />
            <h3 className={`font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Tài khoản</h3>
          </div>

          {isLoggedIn ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>Đăng nhập với tên</p>
                  <p className={`font-medium ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-900'}`}>{username}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors text-sm"
                >
                  <LogOut size={16} />
                  Đăng xuất
                </button>
              </div>
            </div>
          ) : (
            <p className={`text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>Chưa đăng nhập</p>
          )}
        </div>

        <div className={`border rounded-2xl p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-3 mb-3">
            <Monitor size={20} className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'} />
            <h3 className={`font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Giao diện</h3>
          </div>

          <div className="space-y-2">
            <p className={`text-sm mb-2 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>Chủ đề</p>
            <div className={`inline-flex p-1 rounded-xl border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-gray-50'}`}>
              <button
                onClick={() => onThemeChange('dark')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${theme === 'dark'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-700 hover:bg-white'
                  }`}
              >
                <Moon size={16} />
                Tối
              </button>
              <button
                onClick={() => onThemeChange('light')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${theme === 'light'
                    ? 'bg-indigo-600 text-white'
                    : theme === 'dark' ? 'text-zinc-300 hover:bg-zinc-800' : 'text-gray-700 hover:bg-white'
                  }`}
              >
                <Sun size={16} />
                Sáng
              </button>
            </div>
          </div>
        </div>

        {isAdmin && (
        <div className={`border rounded-2xl p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-3 mb-3">
            <Key size={20} className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'} />
            <h3 className={`font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Cấu hình API</h3>
          </div>

          <div className="space-y-2">
            <div>
              <p className={`text-sm mb-1 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>Backend URL</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={API_BASE_URL}
                  className={`flex-1 px-3 py-2 border rounded-lg text-sm ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-gray-50 border-gray-300 text-gray-700'}`}
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(API_BASE_URL);
                      setCopiedKey('api');
                      setTimeout(() => setCopiedKey(null), 900);
                    } catch { }
                  }}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'}`}
                  title="Copy"
                >
                  {copiedKey === 'api' ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
            <div>
              <p className={`text-sm mb-1 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>WebSocket URL</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={wsUrl}
                  className={`flex-1 px-3 py-2 border rounded-lg text-sm ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-gray-50 border-gray-300 text-gray-700'}`}
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(wsUrl);
                      setCopiedKey('ws');
                      setTimeout(() => setCopiedKey(null), 900);
                    } catch { }
                  }}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'}`}
                  title="Copy"
                >
                  {copiedKey === 'ws' ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>
        )}

        <div className={`border rounded-2xl p-4 ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
          <h3 className={`font-semibold mb-2 ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Giới thiệu</h3>
          <div className={`space-y-1 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
            <p>PyTutor AI - Adaptive Learning Platform</p>
            <p>Version 1.0.0</p>
            <p className={`text-xs mt-2 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
              Nền tảng luyện tập và phân tích code theo thời gian thực
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
