import React, { useState, useEffect } from 'react';
import { Lightbulb, ChevronRight, ThumbsUp, ThumbsDown, Loader2, Brain, Sparkles, AlertTriangle, Target, BookOpen, Zap, RefreshCw, Copy, CheckCircle } from 'lucide-react';
import { getHintFromTutor, HintRequest, HintResponse, submitHintFeedback } from '../services/api';
import MarkdownRenderer from './MarkdownRenderer';

interface HintPanelProps {
  code: string;
  problemId?: string;
  problemDescription?: string;
  sessionId?: number | null;
  theme: 'dark' | 'light';
  isOpen: boolean;
  onClose: () => void;
  onApplySuggestion?: (newCode: string) => void;
  language?: 'vi' | 'en';
}


const HintPanel: React.FC<HintPanelProps> = ({
  code,
  problemId = "default",
  problemDescription = "Bài tập Python",
  sessionId = null,
  theme,
  isOpen,
  onClose,
  onApplySuggestion,
  language = 'vi'
}) => {
  const [currentHint, setCurrentHint] = useState<HintResponse | null>(null);
  const [hintLevel, setHintLevel] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const [localLanguage, setLocalLanguage] = useState<'vi' | 'en'>(language || 'vi');

  useEffect(() => {
    setLocalLanguage(language || 'vi');
  }, [language]);

  // Chuỗi đa ngôn ngữ (giảm lặp và dễ bảo trì)
  const strings = {
    vi: {
      hintButton: currentHint ? 'Làm mới gợi ý' : 'Xin gợi ý từ AI',
      levelLabel: 'Mức độ:',
      hintLevel: 'Gợi ý cấp',
      codeAnalysis: 'Phân tích code',
      moreDetails: 'Chi tiết hơn',
      noCodeError: 'Vui lòng viết ít nhất 10 ký tự code trước khi xin gợi ý',
      noProblemError: 'Không thể tạo gợi ý lúc này. Hãy thử hỏi trực tiếp với AI Tutor Chat!',
      hintError: 'Không thể tạo gợi ý. Vui lòng thử lại.',
      copyTitle: 'Sao chép gợi ý',
      applyTitle: 'Thêm vào code',
      helpfulTitle: 'Gợi ý hữu ích',
      notHelpfulTitle: 'Gợi ý không hữu ích',
      highConfidence: 'Uy tín cao',
      referenceUsed: 'Có tham khảo',
      noError: 'Không có',
      syntaxError: 'Cú pháp',
      runtimeError: 'Runtime',
      logicError: 'Logic',
      apiError: 'Lỗi khi tạo gợi ý. Hãy thử lại hoặc liên hệ hỗ trợ!'
    },
    en: {
      hintButton: currentHint ? 'Refresh hint' : 'Get hint from AI',
      levelLabel: 'Level:',
      hintLevel: 'Hint level',
      codeAnalysis: 'Code analysis',
      moreDetails: 'More details',
      noCodeError: 'Please write at least 10 characters of code before requesting a hint',
      noProblemError: 'Cannot generate hint right now. Try asking directly in AI Tutor Chat!',
      hintError: 'Unable to generate hint. Please try again.',
      copyTitle: 'Copy hint',
      applyTitle: 'Add to code',
      helpfulTitle: 'Helpful hint',
      notHelpfulTitle: 'Not helpful',
      highConfidence: 'High confidence',
      referenceUsed: 'Reference used',
      noError: 'None',
      syntaxError: 'Syntax',
      runtimeError: 'Runtime',
      logicError: 'Logic',
      apiError: 'Error generating hint. Please try again or contact support!'
    }
  };

  const t = strings[localLanguage];

  // Reset hint khi code thay đổi đáng kể
  useEffect(() => {
    if (code.length < 10) {
      setCurrentHint(null);
      setHintLevel(1);
      setError(null);
    }
  }, [code]);

  const getHint = async (level: number = hintLevel) => {
    // Cần có đủ code để phân tích/hint có ý nghĩa
    if (!code.trim() || code.length < 10) {
      setError(t.noCodeError);
      return;
    }

    // Nếu chưa chọn bài, tránh gọi API và hiển thị hướng dẫn
    const hasProblem = !!problemId && String(problemId) !== 'default' && String(problemId) !== '';
    if (!hasProblem) {
      setError(t.noProblemError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token') || undefined;
      const request: HintRequest = {
        code,
        problem_id: problemId,
        problem_description: problemDescription,
        hint_level: level,
        language: localLanguage || 'vi',
        session_id: sessionId || undefined
      };

      const response = await getHintFromTutor(request, token);
      setCurrentHint(response);
      setHintLevel(level);
      setFeedback(null);
      setIsSubmittingFeedback(false);

    } catch (err: any) {
      console.error('Hint error:', err);
      setError(err.message || t.apiError);
    } finally {
      setIsLoading(false);
    }
  };

  const getNextHint = () => {
    if (hintLevel < 5) {
      // Only request next hint if a problem is selected
      const hasProblem = !!problemId && String(problemId) !== 'default' && String(problemId) !== '';
      if (!hasProblem) {
        setError(t.noProblemError);
        return;
      }
      getHint(hintLevel + 1);
    }
  };

  const copyHint = async () => {
    if (currentHint?.hint) {
      await navigator.clipboard.writeText(currentHint.hint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const applyHint = () => {
    if (currentHint?.hint && onApplySuggestion) {
      onApplySuggestion(`# Gợi ý: ${currentHint.hint}\n${code}`);
    }
  };

  const submitFeedback = async (wasHelpful: boolean) => {
    try {
      if (isSubmittingFeedback) return;
      if (feedback) return;
      const token = localStorage.getItem('token') || undefined;
      const interactionId = currentHint?.interaction_id;
      if (!interactionId) return; // chưa bật telemetry / chưa đăng nhập
      setIsSubmittingFeedback(true);
      await submitHintFeedback(interactionId, wasHelpful, token);
      setFeedback(wasHelpful ? 'up' : 'down');
    } catch (e) {
      // UX “best-effort”: lỗi feedback không nên làm phiền người học
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`w-full max-w-sm border-l flex flex-col h-full ${theme === 'dark' ? 'bg-[#0a0a0a] border-zinc-800' : 'bg-gray-50 border-gray-200'}`}>
      <div className={`p-4 border-b flex items-center justify-between ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
        <div className="flex items-center gap-3">
          <Lightbulb size={20} className="text-yellow-400" />
          <h3 className={`font-semibold ${theme === 'dark' ? 'text-zinc-100' : 'text-gray-800'}`}>Trợ lý AI</h3>

          <div className="ml-2 inline-flex rounded-md shadow-sm bg-transparent" role="group">
            <button
              type="button"
              onClick={() => setLocalLanguage('vi')}
              className={`px-2 py-0.5 text-xs rounded-l-md border ${localLanguage === 'vi' ? 'bg-blue-600 text-white' : theme === 'dark' ? 'bg-zinc-800 text-zinc-200' : 'bg-white text-gray-700'}`}
              title="Tiếng Việt"
              aria-pressed={localLanguage === 'vi'}
            >
              🇻🇳 Vi
            </button>
            <button
              type="button"
              onClick={() => setLocalLanguage('en')}
              className={`px-2 py-0.5 text-xs rounded-r-md border ${localLanguage === 'en' ? 'bg-blue-600 text-white' : theme === 'dark' ? 'bg-zinc-800 text-zinc-200' : 'bg-white text-gray-700'}`}
              title="English"
              aria-pressed={localLanguage === 'en'}
            >
              🇬🇧 En
            </button>
          </div>
        </div>
        <button
          onClick={onClose}
          className={`p-1 rounded ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'}`}
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-3">
          <button
            onClick={() => getHint(1)}
            disabled={isLoading}
            className={`w-full py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${isLoading
              ? 'bg-zinc-700 cursor-not-allowed text-zinc-400'
              : 'bg-green-600 hover:bg-green-500 text-white'
              }`}
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Brain size={18} />
            )}
            {t.hintButton}
          </button>

          {/* Hint Level Indicator */}
          <div className="flex items-center justify-center gap-2">
            <span className={`text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
              {t.levelLabel}
            </span>
            {[1, 2, 3, 4, 5].map(level => (
              <button
                key={level}
                onClick={() => getHint(level)}
                disabled={isLoading || !problemId || String(problemId) === 'default' || String(problemId) === ''}
                className={`relative w-8 h-8 rounded-full text-xs font-medium transition-all ${hintLevel === level
                  ? 'bg-blue-600 text-white shadow-lg scale-110'
                  : level <= hintLevel
                    ? theme === 'dark'
                      ? 'bg-zinc-600 hover:bg-zinc-500 text-zinc-200'
                      : 'bg-gray-300 hover:bg-gray-400 text-gray-700'
                    : theme === 'dark'
                      ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                  }`}
                title={`Cấp ${level}: ${level === 1 ? 'Câu hỏi gợi mở' :
                  level === 2 ? 'Gợi ý khái niệm' :
                    level === 3 ? 'Chỉ ra vị trí lỗi' :
                      level === 4 ? 'Ví dụ cụ thể' :
                        'Hướng dẫn trực tiếp'
                  }`}
              >
                {level}
                {hintLevel === level && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-400 rounded-full animate-pulse"></div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Hiển thị lỗi */}
        {error && (
          <div className={`p-3 rounded-lg border ${theme === 'dark'
            ? 'bg-red-900/20 border-red-800 text-red-400'
            : 'bg-red-50 border-red-200 text-red-600'
            }`}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} />
              <span className="text-sm">{error}</span>
            </div>
          </div>
        )}

        {/* Hiển thị gợi ý hiện tại */}
        {currentHint && (
          <div className={`p-4 rounded-lg border ${theme === 'dark'
            ? 'bg-zinc-900/50 border-zinc-700'
            : 'bg-white border-gray-300 shadow-sm'
            }`}>
            {/* Tiêu đề gợi ý */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-blue-400" />
                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-700'
                  }`}>
                  {t.hintLevel} {currentHint.hint_level}
                </span>
                {currentHint.confidence > 0.8 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-green-900/30 text-green-400">
                    {t.highConfidence}
                  </span>
                )}
                {currentHint.reference_used && (
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 text-blue-400">
                    {t.referenceUsed}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={copyHint}
                  className={`p-1.5 rounded transition-colors ${theme === 'dark'
                    ? 'hover:bg-zinc-800 text-zinc-400'
                    : 'hover:bg-gray-200 text-gray-500'
                    }`}
                  title={t.copyTitle}
                >
                  {copied ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
                {onApplySuggestion && (
                  <button
                    onClick={applyHint}
                    className={`p-1.5 rounded transition-colors ${theme === 'dark'
                      ? 'hover:bg-zinc-800 text-zinc-400'
                      : 'hover:bg-gray-200 text-gray-500'
                      }`}
                    title={t.applyTitle}
                  >
                    <Zap size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Nội dung gợi ý */}
            <div className="text-sm leading-relaxed mb-3">
              <MarkdownRenderer content={currentHint.hint} theme={theme} />
            </div>

            {/* Bước tiếp theo (nếu có) */}
            {currentHint.follow_up_question && currentHint.follow_up_question.length > 0 && (
              <div className={`mb-3 p-3 rounded border-l-4 ${theme === 'dark' ? 'bg-zinc-800/20 border-yellow-600 text-yellow-200' : 'bg-yellow-50 border-yellow-400 text-yellow-800'}`}>
                <div className="text-xs font-medium mb-1">Bước tiếp theo (gợi ý cụ thể):</div>
                <div className="text-sm">
                  <MarkdownRenderer content={currentHint.follow_up_question} theme={theme} />
                </div>
              </div>
            )}
            {/* Điểm tương đồng */}
            {currentHint.reference_used && (
              <div className={`p-2 rounded mb-3 ${theme === 'dark' ? 'bg-blue-900/20' : 'bg-blue-50'
                }`}>
                <div className="flex items-center gap-2">
                  <Target size={14} className={
                    theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
                  } />
                  <span className={`text-xs ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
                    }`}>
                    Độ tương đồng: {Math.round(currentHint.reference_similarity * 100)}%
                  </span>
                </div>
              </div>
            )}

            {/* Thông tin lỗi */}
            {currentHint.error_type !== 'none' && (
              <div className={`p-2 rounded mb-3 ${theme === 'dark' ? 'bg-red-900/20' : 'bg-red-50'
                }`}>
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className={
                    theme === 'dark' ? 'text-red-400' : 'text-red-600'
                  } />
                  <span className={`text-xs ${theme === 'dark' ? 'text-red-300' : 'text-red-700'
                    }`}>
                    {currentHint.error_message}
                  </span>
                </div>
              </div>
            )}

            {/* Phần phân tích code */}
            <div className={`p-3 rounded mb-3 ${theme === 'dark' ? 'bg-zinc-800/50' : 'bg-gray-50'
              }`}>
              <div className="flex items-center gap-2 mb-2">
                <Brain size={14} className={
                  theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'
                } />
                <span className={`text-xs font-medium ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'
                  }`}>
                  {t.codeAnalysis}
                </span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className={theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}>
                    Độ tin cậy:
                  </span>
                  <span className={`font-medium ${currentHint.confidence > 0.8
                    ? 'text-green-400'
                    : currentHint.confidence > 0.6
                      ? 'text-yellow-400'
                      : 'text-red-400'
                    }`}>
                    {Math.round(currentHint.confidence * 100)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className={theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}>
                    Cú pháp:
                  </span>
                  <span className={`font-medium ${currentHint.syntax_valid ? 'text-green-400' : 'text-red-400'
                    }`}>
                    {currentHint.syntax_valid ? 'Hợp lệ' : 'Lỗi'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className={theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}>
                    Loại lỗi:
                  </span>
                  <span className={`font-medium ${currentHint.error_type === 'none'
                    ? 'text-green-400'
                    : currentHint.error_type === 'syntax'
                      ? 'text-red-400'
                      : currentHint.error_type === 'runtime'
                        ? 'text-orange-400'
                        : 'text-yellow-400'
                    }`}>
                    {currentHint.error_type === 'none' ? t.noError :
                      currentHint.error_type === 'syntax' ? t.syntaxError :
                        currentHint.error_type === 'runtime' ? t.runtimeError :
                          currentHint.error_type === 'logic' ? t.logicError : currentHint.error_type}
                  </span>
                </div>
              </div>
            </div>

            {/* Khái niệm cần ôn tập */}
            {currentHint.concepts_to_review && currentHint.concepts_to_review.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen size={14} className={
                    theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'
                  } />
                  <span className={`text-xs font-medium ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'
                    }`}>
                    Ôn tập:
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {currentHint.concepts_to_review.map((concept, idx) => (
                    <span
                      key={idx}
                      className={`text-xs px-2 py-1 rounded ${theme === 'dark'
                        ? 'bg-indigo-900/50 text-indigo-300'
                        : 'bg-indigo-100 text-indigo-700'
                        }`}
                    >
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}



            {/* Thông tin tham khảo */}
            {currentHint.reference_used && (
              <div className={`text-xs p-2 rounded mb-3 ${theme === 'dark' ? 'bg-blue-900/20' : 'bg-blue-50'
                }`}>
                <span className={theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}>
                  Được tạo dựa trên {Math.round(currentHint.reference_similarity * 100)}% tương đồng với code mẫu
                </span>
              </div>
            )}

            {/* Các nút thao tác */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-700">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => submitFeedback(true)}
                  disabled={!currentHint?.interaction_id || isSubmittingFeedback || feedback !== null}
                  className={`p-1.5 rounded transition-colors ${theme === 'dark'
                    ? 'hover:bg-zinc-800 text-zinc-400 hover:text-green-400'
                    : 'hover:bg-gray-200 text-gray-500 hover:text-green-600'
                    } ${(!currentHint?.interaction_id || isSubmittingFeedback || feedback !== null)
                      ? 'opacity-60 cursor-not-allowed'
                      : ''
                    } ${feedback === 'up' ? 'ring-2 ring-green-300' : ''}`}
                  title={t.helpfulTitle}
                >
                  <ThumbsUp size={14} />
                </button>
                <button
                  onClick={() => submitFeedback(false)}
                  disabled={!currentHint?.interaction_id || isSubmittingFeedback || feedback !== null}
                  className={`p-1.5 rounded transition-colors ${theme === 'dark'
                    ? 'hover:bg-zinc-800 text-zinc-400 hover:text-red-400'
                    : 'hover:bg-gray-200 text-gray-500 hover:text-red-600'
                    } ${(!currentHint?.interaction_id || isSubmittingFeedback || feedback !== null)
                      ? 'opacity-60 cursor-not-allowed'
                      : ''
                    } ${feedback === 'down' ? 'ring-2 ring-red-300' : ''}`}
                  title={t.notHelpfulTitle}
                >
                  <ThumbsDown size={14} />
                </button>
              </div>

              {hintLevel < 5 && (
                <button
                  onClick={getNextHint}
                  disabled={isLoading}
                  className={`flex items-center gap-1 text-sm px-3 py-1.5 rounded transition-colors ${theme === 'dark'
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                    }`}
                >
                  {t.moreDetails}
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Hướng dẫn cấp độ gợi ý */}
        <div className={`p-3 rounded-lg ${theme === 'dark' ? 'bg-zinc-900/30' : 'bg-gray-100'
          }`}>
          <h4 className={`text-sm font-medium mb-2 ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-700'
            }`}>
            Hướng dẫn cấp độ gợi ý:
          </h4>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs flex items-center justify-center font-bold">1</span>
              <span className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}>
                Câu hỏi gợi mở - Hướng dẫn suy nghĩ
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold">2</span>
              <span className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}>
                Gợi ý khái niệm - Ôn tập kiến thức cơ bản
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-yellow-500 text-white text-xs flex items-center justify-center font-bold">3</span>
              <span className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}>
                Chỉ ra vị trí lỗi - Xác định vấn đề
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold">4</span>
              <span className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}>
                Ví dụ cụ thể - Hướng dẫn từng bước
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold">5</span>
              <span className={theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}>
                Hướng dẫn trực tiếp - Giải pháp chi tiết
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HintPanel;
