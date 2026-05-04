import ast
from typing import Dict, List, Optional, Set, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum


class NodeType(Enum):
    """Các loại node trong CFG (Control Flow Graph)"""
    ENTRY = "entry"
    EXIT = "exit"
    STATEMENT = "statement"
    CONDITION = "condition"
    LOOP_HEADER = "loop_header"
    FUNCTION_CALL = "function_call"
    RETURN = "return"
    BREAK = "break"
    CONTINUE = "continue"
    EXCEPTION = "exception"


@dataclass
class CFGNode:
    """Một node trong Đồ thị Luồng điều khiển (Control Flow Graph)"""
    id: int
    node_type: NodeType
    ast_node: Optional[ast.AST] = None
    lineno: int = 0
    label: str = ""
    
    # Các cạnh
    successors: List[int] = field(default_factory=list)
    predecessors: List[int] = field(default_factory=list)
    
    # Cho các điều kiện (if/while)
    true_branch: Optional[int] = None
    false_branch: Optional[int] = None
    
    # Metadata
    is_loop_entry: bool = False
    is_loop_exit: bool = False
    loop_id: Optional[int] = None


@dataclass
class CFGEdge:
    """Một cạnh trong Đồ thị Luồng điều khiển"""
    source: int
    target: int
    edge_type: str = "normal"  # "normal", "true", "false", "exception"
    label: str = ""


class ControlFlowGraph:
    
    def __init__(self):
        self.nodes: Dict[int, CFGNode] = {}
        self.edges: List[CFGEdge] = []
        self.entry_node: Optional[int] = None
        self.exit_nodes: List[int] = []
        self._node_counter = 0
    
    def add_node(
        self,
        node_type: NodeType,
        ast_node: Optional[ast.AST] = None,
        label: str = ""
    ) -> int:
        node_id = self._node_counter
        self._node_counter += 1
        
        lineno = getattr(ast_node, 'lineno', 0) if ast_node else 0
        
        self.nodes[node_id] = CFGNode(
            id=node_id,
            node_type=node_type,
            ast_node=ast_node,
            lineno=lineno,
            label=label or self._get_label(ast_node)
        )
        
        return node_id
    
    def add_edge(
        self,
        source: int,
        target: int,
        edge_type: str = "normal",
        label: str = ""
    ):
        if source in self.nodes and target in self.nodes:
            self.edges.append(CFGEdge(source, target, edge_type, label))
            self.nodes[source].successors.append(target)
            self.nodes[target].predecessors.append(source)
    
    def _get_label(self, node: Optional[ast.AST]) -> str:
        """Tạo nhãn cho một node AST"""
        if node is None:
            return ""
        
        if isinstance(node, ast.If):
            return f"if (line {node.lineno})"
        elif isinstance(node, ast.While):
            return f"while (line {node.lineno})"
        elif isinstance(node, ast.For):
            return f"for (line {node.lineno})"
        elif isinstance(node, ast.FunctionDef):
            return f"def {node.name}"
        elif isinstance(node, ast.Return):
            return f"return (line {node.lineno})"
        elif isinstance(node, ast.Assign):
            targets = ", ".join(
                t.id if isinstance(t, ast.Name) else "..." 
                for t in node.targets
            )
            return f"{targets} = ... (line {node.lineno})"
        elif isinstance(node, ast.Expr):
            if isinstance(node.value, ast.Call):
                if isinstance(node.value.func, ast.Name):
                    return f"{node.value.func.id}() (line {node.lineno})"
            return f"expr (line {node.lineno})"
        else:
            return f"{node.__class__.__name__} (line {getattr(node, 'lineno', '?')})"
    
    def to_dict(self) -> Dict[str, Any]:
        """Chuyển đổi CFG sang dictionary để serialization"""
        # Normalize edge types: if an edge points backwards by id and is marked 'normal', treat as 'back'
        edges_serialized = []
        for e in self.edges:
            etype = e.edge_type
            try:
                if etype == 'normal' and e.source > e.target:
                    etype = 'back'
            except Exception:
                pass
            edges_serialized.append({
                "source": e.source,
                "target": e.target,
                "type": etype,
                "label": e.label
            })

        return {
            "nodes": [
                {
                    "id": n.id,
                    "type": n.node_type.value,
                    "label": n.label,
                    "line": n.lineno,
                    "successors": n.successors,
                    "predecessors": n.predecessors
                }
                for n in self.nodes.values()
            ],
            "edges": edges_serialized,
            "entry": self.entry_node,
            "exits": self.exit_nodes
        }


