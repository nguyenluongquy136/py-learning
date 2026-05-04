import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, RefreshCw, ZoomIn, ZoomOut, X, AlertTriangle, Scan, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { API_BASE_URL } from '../services/api';

interface Node {
  id: number;
  type: string;
  label: string;
  line?: number;
  x?: number;
  y?: number;
}

interface Edge {
  source: number;
  target: number;
  type: string;
  label?: string;
}

interface GraphData {
  nodes: Node[];
  edges: Edge[];
  entry?: number;
  exits?: number[];
  width?: number;
  height?: number;
}

interface CodeVisualizationProps {
  code: string;
  visualizationType: 'ast' | 'cfg' | 'dfg';
  onTypeChange: (type: 'ast' | 'cfg' | 'dfg') => void;
  isOpen: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
}

const CodeVisualization: React.FC<CodeVisualizationProps> = ({
  code,
  visualizationType,
  onTypeChange,
  isOpen,
  onClose,
  theme
}) => {
  const NODE_W = 120;
  const NODE_H = 40;

  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [highlightedNode, setHighlightedNode] = useState<number | null>(null);
  const [pinnedNodeId, setPinnedNodeId] = useState<number | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationStep, setAnimationStep] = useState(0);
  const [animationSequence, setAnimationSequence] = useState<number[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  // Tự động cuộn để hiển thị node được ghim/highlight
  useEffect(() => {
    const id = pinnedNodeId ?? highlightedNode;
    if (!id) return;
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const nodeEl = svg.querySelector(`[data-node-id='${id}']`) as HTMLElement | null;
    if (!nodeEl) return;

    const nodeRect = nodeEl.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const nodeCenterX = (nodeRect.left + nodeRect.right) / 2;
    const nodeCenterY = (nodeRect.top + nodeRect.bottom) / 2;
    const contCenterX = (contRect.left + contRect.right) / 2;
    const contCenterY = (contRect.top + contRect.bottom) / 2;

    const offsetX = nodeCenterX - contCenterX;
    const offsetY = nodeCenterY - contCenterY;

    try {
      container.scrollBy({ left: offsetX, top: offsetY, behavior: 'smooth' });
    } catch (e) {
      container.scrollLeft += offsetX;
      container.scrollTop += offsetY;
    }
  }, [highlightedNode, pinnedNodeId]);

  // Tính toán zoom/pan để hiển thị toàn bộ đồ thị trong khung nhìn.
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg || !graphData) return;

    const graphW = (graphData as any).width || svg.viewBox.baseVal.width || svg.clientWidth || 1000;
    const graphH = (graphData as any).height || svg.viewBox.baseVal.height || svg.clientHeight || 800;

    const padding = 48;
    const availW = Math.max(100, container.clientWidth - padding * 2);
    const availH = Math.max(100, container.clientHeight - padding * 2);

    const scale = Math.max(0.2, Math.min(2, Math.min(availW / graphW, availH / graphH)));

    const panX = Math.round((container.clientWidth - graphW * scale) / 2);
    const panY = Math.round((container.clientHeight - graphH * scale) / 2);

    setZoom(scale);
    setPan({ x: panX, y: panY });

    // Reset scroll container để transform pan hoạt động đúng từ góc trên trái
    try { container.scrollTo({ left: 0, top: 0, behavior: 'smooth' }); } catch { container.scrollLeft = 0; container.scrollTop = 0; }
  }, [graphData]);

  // Lấy dữ liệu đồ thị từ API
  useEffect(() => {
    if (!isOpen || !code.trim()) return;

    const fetchGraph = async () => {
      setLoading(true);
      setError(null);
      setPinnedNodeId(null);
      setHighlightedNode(null);
      setZoom(1);
      setPan({ x: 0, y: 0 });

      try {
        const endpoint = `/api/ai/visualize/${visualizationType}`;
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, max_nodes: 800 })
        });

        if (!response.ok) throw new Error('Tạo trực quan hóa thất bại');

        const data = await response.json();
        let payload: any = data && data.graph ? data.graph : data;

        if (payload && Array.isArray(payload.nodes)) {
          if (!Array.isArray(payload.edges) || payload.edges.length === 0) {
            const builtEdges: Edge[] = [];
            for (const n of payload.nodes) {
              if (Array.isArray(n.successors)) {
                for (const succ of n.successors) {
                  builtEdges.push({ source: Number(n.id), target: Number(succ), type: 'normal' });
                }
              }
            }
            payload.edges = builtEdges;
          }

          // Ensure entry exists
          if (payload.entry == null && payload.nodes.length > 0) {
            payload.entry = Number(payload.nodes[0].id);
          }
        }

        const laidOut = layoutGraph(payload);
        setGraphData(laidOut);

        // Tạo chuỗi animation đơn giản cho CFG lặp lại thân vòng lặp vài lần
        if (visualizationType === 'cfg' && laidOut) {
          try {
            const nodeIds = laidOut.nodes.map((n: any) => Number(n.id));
            const backEdges = (laidOut.edges || []).filter((e: any) => e.type === 'back');
            let seq: number[] = [...nodeIds];

            // For each back edge, repeat the nodes between target..source to simulate iterations
            for (const be of backEdges) {
              const target = Number(be.target);
              const source = Number(be.source);
              const tIdx = seq.indexOf(target);
              const sIdx = seq.indexOf(source);
              if (tIdx >= 0 && sIdx >= 0 && tIdx < sIdx) {
                const loopNodes = seq.slice(tIdx, sIdx + 1);
                // append two extra iterations
                seq = seq.concat(loopNodes, loopNodes);
              }
            }

            setAnimationSequence(seq);
            setAnimationStep(0);
          } catch (e) {
            setAnimationSequence(null);
          }
        } else {
          setAnimationSequence(null);
          setAnimationStep(0);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lỗi không xác định');
        // Không dùng dữ liệu giả: nếu API lỗi thì hiển thị lỗi để dễ debug.
        setGraphData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchGraph();
  }, [code, visualizationType, isOpen]);

  // Thuật toán layout - phân lớp cơ bản (BFS levels) với chiều rộng/cao thích ứng
  const layoutGraph = useCallback((data: GraphData): GraphData => {
    const nodes = [...data.nodes];
    const padding = 80;
    const gapX = 80;
    const gapY = 90;

    const levelEdges = (data.edges || []).filter(e => e.type !== 'back');

    const levels: Map<number, number> = new Map();
    const queue: number[] = [data.entry ?? 0];
    levels.set(data.entry ?? 0, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLevel = levels.get(current) ?? 0;

      const successors = levelEdges
        .filter(e => e.source === current)
        .map(e => e.target);

      for (const succ of successors) {
        if (!levels.has(succ)) {
          levels.set(succ, currentLevel + 1);
          queue.push(succ);
        }
      }
    }

    const levelNodes: Map<number, number[]> = new Map();
    for (const [nodeId, level] of levels) {
      if (!levelNodes.has(level)) {
        levelNodes.set(level, []);
      }
      levelNodes.get(level)!.push(nodeId);
    }

    for (const [lvl, ids] of levelNodes) {
      levelNodes.set(lvl, [...ids].sort((a, b) => a - b));
    }

    const maxLevel = Math.max(0, ...Array.from(levelNodes.keys()));
    const maxPerLevel = Math.max(1, ...Array.from(levelNodes.values()).map(v => v.length));

    const contentW = maxPerLevel * NODE_W + Math.max(0, maxPerLevel - 1) * gapX;
    const contentH = (maxLevel + 1) * NODE_H + Math.max(0, maxLevel) * gapY;
    const width = Math.max(900, padding * 2 + contentW);
    const height = Math.max(600, padding * 2 + contentH);

    for (const [level, nodeIds] of levelNodes) {
      const count = nodeIds.length;
      const rowW = count * NODE_W + Math.max(0, count - 1) * gapX;
      const startX = padding + (contentW - rowW) / 2;
      const y = padding + level * (NODE_H + gapY) + NODE_H / 2;

      nodeIds.forEach((nodeId, index) => {
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
          node.x = startX + index * (NODE_W + gapX) + NODE_W / 2;
          node.y = y;
        }
      });
    }

    const unplaced = nodes.filter(n => n.x === undefined || n.y === undefined);
    if (unplaced.length > 0) {
      const startY = padding + (maxLevel + 1) * (NODE_H + gapY) + NODE_H / 2;
      const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(unplaced.length))));
      unplaced.forEach((node, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        node.x = padding + col * (NODE_W + gapX) + NODE_W / 2;
        node.y = startY + row * (NODE_H + gapY);
      });
    }

    return { ...data, nodes, width, height };
  }, []);

  const getNodeColor = (type: string): string => {
    const colors: Record<string, string> = {
      entry: '#10B981',
      exit: '#EF4444',
      statement: '#3B82F6',
      condition: '#F59E0B',
      loop_header: '#8B5CF6',
      function_call: '#EC4899',
      definition: '#10B981',
      use: '#3B82F6',
      return: '#EF4444',
      Module: '#6366F1',
      FunctionDef: '#8B5CF6',
      Assign: '#3B82F6',
      While: '#F59E0B',
      For: '#F59E0B',
      If: '#F59E0B'
    };
    return colors[type] || '#6B7280';
  };

  const getEdgeColor = (type: string): string => {
    const colors: Record<string, string> = {
      normal: '#9CA3AF',
      true: '#10B981',
      false: '#EF4444',
      back: '#8B5CF6',
      'def-use': '#3B82F6',
      child: '#6B7280'
    };
    return colors[type] || '#9CA3AF';
  };

  const startAnimation = () => {
    setIsAnimating(true);
    setAnimationStep(0);
  };

  const stopAnimation = () => {
    setIsAnimating(false);
  };

  const nextStep = () => {
    const length = animationSequence && animationSequence.length ? animationSequence.length : (graphData ? graphData.nodes.length : 0);
    if (length && animationStep < length - 1) {
      setAnimationStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (animationStep > 0) {
      setAnimationStep(prev => prev - 1);
    }
  };

  useEffect(() => {
    if (!isAnimating) return;

    const length = animationSequence && animationSequence.length ? animationSequence.length : (graphData ? graphData.nodes.length : 0);
    if (!length) return;

    const interval = setInterval(() => {
      setAnimationStep(prev => {
        if (prev >= length - 1) {
          setIsAnimating(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isAnimating, graphData]);

  // Highlight node dựa trên bước animation
  useEffect(() => {
    if (animationSequence && animationSequence.length > 0) {
      const nid = animationSequence[Math.min(animationStep, animationSequence.length - 1)];
      setHighlightedNode(nid);
    } else if (graphData && graphData.nodes[animationStep]) {
      setHighlightedNode(graphData.nodes[animationStep].id);
    }
  }, [animationStep, graphData]);

  // Đóng khi nhấn Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activeNodeId = pinnedNodeId ?? highlightedNode;
  const activeNode = useMemo(() => {
    if (!graphData || activeNodeId == null) return null;
    return graphData.nodes.find(n => n.id === activeNodeId) || null;
  }, [graphData, activeNodeId]);

  const getGraphBounds = useCallback((data: GraphData) => {
    const placed = data.nodes.filter(n => n.x != null && n.y != null) as Required<Pick<Node, 'x' | 'y'>>[] & Node[];
    if (placed.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of placed) {
      minX = Math.min(minX, (n.x as number) - NODE_W / 2);
      maxX = Math.max(maxX, (n.x as number) + NODE_W / 2);
      minY = Math.min(minY, (n.y as number) - NODE_H / 2);
      maxY = Math.max(maxY, (n.y as number) + NODE_H / 2);
    }
    return { minX, minY, maxX, maxY };
  }, []);

  const fitToScreen = useCallback(() => {
    if (!graphData) return;
    const bounds = getGraphBounds(graphData);
    const el = containerRef.current;
    if (!bounds || !el) return;

    const padding = 40;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const gw = Math.max(1, bounds.maxX - bounds.minX);
    const gh = Math.max(1, bounds.maxY - bounds.minY);

    const z = Math.max(0.2, Math.min(2, Math.min((cw - padding * 2) / gw, (ch - padding * 2) / gh)));
    const px = -bounds.minX * z + (cw - gw * z) / 2;
    const py = -bounds.minY * z + (ch - gh * z) / 2;

    setZoom(z);
    setPan({ x: px, y: py });
  }, [graphData, getGraphBounds]);

  const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const textColor = theme === 'dark' ? 'text-gray-100' : 'text-gray-900';
  const borderColor = theme === 'dark' ? 'border-gray-700' : 'border-gray-200';
  const hoverBg = theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-100';
  const btnBg = theme === 'dark' ? 'bg-gray-700 hover:bg-gray-600 text-gray-100' : 'bg-gray-900 hover:bg-gray-800 text-white';
  const subtleText = theme === 'dark' ? 'text-gray-400' : 'text-gray-500';

  // Tự động fit khi load đồ thị mới
  useEffect(() => {
    if (!graphData) return;
    // Delay one tick so the container has its final size.
    const t = window.setTimeout(() => fitToScreen(), 0);
    return () => window.clearTimeout(t);
  }, [graphData, fitToScreen]);

  return (
    <div className={`fixed inset-0 z-50 ${bgColor} ${textColor} flex flex-col`}>
      {/* Header */}
      <div className={`flex items-center justify-between p-4 border-b ${borderColor}`}>
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-200 dark:bg-zinc-800 rounded-lg p-1">
            <button
              onClick={() => onTypeChange('cfg')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${visualizationType === 'cfg'
                  ? 'bg-white dark:bg-zinc-600 shadow text-indigo-600 dark:text-indigo-300'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
            >
              Control Flow (CFG)
            </button>
            <button
              onClick={() => onTypeChange('dfg')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${visualizationType === 'dfg'
                  ? 'bg-white dark:bg-zinc-600 shadow text-indigo-600 dark:text-indigo-300'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
            >
              Data Flow (DFG)
            </button>
            <button
              onClick={() => onTypeChange('ast')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${visualizationType === 'ast'
                  ? 'bg-white dark:bg-zinc-600 shadow text-indigo-600 dark:text-indigo-300'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
            >
              Syntax Tree (AST)
            </button>
          </div>

          {/* Animation controls */}
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={prevStep}
              className={`p-1.5 rounded ${hoverBg}`}
              title="Bước trước"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={isAnimating ? stopAnimation : startAnimation}
              className={`p-1.5 rounded ${hoverBg}`}
              title={isAnimating ? 'Tạm dừng' : 'Phát'}
            >
              {isAnimating ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              onClick={nextStep}
              className={`p-1.5 rounded ${hoverBg}`}
              title="Bước sau"
            >
              <SkipForward size={18} />
            </button>
            <span className={`text-sm ml-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
              Bước {animationStep + 1} / {animationSequence && animationSequence.length ? animationSequence.length : (graphData?.nodes.length || 0)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fitToScreen}
            className={`p-1.5 rounded ${hoverBg}`}
            title="Fit to screen"
          >
            <Scan size={18} />
          </button>
          <button
            onClick={() => setShowInspector(v => !v)}
            className={`p-1.5 rounded ${hoverBg}`}
            title={showInspector ? 'Hide inspector' : 'Show inspector'}
          >
            {showInspector ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
          {/* Zoom controls */}
          <button
            onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
            className={`p-1.5 rounded ${hoverBg}`}
            title="Zoom out"
          >
            <ZoomOut size={18} />
          </button>
          <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => Math.min(2, z + 0.1))}
            className={`p-1.5 rounded ${hoverBg}`}
            title="Zoom in"
          >
            <ZoomIn size={18} />
          </button>
          <button
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className={`p-1.5 rounded ${hoverBg}`}
            title="Reset view"
          >
            <RefreshCw size={18} />
          </button>
          <button
            onClick={onClose}
            className={`ml-4 px-3 py-1.5 rounded ${btnBg} inline-flex items-center gap-2`}
          >
            <X size={16} />
            Đóng
          </button>
        </div>
      </div>

      {/* Main content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative"
        onMouseDown={(e) => {
          const target = e.target as HTMLElement | null;
          const isOnNode = !!target?.closest('[data-node="1"]');
          if (isOnNode) return;
          if (e.button !== 0) return;

          isPanningRef.current = true;
          panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          setPinnedNodeId(null);
        }}
        onMouseMove={(e) => {
          if (!isPanningRef.current) return;
          const st = panStartRef.current;
          if (!st) return;
          const dx = e.clientX - st.x;
          const dy = e.clientY - st.y;
          setPan({ x: st.px + dx, y: st.py + dy });
        }}
        onMouseUp={() => {
          isPanningRef.current = false;
          panStartRef.current = null;
        }}
        onMouseLeave={() => {
          isPanningRef.current = false;
          panStartRef.current = null;
        }}
        onWheel={(e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const prevZ = zoom;
            const nextZ = Math.max(0.2, Math.min(2, prevZ - e.deltaY * 0.001));
            if (Math.abs(nextZ - prevZ) < 1e-6) return;

            const gx = (mx - pan.x) / prevZ;
            const gy = (my - pan.y) / prevZ;
            const nextPanX = mx - gx * nextZ;
            const nextPanY = my - gy * nextZ;

            setZoom(nextZ);
            setPan({ x: nextPanX, y: nextPanY });
          } else {
            setPan(p => ({
              x: p.x - e.deltaX,
              y: p.y - e.deltaY
            }));
          }
        }}
      >
        <div className={`absolute left-4 bottom-4 text-xs ${subtleText} select-none pointer-events-none`}>
          Drag để pan • Ctrl + scroll để zoom • Esc để đóng
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        )}

        {error && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-500/20 border border-red-500 rounded-lg px-4 py-2 text-red-400 flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {graphData && (
          <svg
            ref={svgRef}
            width={graphData.width || Math.max(900, 1000)}
            height={graphData.height || Math.max(600, 800)}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              display: 'block'
            }}
          >
            <defs>
              {/* Arrow marker */}
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#9CA3AF" />
              </marker>
              {/* Colored arrow markers */}
              <marker id="arrow-green" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#10B981" />
              </marker>
              <marker id="arrow-red" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#EF4444" />
              </marker>
              <marker id="arrow-purple" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#8B5CF6" />
              </marker>
            </defs>

            {/* Edges */}
            {graphData.edges.map((edge, index) => {
              const source = graphData.nodes.find(n => n.id === edge.source);
              const target = graphData.nodes.find(n => n.id === edge.target);
              if (source == null || target == null || source.x == null || target.x == null || source.y == null || target.y == null) return null;

              const edgeColor = getEdgeColor(edge.type);
              const markerId = edge.type === 'true' ? 'arrow-green' :
                edge.type === 'false' ? 'arrow-red' :
                  edge.type === 'back' ? 'arrow-purple' : 'arrowhead';

              const siblings = graphData.edges.filter(e => e.source === edge.source && e.target === edge.target);
              const siblingIndex = siblings.indexOf(edge);
              const separation = 18;
              const offset = (siblingIndex - (siblings.length - 1) / 2) * separation;

              let path: string;
              let labelX = (source.x + target.x) / 2;
              let labelY = (source.y + target.y) / 2;

              if (edge.source === edge.target) {
                const sx = source.x;
                const sy = source.y + 20;
                const rx = sx + 80 + Math.abs(offset);
                const ryTop = sy - 80 - Math.abs(offset);
                const ryBottom = sy + 40 + Math.abs(offset);
                path = `M ${sx} ${sy} C ${rx} ${ryTop} ${rx} ${ryBottom} ${sx} ${sy}`;
                labelX = sx + Math.max(40, 60 + Math.abs(offset));
                labelY = sy - 30 - Math.abs(offset);
              }
              else if (edge.type === 'back') {
                const sx = source.x;
                const sy = source.y + 20;
                const tx = target.x;
                const ty = target.y + 20;

                const ctrlY = Math.min(sy, ty) - 80 - Math.abs(offset);
                const ctrlX1 = sx + offset * 0.5;
                const ctrlX2 = tx + offset * 0.5;

                path = `M ${sx} ${sy} C ${ctrlX1} ${ctrlY} ${ctrlX2} ${ctrlY} ${tx} ${ty}`;
                labelX = (sx + tx) / 2 + offset * 0.3;
                labelY = ctrlY - 8;
              }
              else {
                const sx = source.x;
                const sy = source.y + 20;
                const tx = target.x;
                const ty = target.y - 20;

                if (offset !== 0) {
                  const dx = tx - sx;
                  const dy = ty - sy;
                  const len = Math.sqrt(dx * dx + dy * dy) || 1;

                  const ux = -dy / len;
                  const uy = dx / len;
                  const ox = ux * offset;
                  const oy = uy * offset;
                  path = `M ${sx + ox} ${sy + oy} L ${tx + ox} ${ty + oy}`;
                  labelX = (sx + tx) / 2 + ox;
                  labelY = (sy + ty) / 2 + oy;
                } else {
                  path = `M ${sx} ${sy} L ${tx} ${ty}`;
                  labelX = (sx + tx) / 2;
                  labelY = (sy + ty) / 2;
                }
              }

              return (
                <g key={index}>
                  <path
                    d={path}
                    fill="none"
                    stroke={edgeColor}
                    strokeWidth={2}
                    markerEnd={`url(#${markerId})`}
                    opacity={activeNodeId !== null &&
                      activeNodeId !== edge.source && activeNodeId !== edge.target ? 0.25 : 1}
                  />
                  {edge.label && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      fill={edgeColor}
                      fontSize={12}
                      dy={-5}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {graphData.nodes.map((node) => {
              if (node.x === undefined || node.y === undefined) return null;

              const isHighlighted = activeNodeId === node.id;
              const nodeColor = getNodeColor(node.type);

              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  transform={`translate(${node.x - 60}, ${node.y - 20})`}
                  style={{ cursor: 'pointer' }}
                  data-node="1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPinnedNodeId(node.id);
                    setHighlightedNode(node.id);
                  }}
                  onMouseEnter={() => {
                    if (pinnedNodeId == null) setHighlightedNode(node.id);
                  }}
                  onMouseLeave={() => {
                    if (!isAnimating && pinnedNodeId == null) setHighlightedNode(null);
                  }}
                  opacity={activeNodeId !== null && !isHighlighted ? 0.55 : 1}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={6}
                    fill={nodeColor}
                    stroke={isHighlighted ? '#FBBF24' : 'transparent'}
                    strokeWidth={isHighlighted ? 3 : 0}
                    className="transition-all duration-200"
                  />
                  <text
                    x={NODE_W / 2}
                    y={NODE_H / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="white"
                    fontSize={12}
                    fontWeight={500}
                  >
                    {node.label.length > 15 ? node.label.substring(0, 15) + '...' : node.label}
                  </text>
                  {node.line && (
                    <text
                      x={NODE_W / 2}
                      y={NODE_H - 8}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.7)"
                      fontSize={10}
                    >
                      Dòng {node.line}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {showInspector && (
          <div className={`absolute top-4 right-4 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border ${borderColor} ${theme === 'dark' ? 'bg-[#111827]/90' : 'bg-white/90'} backdrop-blur p-4`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={`text-sm font-semibold ${theme === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}>Inspector</div>
                <div className={`text-xs ${subtleText}`}>Click node để ghim • Click nền để bỏ chọn</div>
              </div>
              <button
                onClick={() => setShowInspector(false)}
                className={`p-1 rounded ${hoverBg}`}
              >
                <X size={14} />
              </button>
            </div>

            <div className={`mt-4 space-y-3 max-h-[60vh] overflow-y-auto ${activeNode ? '' : 'opacity-50 pointer-events-none'}`}>
              {!activeNode ? (
                <div className="py-8 text-center text-sm text-gray-500">
                  Chọn một node để xem chi tiết
                </div>
              ) : (
                <>
                  <div>
                    <div className={`text-xs uppercase font-bold tracking-wider mb-1 ${subtleText}`}>Node</div>
                    <div className="font-mono text-sm break-all bg-gray-500/10 p-2 rounded">
                      {activeNode.label}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className={`text-xs uppercase font-bold tracking-wider mb-1 ${subtleText}`}>Type</div>
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-500/20">
                        {activeNode.type || 'Unknown'}
                      </span>
                    </div>
                    <div>
                      <div className={`text-xs uppercase font-bold tracking-wider mb-1 ${subtleText}`}>ID</div>
                      <span className="font-mono text-sm">{activeNode.id}</span>
                    </div>
                  </div>

                  {activeNode.line && (
                    <div>
                      <div className={`text-xs uppercase font-bold tracking-wider mb-1 ${subtleText}`}>Source Line</div>
                      <div className="text-sm">Line {activeNode.line}</div>
                    </div>
                  )}

                  {/* Incoming Edges */}
                  <div>
                    <div className={`text-xs uppercase font-bold tracking-wider mb-2 ${subtleText}`}>Predecessors</div>
                    <div className="space-y-1">
                      {graphData?.edges.filter(e => e.target === activeNode.id).length === 0 && (
                        <div className="text-xs italic text-gray-500">None</div>
                      )}
                      {graphData?.edges.filter(e => e.target === activeNode.id).map((e, i) => {
                        const src = graphData.nodes.find(n => n.id === e.source);
                        return (
                          <div
                            key={i}
                            className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer ${hoverBg}`}
                            onClick={() => {
                              setPinnedNodeId(e.source);
                              setHighlightedNode(e.source);
                            }}
                          >
                            <span className="truncate flex-1 font-mono">{src?.label}</span>
                            <span className={`ml-2 px-1.5 py-0.5 rounded ${e.type === 'true' ? 'bg-green-500/20 text-green-500' :
                              e.type === 'false' ? 'bg-red-500/20 text-red-500' :
                                'bg-gray-500/20 text-gray-500'
                              }`}>
                              {e.type}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Outgoing Edges */}
                  <div>
                    <div className={`text-xs uppercase font-bold tracking-wider mb-2 ${subtleText}`}>Successors</div>
                    <div className="space-y-1">
                      {graphData?.edges.filter(e => e.source === activeNode.id).length === 0 && (
                        <div className="text-xs italic text-gray-500">None</div>
                      )}
                      {graphData?.edges.filter(e => e.source === activeNode.id).map((e, i) => {
                        const target = graphData.nodes.find(n => n.id === e.target);
                        return (
                          <div
                            key={i}
                            className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer ${hoverBg}`}
                            onClick={() => {
                              setPinnedNodeId(e.target);
                              setHighlightedNode(e.target);
                            }}
                          >
                            <span className="truncate flex-1 font-mono">{target?.label}</span>
                            <span className={`ml-2 px-1.5 py-0.5 rounded ${e.type === 'true' ? 'bg-green-500/20 text-green-500' :
                              e.type === 'false' ? 'bg-red-500/20 text-red-500' :
                                'bg-gray-500/20 text-gray-500'
                              }`}>
                              {e.type}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeVisualization;
