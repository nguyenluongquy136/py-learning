import React from 'react';
import { LearningNode } from '../types';
import { Lock, Check, Zap, ArrowRight } from 'lucide-react';

interface LearningMapProps {
  nodes: LearningNode[];
  theme?: 'dark' | 'light';
}

const LearningMap: React.FC<LearningMapProps> = ({ nodes, theme = 'dark' }) => {
  const isEmpty = !nodes || nodes.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <div className="mb-6 md:mb-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className={`text-xl md:text-2xl font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-900'}`}>
                Lộ trình học tập
              </h2>
              <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                Lộ trình học được đề xuất dựa trên tiến độ và mức độ thành thạo của bạn.
              </p>
            </div>
            <div className={`flex items-center gap-2 text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-white'}`}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-600 text-white">
                  <Check size={12} />
                </span>
                Hoàn thành
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-white'}`}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white">
                  <Zap size={12} />
                </span>
                Hiện tại
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-white'}`}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-700 text-white">
                  <ArrowRight size={12} />
                </span>
                Có sẵn
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-white'}`}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-800 text-white">
                  <Lock size={12} />
                </span>
                Đã khóa
              </span>
            </div>
          </div>
        </div>

        {isEmpty ? (
          <div className={`rounded-2xl border p-10 text-center ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-200'}`}>
            <div className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center ${theme === 'dark' ? 'bg-zinc-900' : 'bg-gray-100'}`}>
              <Zap size={22} className={theme === 'dark' ? 'text-indigo-300' : 'text-indigo-600'} />
            </div>
            <h3 className={`mt-4 font-semibold ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>Chưa có lộ trình</h3>
            <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
              Lộ trình sẽ xuất hiện khi hệ thống có đủ dữ liệu để đề xuất các bước học tiếp theo.
            </p>
          </div>
        ) : (
          <div className="relative">
            <div className={`absolute left-5 top-6 bottom-6 w-0.5 -z-10 md:left-0 md:right-0 md:top-1/2 md:bottom-auto md:w-auto md:h-0.5 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-gray-300'}`}></div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              {nodes.map((node, index) => (
                <div
                  key={node.id}
                  className={`
                    relative p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center text-center gap-3
                    ${node.status === 'current' ? `border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)] scale-[1.02] ${theme === 'dark' ? 'bg-blue-900/10' : 'bg-blue-50'}` : ''}
                    ${node.status === 'completed' ? `${theme === 'dark' ? 'border-green-600/50 bg-green-900/5' : 'border-green-500 bg-green-50'}` : ''}
                    ${node.status === 'available' ? `${theme === 'dark' ? 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-500' : 'border-gray-300 bg-gray-50 hover:border-gray-400'}` : ''}
                    ${node.status === 'locked' ? `${theme === 'dark' ? 'border-zinc-800 bg-zinc-950/50 opacity-60' : 'border-gray-200 bg-gray-100 opacity-60'}` : ''}
                  `}
                >
                  <div className={`absolute top-3 left-3 text-[10px] font-mono px-1.5 py-0.5 rounded border ${theme === 'dark' ? 'border-zinc-800 text-zinc-500 bg-zinc-950/40' : 'border-gray-200 text-gray-600 bg-white'}`}>
                    Bước {index + 1}
                  </div>

                  <div className={`
                    w-10 h-10 rounded-full flex items-center justify-center text-white mb-2 shadow-lg
                    ${node.status === 'current' ? 'bg-blue-600' : ''}
                    ${node.status === 'completed' ? 'bg-green-600' : ''}
                    ${node.status === 'available' ? 'bg-zinc-700' : ''}
                    ${node.status === 'locked' ? 'bg-zinc-800' : ''}
                  `}>
                    {node.status === 'current' && <Zap size={20} />}
                    {node.status === 'completed' && <Check size={20} />}
                    {node.status === 'available' && <ArrowRight size={20} />}
                    {node.status === 'locked' && <Lock size={18} />}
                  </div>

                  <div>
                    <h4 className={`font-bold text-sm ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>{node.title}</h4>
                    <p
                      className={`text-xs mt-1 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                        overflow: 'hidden'
                      }}
                    >
                      {node.description}
                    </p>
                  </div>

                  <div className={`mt-auto pt-3 w-full border-t ${theme === 'dark' ? 'border-zinc-800/50' : 'border-gray-200'}`}>
                    <div className="flex justify-between items-center text-[10px] uppercase font-mono tracking-wider">
                      <span
                        className={theme === 'dark' ? 'text-zinc-600' : 'text-gray-500'}
                        title="Độ ưu tiên của bài học. Điểm cao hơn cần được ôn luyện nhiều hơn."
                      >
                        Priority
                      </span>
                      <span
                        className={node.status === 'current' ? 'text-blue-400 font-bold' : theme === 'dark' ? 'text-zinc-500' : 'text-gray-600'}
                        title="Độ ưu tiên của bài học. Điểm cao hơn cần được ôn luyện nhiều hơn."
                      >
                        {node.qValue.toFixed(3)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LearningMap;
