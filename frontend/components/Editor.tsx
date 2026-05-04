import React from 'react';
import MonacoEditor from '@monaco-editor/react';

interface EditorProps {
  code: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  theme?: 'dark' | 'light';
}

const Editor: React.FC<EditorProps> = ({ code, onChange, disabled, theme = 'dark' }) => {
  return (
    <div className={`relative w-full h-full overflow-hidden ${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-white'}`}>
       <MonacoEditor
         height="100%"
         language="python"
         theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
         value={code}
         onChange={(value) => onChange(value || '')}
         options={{
           readOnly: disabled,
           minimap: { enabled: false },
           fontSize: 13,
           fontFamily: "'Fira Code', 'Consolas', monospace",
           scrollBeyondLastLine: false,
           automaticLayout: true,
           lineNumbers: 'on',
           glyphMargin: false,
           folding: true,
           lineDecorationsWidth: 10,
           lineNumbersMinChars: 3,
           padding: { top: 12, bottom: 12 },
           renderLineHighlight: 'all',
           cursorBlinking: 'smooth',
           smoothScrolling: true,
         }}
       />
    </div>
  );
};

export default Editor;