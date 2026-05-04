import React, { useState, useEffect } from 'react';
import {
  TrendingUp, Award, Target, Brain, CheckCircle,
  Circle, Clock, Flame, Star, ChevronRight, ChevronDown, RefreshCw, X
} from 'lucide-react';

interface ProblemTypeStat {
  problemType: string;
  problemTypeVi: string;
  masteryLevel: number;
  practiceCount: number;
  lastPracticed: string;
  successRate: number;
}

interface LearningProgress {
  overallMastery: number;
  totalProblems: number;
  solvedProblems: number;
  currentStreak: number;
  longestStreak: number;
  problemTypesMastered: number;
  totalProblemTypes: number;
  recentActivity: ActivityItem[];
  problemTypeProgress: ProblemTypeStat[];
  weeklyProgress: WeeklyData[];
}

interface ActivityItem {
  id: string;
  type: 'solved' | 'attempted' | 'hint_used' | 'concept_mastered';
  description: string;
  timestamp: string;
  problemId?: number;
}

interface WeeklyData {
  day: string;
  problems: number;
  hints: number;
  timeSpent: number;
}

interface ProgressTrackerProps {
  userId?: number;
  isOpen: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
}

const ProgressTracker: React.FC<ProgressTrackerProps> = ({
  userId,
  isOpen,
  onClose,
  theme
}) => {
  const [progress, setProgress] = useState<LearningProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'concepts' | 'history'>('overview');
  const [expandedConcepts, setExpandedConcepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      fetchProgress();
    }
  }, [isOpen, userId]);

  const fetchProgress = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token') || undefined;
      const { getStudentProgress } = await import('../services/api');
      const data = await getStudentProgress(userId, token);
      setProgress(data);
    } catch (error) {
      console.error('Failed to fetch progress:', error);
      setError('Không tải được dữ liệu tiến độ. Vui lòng thử lại.');
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleConcept = (concept: string) => {
    setExpandedConcepts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(concept)) {
        newSet.delete(concept);
      } else {
        newSet.add(concept);
      }
      return newSet;
    });
  };

  const getMasteryColor = (level: number): string => {
    if (level >= 80) return 'text-green-500';
    if (level >= 60) return 'text-blue-500';
    if (level >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getMasteryBgColor = (level: number): string => {
    if (level >= 80) return 'bg-green-500';
    if (level >= 60) return 'bg-blue-500';
    if (level >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'solved': return <CheckCircle className="text-green-500" size={18} />;
      case 'concept_mastered': return <Star className="text-yellow-500" size={18} />;
      case 'hint_used': return <Brain className="text-blue-500" size={18} />;
      default: return <Circle className="text-gray-400" size={18} />;
    }
  };

  if (!isOpen) return null;

  const bgColor = theme === 'dark' ? 'bg-[#09090b]' : 'bg-gray-50';
  const textColor = theme === 'dark' ? 'text-zinc-100' : 'text-gray-900';
  const secondaryText = theme === 'dark' ? 'text-zinc-400' : 'text-gray-600';
  const borderColor = theme === 'dark' ? 'border-zinc-800' : 'border-gray-200';
  const cardBg = theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-white';

  return (
    <div className={`fixed inset-0 z-50 ${bgColor} ${textColor} overflow-hidden`}>
      <div className="h-full w-full overflow-y-auto">
        {/* Tiêu đề */}
        <div className={`sticky top-0 z-10 border-b ${borderColor} ${theme === 'dark' ? 'bg-[#09090b]/80' : 'bg-gray-50/80'} backdrop-blur`}>
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <TrendingUp size={20} className="text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg md:text-xl font-semibold truncate">Tiến độ học tập</h2>
                <p className={`text-xs md:text-sm ${secondaryText} truncate`}>
                  Theo dõi thành thạo, streak và lịch sử luyện tập.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchProgress}
                className={`px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${theme === 'dark'
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                  : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                  }`}
                title="Tải lại"
              >
                <RefreshCw size={16} />
                <span className="hidden sm:inline">Tải lại</span>
              </button>
              <button
                onClick={onClose}
                className={`px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${theme === 'dark'
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                  : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                  }`}
                title="Đóng"
              >
                <X size={16} />
                <span className="hidden sm:inline">Quay lại</span>
              </button>
            </div>
          </div>
        </div>

        {/* Các tab */}
        <div className="max-w-6xl mx-auto px-4 md:px-8 pt-4">
          <div className={`inline-flex p-1 rounded-xl border ${borderColor} ${theme === 'dark' ? 'bg-zinc-900/50' : 'bg-white'}`}>
            {[
              { id: 'overview', label: 'Tổng quan', icon: Target },
              { id: 'concepts', label: 'Dạng bài', icon: Brain },
              { id: 'history', label: 'Lịch sử', icon: Clock }
            ].map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${isActive
                    ? theme === 'dark'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-600 text-white'
                    : theme === 'dark'
                      ? 'text-zinc-300 hover:bg-zinc-800'
                      : 'text-gray-700 hover:bg-gray-100'
                    }`}
                >
                  <tab.icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Nội dung */}
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          {error && (
            <div className={`mb-4 rounded-xl border p-3 ${theme === 'dark' ? 'bg-yellow-900/10 border-yellow-700/40 text-yellow-200' : 'bg-yellow-50 border-yellow-200 text-yellow-800'}`}>
              <div className="text-sm font-medium">Thông báo</div>
              <div className="text-xs opacity-90">{error}</div>
            </div>
          )}

          {loading && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={`rounded-2xl border p-4 ${borderColor} ${cardBg}`}>
                    <div className={`h-3 w-24 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                    <div className={`mt-3 h-7 w-20 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                    <div className={`mt-3 h-2 w-full rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                  </div>
                ))}
              </div>
              <div className={`rounded-2xl border p-6 ${borderColor} ${cardBg}`}>
                <div className={`h-4 w-40 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                <div className={`mt-4 h-32 w-full rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'}`} />
              </div>
            </div>
          )}

          {!loading && !progress && (
            <div className={`rounded-2xl border p-10 text-center ${borderColor} ${cardBg}`}>
              <div className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center ${theme === 'dark' ? 'bg-zinc-900' : 'bg-gray-100'}`}>
                <TrendingUp size={22} className={theme === 'dark' ? 'text-indigo-300' : 'text-indigo-600'} />
              </div>
              <h3 className="mt-4 font-semibold">Chưa có dữ liệu tiến độ</h3>
              <p className={`mt-1 text-sm ${secondaryText}`}>Hãy làm bài và chạy test để hệ thống ghi nhận tiến độ.</p>
            </div>
          )}

          {!loading && progress && activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Thẻ thống kê */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className={`${cardBg} rounded-2xl p-4 border ${borderColor}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="text-indigo-500" size={20} />
                    <span className={secondaryText}>Độ thành thạo</span>
                  </div>
                  <div className="text-3xl font-bold">{progress.overallMastery}%</div>
                  <div className={`w-full h-2 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'} rounded-full mt-2`}>
                    <div
                      className={`h-full rounded-full ${getMasteryBgColor(progress.overallMastery)}`}
                      style={{ width: `${progress.overallMastery}%` }}
                    />
                  </div>
                </div>

                <div className={`${cardBg} rounded-2xl p-4 border ${borderColor}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="text-green-500" size={20} />
                    <span className={secondaryText}>Bài đã giải</span>
                  </div>
                  <div className="text-3xl font-bold">{progress.solvedProblems}/{progress.totalProblems}</div>
                  <div className={`text-sm ${secondaryText} mt-1`}>
                    {progress.totalProblems > 0 ? Math.round(progress.solvedProblems / progress.totalProblems * 100) : 0}% hoàn thành
                  </div>
                </div>

                <div className={`${cardBg} rounded-2xl p-4 border ${borderColor}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Flame className="text-orange-500" size={20} />
                    <span className={secondaryText}>Streak</span>
                  </div>
                  <div className="text-3xl font-bold">{progress.currentStreak} ngày</div>
                  <div className={`text-sm ${secondaryText} mt-1`}>
                    Kỷ lục: {progress.longestStreak} ngày
                  </div>
                </div>

                <div className={`${cardBg} rounded-2xl p-4 border ${borderColor}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="text-purple-500" size={20} />
                    <span className={secondaryText}>Dạng bài thành thạo</span>
                  </div>
                  <div className="text-3xl font-bold">{progress.problemTypesMastered}/{progress.totalProblemTypes}</div>
                </div>
              </div>

              {/* Biểu đồ tuần */}
              <div className={`${cardBg} rounded-2xl p-6 border ${borderColor}`}>
                <h3 className="font-semibold mb-4">Hoạt động tuần này</h3>
                <p className={`text-sm ${secondaryText} mb-4`}>Số bài đã tương tác mỗi ngày (7 ngày gần nhất).</p>
                <div className="flex items-end justify-between gap-2" style={{ height: 128 }}>
                  {(() => {
                    const CHART_HEIGHT = 120;
                    const days = progress.weeklyProgress || [];
                    const maxProblems = Math.max(...days.map(d => d.problems || 0), 1);
                    return days.map((day, index) => {
                      const v = day.problems || 0;
                      const h = Math.round((v / maxProblems) * CHART_HEIGHT);
                      return (
                        <div key={index} className="flex flex-col items-center gap-2 flex-1">
                          <div
                            className={`w-full max-w-10 rounded-t-md ${theme === 'dark' ? 'bg-indigo-600' : 'bg-indigo-600'}`}
                            style={{ height: `${Math.max(2, h)}px` }}
                            title={`${v} bài • ${day.timeSpent || 0} phút`}
                          />
                          <span className={`text-xs ${secondaryText}`}>{day.day}</span>
                        </div>
                      );
                    })
                  })()}
                </div>
              </div>

              {/* Hoạt động gần đây */}
              <div className={`${cardBg} rounded-2xl p-6 border ${borderColor}`}>
                <h3 className="font-semibold mb-4">Hoạt động gần đây</h3>
                {(progress.recentActivity || []).length === 0 ? (
                  <div className={`text-sm ${secondaryText}`}>Chưa có hoạt động gần đây.</div>
                ) : (
                  <div className="space-y-3">
                    {(progress.recentActivity || []).slice(0, 6).map(activity => (
                      <div key={activity.id} className={`flex items-center gap-3 p-3 rounded-xl border ${borderColor} ${theme === 'dark' ? 'bg-zinc-900/30' : 'bg-gray-50'}`}>
                        {getActivityIcon(activity.type)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{activity.description}</div>
                          <div className={`text-xs ${secondaryText}`}>
                            {new Date(activity.timestamp).toLocaleString('vi-VN')}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!loading && progress && activeTab === 'concepts' && (
            <div className="space-y-4">
              {(() => {
                const sortedProblemTypes = (progress.problemTypeProgress || []).slice().sort((a, b) => (b.masteryLevel || 0) - (a.masteryLevel || 0));
                return sortedProblemTypes.map(pt => (
                  <div key={pt.problemType} className={`${cardBg} rounded-2xl overflow-hidden border ${borderColor}`}>
                    <button
                      onClick={() => toggleConcept(pt.problemType)}
                      className={`w-full p-4 flex items-center justify-between transition-colors ${theme === 'dark' ? 'hover:bg-zinc-900/40' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${getMasteryBgColor(pt.masteryLevel)} bg-opacity-20`}>
                          <span className={`font-bold ${getMasteryColor(pt.masteryLevel)}`}>
                            {pt.masteryLevel}%
                          </span>
                        </div>
                        <div className="text-left">
                          <div className="font-medium">{pt.problemTypeVi}</div>
                          <div className={`text-sm ${secondaryText}`}>
                            {pt.practiceCount} bài luyện tập
                          </div>
                        </div>
                      </div>
                      {expandedConcepts.has(pt.problemType) ?
                        <ChevronDown size={20} /> : <ChevronRight size={20} />
                      }
                    </button>

                    {expandedConcepts.has(pt.problemType) && (
                      <div className={`p-4 border-t ${borderColor}`}>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <div>
                            <div className={`text-sm ${secondaryText}`}>Tỷ lệ thành công</div>
                            <div className="text-lg font-semibold">{pt.successRate}%</div>
                          </div>
                          <div>
                            <div className={`text-sm ${secondaryText}`}>Số bài tập</div>
                            <div className="text-lg font-semibold">{pt.practiceCount}</div>
                          </div>
                          <div>
                            <div className={`text-sm ${secondaryText}`}>Luyện tập gần nhất</div>
                            <div className="text-lg font-semibold">
                              {pt.lastPracticed ? new Date(pt.lastPracticed).toLocaleDateString('vi-VN') : '—'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className={`text-sm ${secondaryText} mb-2`}>Tiến độ</div>
                          <div className={`w-full h-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-200'} rounded-full`}>
                            <div
                              className={`h-full rounded-full transition-all ${getMasteryBgColor(pt.masteryLevel)}`}
                              style={{ width: `${pt.masteryLevel}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          )}

          {!loading && progress && activeTab === 'history' && (
            <div className={`${cardBg} rounded-2xl p-6 border ${borderColor}`}>
              <h3 className="font-semibold mb-4">Lịch sử hoạt động</h3>
              <div className="space-y-4">
                {progress.recentActivity.map(activity => (
                  <div
                    key={activity.id}
                    className={`flex items-start gap-4 p-3 rounded-xl border ${borderColor} ${theme === 'dark' ? 'bg-zinc-900/30' : 'bg-gray-50'
                      }`}
                  >
                    <div className="mt-1">{getActivityIcon(activity.type)}</div>
                    <div className="flex-1">
                      <div className="font-medium">{activity.description}</div>
                      <div className={`text-sm ${secondaryText}`}>
                        {new Date(activity.timestamp).toLocaleString('vi-VN')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProgressTracker;
