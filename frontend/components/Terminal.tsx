import React, { useRef, useEffect, useCallback } from 'react';
import { ExecutionResult } from '../types';
import { Terminal as TerminalIcon, Square } from 'lucide-react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalProps {
  result: ExecutionResult | null;
  isRunning: boolean;
  onInput?: (input: string) => void;
  code?: string;
  runTrigger?: number;
  wsUrl?: string;
  onExecutionStart?: () => void;
  onExecutionEnd?: (success: boolean) => void;
}

const Terminal: React.FC<TerminalProps> = ({
  result,
  isRunning,
  code,
  runTrigger = 0,
  wsUrl = 'ws://localhost:8000/ws/terminal',
  onExecutionStart,
  onExecutionEnd,
}) => {
  const xtermRef = useRef<HTMLDivElement | null>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastRunTrigger = useRef<number>(0);
  const dataHandlerRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      cols: 80,
      rows: 24,
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#10b981',
        cursorAccent: '#0f172a',
        selectionBackground: '#334155',
      },
      fontFamily: 'Monaco, "Cascadia Code", "Fira Code", monospace',
      fontSize: 14,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    xtermInstance.current = term;
    fitRef.current = fit;

    if (xtermRef.current) {
      term.open(xtermRef.current);
      setTimeout(() => {
        try { fit.fit(); } catch (e) { }
      }, 0);
    }

    term.writeln('\x1b[1;32m$ Ready to execute...\x1b[0m');
    term.writeln('\x1b[90mClick "Run Code" to start.\x1b[0m');

    const onResize = () => {
      try { fit.fit(); } catch (e) { }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      try { term.dispose(); } catch (e) { }
    };
  }, []);

  const cleanupWebSocket = useCallback(() => {
    if (dataHandlerRef.current) {
      dataHandlerRef.current.dispose();
      dataHandlerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) { }
      wsRef.current = null;
    }
  }, []);

  const handleStop = useCallback(() => {
    cleanupWebSocket();
    if (xtermInstance.current) {
      xtermInstance.current.writeln('\r\n\x1b[1;33m[Execution stopped by user]\x1b[0m');
    }
    onExecutionEnd?.(false);
  }, [cleanupWebSocket, onExecutionEnd]);

  useEffect(() => {
    if (runTrigger === 0 || runTrigger === lastRunTrigger.current) {
      return;
    }
    lastRunTrigger.current = runTrigger;

    if (!code) return;

    const term = xtermInstance.current;
    if (!term) return;

    cleanupWebSocket();

    term.clear();
    term.writeln('\x1b[1;32m$ Running code...\x1b[0m');
    term.writeln('');

    onExecutionStart?.();

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      const startMsg = JSON.stringify({ type: 'start', code });
      ws.send(startMsg);
    };

    ws.onmessage = (ev) => {
      const data = typeof ev.data === 'string'
        ? ev.data
        : new TextDecoder().decode(ev.data);
      term.write(data);
    };

    ws.onclose = () => {
      term.writeln('\r\n\x1b[90m[Process finished]\x1b[0m');
      onExecutionEnd?.(true);
    };

    ws.onerror = (e) => {
      console.error('WebSocket error', e);
      term.writeln('\r\n\x1b[1;31m[WebSocket error]\x1b[0m');
      onExecutionEnd?.(false);
    };

    const dataHandler = term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
    dataHandlerRef.current = dataHandler;

    return () => { };
  }, [runTrigger, code, wsUrl, cleanupWebSocket, onExecutionStart, onExecutionEnd]);

  useEffect(() => {
    return () => {
      cleanupWebSocket();
    };
  }, [cleanupWebSocket]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      try { fitRef.current?.fit(); } catch (e) { }
    });
    if (xtermRef.current) {
      observer.observe(xtermRef.current);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="h-full w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 font-mono text-sm overflow-hidden flex flex-col">
      <div className="border-b border-slate-800 px-4 py-2 flex items-center gap-2 bg-slate-900/50">
        <TerminalIcon className="w-4 h-4 text-emerald-500" />
        <span className="text-slate-400 text-xs font-semibold">Terminal</span>

        {isRunning && (
          <div className="ml-auto flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-emerald-500 text-xs">Running...</span>
            <button
              onClick={handleStop}
              className="ml-2 p-1 rounded bg-red-600/20 hover:bg-red-600/40 text-red-400 transition-colors"
              title="Stop execution"
            >
              <Square className="w-3 h-3" fill="currentColor" />
            </button>
          </div>
        )}

        {!isRunning && result?.execution && (
          <div className="ml-auto text-xs text-slate-500">
            {result.execution.execution_time.toFixed(3)}s | {result.execution.resource_stats.memory_used_mb.toFixed(1)}MB
          </div>
        )}
      </div>

      <div className="flex-1 p-2 overflow-hidden">
        <div ref={xtermRef} className="w-full h-full" />
      </div>

      <style>{`
        .xterm {
          padding: 8px;
        }
        .xterm-viewport::-webkit-scrollbar {
          width: 6px;
        }
        .xterm-viewport::-webkit-scrollbar-track {
          background: rgb(15, 23, 42);
        }
        .xterm-viewport::-webkit-scrollbar-thumb {
          background: rgb(51, 65, 85);
          border-radius: 3px;
        }
        .xterm-viewport::-webkit-scrollbar-thumb:hover {
          background: rgb(71, 85, 105);
        }
      `}</style>
    </div>
  );
};

export default Terminal;
