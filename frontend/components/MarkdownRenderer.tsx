import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = {
  content: string;
  theme?: 'dark' | 'light';
};

/**
 * Render an toàn cho nội dung từ tutor.
 * - KHÔNG cho phép HTML thô (mặc định của react-markdown)
 * - Hỗ trợ GFM (bảng, gạch ngang, danh sách task)
 * - Style code inline + khối code cho dễ đọc
 */
const MarkdownRenderer: React.FC<Props> = ({ content, theme = 'dark' }) => {
  const isDark = theme === 'dark';

  return (
    <div className={`markdown-body ${isDark ? 'text-zinc-200' : 'text-gray-800'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ children, className, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isMatch = !!match;
            // Heuristic: Inline code usually doesn't have a specific language class and typically doesn't contain newlines (which are preserved in blocks).
            // This is a common workaround for react-markdown v9 where 'inline' prop is removed.
            const isInline = !isMatch && !String(children).includes('\n');

            if (isInline) {
              return (
                <code
                  className={`px-1 py-0.5 rounded font-mono text-[0.95em] ${isDark ? 'bg-zinc-800 text-zinc-100' : 'bg-gray-100 text-gray-900'
                    } ${className || ''}`}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            // Với fenced block, ReactMarkdown bọc <code> trong <pre>.
            // Nên ta style <pre> riêng và giữ <code> đơn giản.
            return (
              <code className={`font-mono text-xs leading-relaxed ${className || ''}`} {...props}>
                {children}
              </code>
            );
          },
          pre({ children, ...props }) {
            return (
              <pre
                className={`mt-2 mb-2 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed ${isDark ? 'bg-zinc-950 border border-zinc-800 text-zinc-100' : 'bg-gray-50 border border-gray-200 text-gray-900'
                  }`}
                {...props}
              >
                {children}
              </pre>
            );
          },
          a({ children, ...props }) {
            return (
              <a
                className={`underline underline-offset-2 ${isDark ? 'text-indigo-300 hover:text-indigo-200' : 'text-indigo-600 hover:text-indigo-500'
                  }`}
                target="_blank"
                rel="noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          ul({ children, ...props }) {
            return (
              <ul className="list-disc pl-5 space-y-1" {...props}>
                {children}
              </ul>
            );
          },
          ol({ children, ...props }) {
            return (
              <ol className="list-decimal pl-5 space-y-1" {...props}>
                {children}
              </ol>
            );
          },
          p({ children, ...props }) {
            return (
              <p className="whitespace-pre-wrap leading-relaxed" {...props}>
                {children}
              </p>
            );
          }
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;


