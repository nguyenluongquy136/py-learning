import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { Send, Bot, User, Lightbulb, RefreshCw, BookOpen, Sparkles, Database } from 'lucide-react';
import { chatWithTutor, getHintFromTutor, TutorChatMessage } from '../services/api';
import MarkdownRenderer from './MarkdownRenderer';

interface TutorChatProps {
  currentCode: string;
  problemId?: string;
  problemDescription?: string;
  theme?: 'dark' | 'light';
  onApplySuggestion?: (newCode: string) => void;
  language?: 'vi' | 'en';
}

interface ExtendedChatMessage extends ChatMessage {
  concepts?: string[];
  isHint?: boolean;
  similarity?: number;
  hasReference?: boolean;
}

const TutorChat: React.FC<TutorChatProps> = ({
  currentCode,
  problemId = "default",
  problemDescription = "Giải bài tập Python",
  theme = 'dark',
  onApplySuggestion,
  language = 'vi'
}) => {
  const strings = {
    vi: {
      welcomeMessage: "Xin chào! Mình là Gia sư AI Python, được hỗ trợ bởi Qdrant RAG. Bạn có thể hỏi mình về code hoặc yêu cầu gợi ý khi gặp khó khăn. 💡",
      placeholder: "Hỏi gia sư AI về code của bạn... (Enter để gửi, Shift+Enter xuống dòng)",
      clearButton: "Xoá"
    },
    en: {
      welcomeMessage: "Hello! I'm your AI Python Tutor, powered by Qdrant RAG. You can ask me about code or request hints when you're stuck. 💡",
      placeholder: "Ask the AI tutor about your code... (Enter to send, Shift+Enter for new line)",
      clearButton: "Clear"
    }
  };

  const [messages, setMessages] = useState<ExtendedChatMessage[]>([
    {
      role: 'assistant',
      content: strings[language || 'vi'].welcomeMessage,
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [textareaValue, setTextareaValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [currentConcepts, setCurrentConcepts] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [localLanguage, setLocalLanguage] = useState<'vi' | 'en'>(language || 'vi');

  useEffect(() => {
    setLocalLanguage(language || 'vi');
  }, [language]);

  const t = strings[localLanguage];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages, isTyping]);

  // Chỉ gửi một phần lịch sử hội thoại gần nhất để giảm token/latency
  const getConversationHistory = (): TutorChatMessage[] => {
    return messages.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp
    }));
  };

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || input;
    if (!textToSend.trim()) return;

    const newMsg: ExtendedChatMessage = {
      role: 'user',
      content: textToSend,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, newMsg]);
    setInput('');
    setTextareaValue('');
    setIsTyping(true);
    setFollowUpQuestions([]);

    try {
      const response = await chatWithTutor({
        code: currentCode,
        problem_id: problemId,
        problem_description: problemDescription,
        message: textToSend,
        conversation_history: getConversationHistory(),
        language: localLanguage
      });

      const assistantMsg: ExtendedChatMessage = {
        role: 'assistant',
        content: response.response,
        timestamp: Date.now(),
        concepts: response.concepts_mentioned
      };

      setMessages(prev => [...prev, assistantMsg]);
      setFollowUpQuestions(response.follow_up_questions || []);
      setCurrentConcepts(response.concepts_mentioned || []);

    } catch (error: any) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Xin lỗi, đã có lỗi xảy ra. Hãy thử lại sau nhé! 🙏',
        timestamp: Date.now()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleGetHint = async () => {
    if (!currentCode.trim() || currentCode.length < 10) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Bạn hãy viết code trước rồi mình sẽ giúp bạn nhé! ✍️',
        timestamp: Date.now()
      }]);
      return;
    }

    setIsTyping(true);

    try {
      const token = localStorage.getItem('token') || undefined;
      const previousHints = messages
        .filter(m => m.isHint)
        .map(m => m.content);

      const hintLevel = Math.min(previousHints.length + 1, 5);

      // Sử dụng API mới với Qdrant RAG
      const response = await getHintFromTutor({
        code: currentCode,
        problem_id: problemId,
        problem_description: problemDescription,
        hint_level: hintLevel,
        previous_hints: previousHints,
        language: localLanguage
      }, token);

      const hintMsg: ExtendedChatMessage = {
        role: 'assistant',
        content: response.hint,
        timestamp: Date.now(),
        isHint: true,
        concepts: response.concepts_to_review,
        similarity: response.reference_similarity,
        hasReference: response.reference_used
      };

      setMessages(prev => [...prev, hintMsg]);
      setCurrentConcepts(response.concepts_to_review);

      // Nếu có reference từ RAG, thông báo thêm để người học hiểu nguồn gợi ý
      const hasRef = response.reference_used;
      if (hasRef && response.reference_similarity > 0.5) {
        setTimeout(() => {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `💡 Mình đã tìm thấy code mẫu tương tự (${Math.round(response.reference_similarity * 100)}% similarity). ${response.follow_up_question}`,
            timestamp: Date.now()
          }]);
        }, 500);
      }

      // Gợi ý câu hỏi tiếp theo (Socratic)
      if (response.follow_up_question) {
        setFollowUpQuestions([response.follow_up_question]);
      }

    } catch (error: any) {
      console.error('Hint error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Không thể tạo gợi ý lúc này. Hãy thử hỏi trực tiếp nhé!',
        timestamp: Date.now()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const applySuggestionToEditor = (suggestion: string) => {
    if (!onApplySuggestion) return;

    // Thêm gợi ý dưới dạng comment để người học tự quyết định áp dụng hay không
    const label = localLanguage === 'en' ? 'Suggestion' : 'Gợi ý';
    const newCode = `${currentCode}\n# ${label}: ${suggestion}`;
    onApplySuggestion(newCode);
  };

  return (
    <div className={`flex flex-col h-full border-l ${theme === 'dark' ? 'bg-[#1e1e1e] border-zinc-800' : 'bg-white border-gray-300'}`}>
      <div className={`p-3 border-b flex items-center justify-between ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-300 bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
            <Bot size={16} className="text-white" />
          </div>
          <div>
            <h3 className={`font-medium text-sm ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-800'}`}>
              Gia sư AI Python
            </h3>
            <p className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
              Phương pháp Socrates
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md shadow-sm bg-transparent" role="group">
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
          <button
            onClick={handleGetHint}
            disabled={isTyping}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs rounded-md transition-colors"
          >
            <Lightbulb size={14} />
            {localLanguage === 'en' ? 'Get hint' : 'Xin gợi ý'}
          </button>
        </div>
      </div>

      {currentConcepts.length > 0 && (
        <div className={`px-3 py-2 border-b flex items-center gap-2 overflow-x-auto ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-gray-50'}`}>
          <BookOpen size={14} className={theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'} />
          {currentConcepts.map((concept, idx) => (
            <span
              key={idx}
              className={`px-2 py-0.5 rounded-full text-xs ${theme === 'dark' ? 'bg-indigo-900/50 text-indigo-300' : 'bg-indigo-100 text-indigo-700'}`}
            >
              {concept}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'assistant'
                ? msg.isHint ? 'bg-amber-600' : 'bg-indigo-600'
                : theme === 'dark' ? 'bg-zinc-600' : 'bg-gray-400'
              }`}>
              {msg.role === 'assistant' ? (
                msg.isHint ? <Sparkles size={16} className="text-white" /> : <Bot size={16} className="text-white" />
              ) : (
                <User size={16} className="text-white" />
              )}
            </div>
            <div className={`max-w-[85%] p-3 rounded-lg text-sm leading-relaxed ${msg.role === 'user'
                ? theme === 'dark' ? 'bg-zinc-800 text-zinc-100 rounded-tr-none' : 'bg-blue-100 text-gray-900 rounded-tr-none'
                : msg.isHint
                  ? theme === 'dark' ? 'bg-amber-900/30 border border-amber-700 text-amber-100 rounded-tl-none' : 'bg-amber-50 border border-amber-200 text-amber-900 rounded-tl-none'
                  : theme === 'dark' ? 'bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-tl-none' : 'bg-gray-100 border border-gray-300 text-gray-800 rounded-tl-none'
              }`}>
              <MarkdownRenderer content={msg.content} theme={theme} />
              {msg.isHint && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(msg.content); }} className="px-2 py-1 text-xs rounded bg-indigo-600 text-white">Sao chép</button>
                  <button onClick={() => applySuggestionToEditor(msg.content)} className="px-2 py-1 text-xs rounded bg-emerald-600 text-white">Áp dụng</button>
                </div>
              )}
              {msg.similarity !== undefined && (
                <div className={`mt-2 pt-2 border-t text-xs ${theme === 'dark' ? 'border-zinc-700 text-zinc-500' : 'border-gray-300 text-gray-500'}`}>
                  <span className="flex items-center gap-1">
                    <Database size={12} />
                    Độ tương đồng RAG: {Math.round(msg.similarity * 100)}%
                    {msg.hasReference && <span className="text-green-500 ml-1">✓ Có code mẫu</span>}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <Bot size={16} className="text-white" />
            </div>
            <div className={`p-3 rounded-lg rounded-tl-none ${theme === 'dark' ? 'bg-zinc-900 border border-zinc-700' : 'bg-gray-100 border border-gray-300'}`}>
              <div className="flex gap-1">
                <span className={`w-2 h-2 rounded-full animate-bounce ${theme === 'dark' ? 'bg-zinc-500' : 'bg-gray-400'}`} style={{ animationDelay: '0ms' }}></span>
                <span className={`w-2 h-2 rounded-full animate-bounce ${theme === 'dark' ? 'bg-zinc-500' : 'bg-gray-400'}`} style={{ animationDelay: '150ms' }}></span>
                <span className={`w-2 h-2 rounded-full animate-bounce ${theme === 'dark' ? 'bg-zinc-500' : 'bg-gray-400'}`} style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {followUpQuestions.length > 0 && !isTyping && (
        <div className={`px-4 py-2 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-200'}`}>
          <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
            Câu hỏi gợi ý:
          </p>
          <div className="flex flex-wrap gap-2">
            {followUpQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(q)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${theme === 'dark'
                    ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                  }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`p-4 border-t ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-300 bg-gray-50'}`}>
        <div className="flex gap-2">
          <textarea
            value={textareaValue}
            onChange={(e) => { setTextareaValue(e.target.value); setInput(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t.placeholder}
            rows={1}
            className={`flex-1 border rounded-md px-3 py-2 text-sm resize-none overflow-hidden focus:outline-none focus:border-indigo-500 ${theme === 'dark'
                ? 'bg-[#1e1e1e] border-zinc-700 text-zinc-200 placeholder-zinc-500'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
              }`}
          />
          <button
            onClick={() => handleSend()}
            disabled={isTyping || !textareaValue.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white p-2 rounded-md transition-colors"
          >
            <Send size={18} />
          </button>
          <button onClick={() => { setMessages([{ role: 'assistant', content: t.welcomeMessage, timestamp: Date.now() }]); setFollowUpQuestions([]); }} className="ml-2 px-3 py-2 rounded-md bg-zinc-700 text-white text-sm">{t.clearButton}</button>
        </div>
      </div>
    </div>
  );
};

export default TutorChat;