class CFGBuilder(ast.NodeVisitor):
    """
    Xây dựng Đồ thị Luồng điều khiển (Control Flow Graph) từ Python AST.
    """
    
    def __init__(self):
        self.cfg = ControlFlowGraph()
        self._current_node: Optional[int] = None
        self._loop_stack: List[Tuple[int, int]] = []  # (header, exit)
        self._function_exits: List[int] = []
    
    def build(self, code: str) -> ControlFlowGraph:
        """Xây dựng CFG từ mã nguồn"""
        try:
            tree = ast.parse(code)
            self._build_from_ast(tree)
        except SyntaxError:
            # Return empty CFG for invalid code
            pass
        return self.cfg
    
    def _build_from_ast(self, tree: ast.AST):
        """Xây dựng CFG từ AST đã parse"""
        # Create entry node
        entry = self.cfg.add_node(NodeType.ENTRY, label="ENTRY")
        self.cfg.entry_node = entry
        self._current_node = entry
        
        # Process all statements
        if isinstance(tree, ast.Module):
            for stmt in tree.body:
                self.visit(stmt)
        
        # Create exit node
        exit_node = self.cfg.add_node(NodeType.EXIT, label="EXIT")
        self.cfg.exit_nodes.append(exit_node)
        
        # Connect any dangling nodes to exit
        if self._current_node is not None:
            self.cfg.add_edge(self._current_node, exit_node)
        
        # Connect return statements to exit
        for ret_node in self._function_exits:
            self.cfg.add_edge(ret_node, exit_node)
    
    def visit_FunctionDef(self, node: ast.FunctionDef):
        """Xử lý định nghĩa hàm"""
        func_node = self.cfg.add_node(NodeType.STATEMENT, node, f"def {node.name}")
        self._connect_current(func_node)
        self._current_node = func_node
        
        # Process function body (simplified - doesn't create separate CFG)
        for stmt in node.body:
            self.visit(stmt)
    
    def visit_If(self, node: ast.If):
        """Xử lý câu lệnh if"""
        # Create condition node
        cond_node = self.cfg.add_node(NodeType.CONDITION, node)
        self._connect_current(cond_node)
        
        # Create merge point
        merge_node = self.cfg.add_node(NodeType.STATEMENT, label="merge")
        
        # Process true branch
        self._current_node = cond_node
        true_start = None
        for stmt in node.body:
            if true_start is None:
                self.visit(stmt)
                true_start = self._current_node
            else:
                self.visit(stmt)
        
        if self._current_node is not None:
            self.cfg.add_edge(self._current_node, merge_node)
        
        # Connect condition to true branch
        if true_start is not None and true_start != cond_node:
            self.cfg.nodes[cond_node].true_branch = true_start
        
        # Process else branch
        self._current_node = cond_node
        if node.orelse:
            false_start = None
            for stmt in node.orelse:
                if false_start is None:
                    self.visit(stmt)
                    false_start = self._current_node
                else:
                    self.visit(stmt)
            
            if self._current_node is not None:
                self.cfg.add_edge(self._current_node, merge_node)
            
            if false_start is not None and false_start != cond_node:
                self.cfg.nodes[cond_node].false_branch = false_start
        else:
            # No else - connect directly to merge
            self.cfg.add_edge(cond_node, merge_node, "false")
        
        self._current_node = merge_node
    
    def visit_While(self, node: ast.While):
        """Xử lý vòng lặp while"""
        # Create loop header (condition check)
        header = self.cfg.add_node(NodeType.LOOP_HEADER, node)
        self.cfg.nodes[header].is_loop_entry = True
        self._connect_current(header)
        
        # Create exit node
        exit_node = self.cfg.add_node(NodeType.STATEMENT, label="loop_exit")
        self.cfg.nodes[exit_node].is_loop_exit = True
        
        # Push loop context
        self._loop_stack.append((header, exit_node))
        
        # Process loop body
        self._current_node = header
        for stmt in node.body:
            self.visit(stmt)
        
        # Back edge to header
        if self._current_node is not None:
            self.cfg.add_edge(self._current_node, header, "back")
        
        # False branch to exit
        self.cfg.add_edge(header, exit_node, "false")
        
        # Pop loop context
        self._loop_stack.pop()
        
        self._current_node = exit_node
    
    def visit_For(self, node: ast.For):
        """Xử lý vòng lặp for"""
        # Create loop header
        header = self.cfg.add_node(NodeType.LOOP_HEADER, node)
        self.cfg.nodes[header].is_loop_entry = True
        self._connect_current(header)
        
        # Create exit node
        exit_node = self.cfg.add_node(NodeType.STATEMENT, label="loop_exit")
        self.cfg.nodes[exit_node].is_loop_exit = True
        
        # Push loop context
        self._loop_stack.append((header, exit_node))
        
        # Process loop body
        self._current_node = header
        for stmt in node.body:
            self.visit(stmt)
        
        # Back edge to header
        if self._current_node is not None:
            self.cfg.add_edge(self._current_node, header, "back")
        
        # Exit edge
        self.cfg.add_edge(header, exit_node, "exit")
        
        # Pop loop context
        self._loop_stack.pop()
        
        self._current_node = exit_node
    
    def visit_Return(self, node: ast.Return):
        """Xử lý câu lệnh return"""
        ret_node = self.cfg.add_node(NodeType.RETURN, node)
        self._connect_current(ret_node)
        self._function_exits.append(ret_node)
        self._current_node = None  # No successor
    
    def visit_Break(self, node: ast.Break):
        """Xử lý câu lệnh break"""
        break_node = self.cfg.add_node(NodeType.BREAK, node, "break")
        self._connect_current(break_node)
        
        if self._loop_stack:
            _, exit_node = self._loop_stack[-1]
            self.cfg.add_edge(break_node, exit_node, "break")
        
        self._current_node = None  # No successor in current flow
    
    def visit_Continue(self, node: ast.Continue):
        """Xử lý câu lệnh continue"""
        cont_node = self.cfg.add_node(NodeType.CONTINUE, node, "continue")
        self._connect_current(cont_node)
        
        if self._loop_stack:
            header, _ = self._loop_stack[-1]
            self.cfg.add_edge(cont_node, header, "continue")
        
        self._current_node = None  # No successor in current flow
    
    def visit_Assign(self, node: ast.Assign):
        """Xử lý phép gán"""
        stmt_node = self.cfg.add_node(NodeType.STATEMENT, node)
        self._connect_current(stmt_node)
        self._current_node = stmt_node
    
    def visit_Expr(self, node: ast.Expr):
        """Xử lý biểu thức"""
        if isinstance(node.value, ast.Call):
            stmt_node = self.cfg.add_node(NodeType.FUNCTION_CALL, node)
        else:
            stmt_node = self.cfg.add_node(NodeType.STATEMENT, node)
        self._connect_current(stmt_node)
        self._current_node = stmt_node
    
    def visit_AugAssign(self, node: ast.AugAssign):
        """Xử lý phép gán kết hợp (+=, -=, etc.)"""
        stmt_node = self.cfg.add_node(NodeType.STATEMENT, node)
        self._connect_current(stmt_node)
        self._current_node = stmt_node
    
    def generic_visit(self, node: ast.AST):
        """Xử lý mặc định cho các câu lệnh khác"""
        if isinstance(node, ast.stmt):
            stmt_node = self.cfg.add_node(NodeType.STATEMENT, node)
            self._connect_current(stmt_node)
            self._current_node = stmt_node
        super().generic_visit(node)
    
    def _connect_current(self, target: int):
        """Kết nối node hiện tại với đích"""
        if self._current_node is not None:
            self.cfg.add_edge(self._current_node, target)


def build_cfg(code: str) -> Dict[str, Any]:
    """
    Xây dựng Đồ thị Luồng điều khiển (CFG) từ mã nguồn Python.
    Trả về dictionary biểu diễn của CFG.
    """
    builder = CFGBuilder()
    cfg = builder.build(code)
    return cfg.to_dict()
