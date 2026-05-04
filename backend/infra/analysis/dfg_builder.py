import ast
from typing import Dict, List, Optional, Set, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum


class DFGNodeType(Enum):
    """Các loại node trong DFG"""
    DEFINITION = "definition"
    USE = "use"
    PARAMETER = "parameter"
    RETURN_VALUE = "return_value"
    CALL_ARG = "call_arg"
    IMPORT = "import"


@dataclass
class DFGNode:
    """Một node trong Đồ thị Luồng dữ liệu (Data Flow Graph)"""
    id: int
    node_type: DFGNodeType
    variable: str
    lineno: int
    col_offset: int = 0
    scope: str = "global"
    
    # Theo dõi luồng
    definitions: List[int] = field(default_factory=list)  # Các node định nghĩa việc sử dụng này
    uses: List[int] = field(default_factory=list)  # Các node sử dụng định nghĩa này


@dataclass
class DataFlowEdge:
    """Một cạnh biểu diễn luồng dữ liệu"""
    source: int  # Definition node
    target: int  # Use node
    variable: str
    edge_type: str = "def-use"  # "def-use", "use-def", "param", "return"


class DataFlowGraph:
    
    def __init__(self):
        self.nodes: Dict[int, DFGNode] = {}
        self.edges: List[DataFlowEdge] = []
        self._node_counter = 0
        
        self.definitions: Dict[str, List[int]] = {}  # var -> definition nodes
        self.uses: Dict[str, List[int]] = {}  # var -> use nodes
    
    def add_definition(
        self,
        variable: str,
        lineno: int,
        col_offset: int = 0,
        scope: str = "global"
    ) -> int:
        node_id = self._node_counter
        self._node_counter += 1
        
        self.nodes[node_id] = DFGNode(
            id=node_id,
            node_type=DFGNodeType.DEFINITION,
            variable=variable,
            lineno=lineno,
            col_offset=col_offset,
            scope=scope
        )
        
        if variable not in self.definitions:
            self.definitions[variable] = []
        self.definitions[variable].append(node_id)
        
        return node_id
    
    def add_use(
        self,
        variable: str,
        lineno: int,
        col_offset: int = 0,
        scope: str = "global"
    ) -> int:
        node_id = self._node_counter
        self._node_counter += 1
        
        self.nodes[node_id] = DFGNode(
            id=node_id,
            node_type=DFGNodeType.USE,
            variable=variable,
            lineno=lineno,
            col_offset=col_offset,
            scope=scope
        )
        
        if variable not in self.uses:
            self.uses[variable] = []
        self.uses[variable].append(node_id)
        
        return node_id
    
    def add_edge(self, source: int, target: int, variable: str, edge_type: str = "def-use"):
        """Thêm một cạnh luồng dữ liệu"""
        self.edges.append(DataFlowEdge(source, target, variable, edge_type))
        
        if source in self.nodes:
            self.nodes[source].uses.append(target)
        if target in self.nodes:
            self.nodes[target].definitions.append(source)
    
    def get_reaching_definitions(self, use_node: int) -> List[int]:
        """Lấy tất cả các định nghĩa có thể đến được việc sử dụng này"""
        if use_node not in self.nodes:
            return []
        return self.nodes[use_node].definitions
    
    def get_uses_of_definition(self, def_node: int) -> List[int]:
        """Lấy tất cả các việc sử dụng của một định nghĩa"""
        if def_node not in self.nodes:
            return []
        return self.nodes[def_node].uses
    
    def find_unused_definitions(self) -> List[DFGNode]:
        """Tìm các định nghĩa không bao giờ được sử dụng"""
        unused = []
        for node in self.nodes.values():
            if node.node_type == DFGNodeType.DEFINITION and not node.uses:
                unused.append(node)
        return unused
    
    def find_undefined_uses(self) -> List[DFGNode]:
        """Tìm các việc sử dụng không có định nghĩa"""
        undefined = []
        for node in self.nodes.values():
            if node.node_type == DFGNodeType.USE and not node.definitions:
                undefined.append(node)
        return undefined
    
    def to_dict(self) -> Dict[str, Any]:
        """Chuyển đổi DFG sang dictionary để serialization"""
        return {
            "nodes": [
                {
                    "id": n.id,
                    "type": n.node_type.value,
                    "variable": n.variable,
                    "line": n.lineno,
                    "scope": n.scope,
                    "definitions": n.definitions,
                    "uses": n.uses
                }
                for n in self.nodes.values()
            ],
            "edges": [
                {
                    "source": e.source,
                    "target": e.target,
                    "variable": e.variable,
                    "type": e.edge_type
                }
                for e in self.edges
            ],
            "variables": {
                var: {
                    "definitions": defs,
                    "uses": self.uses.get(var, [])
                }
                for var, defs in self.definitions.items()
            }
        }


class DFGBuilder(ast.NodeVisitor):
    """
    Xây dựng Đồ thị Luồng dữ liệu (Data Flow Graph) từ Python AST.
    Theo dõi các định nghĩa biến và việc sử dụng chúng.
    """
    
    def __init__(self):
        self.dfg = DataFlowGraph()
        self._scope_stack: List[str] = ["global"]
        self._current_definitions: Dict[str, List[int]] = {}  # var -> current def nodes
        # __builtins__ can be either a module or a dict depending on runtime.
        # If it's a dict, `dir(__builtins__)` returns dict attributes (not builtin names),
        # which would incorrectly treat builtins like `print`/`range` as undefined.
        if isinstance(__builtins__, dict):
            self._builtins = set(__builtins__.keys())
        else:
            self._builtins = set(dir(__builtins__))
    
    @property
    def _current_scope(self) -> str:
        return ".".join(self._scope_stack)
    
    def build(self, code: str) -> DataFlowGraph:
        """Xây dựng DFG từ mã nguồn"""
        try:
            tree = ast.parse(code)
            self.visit(tree)
            self._link_definitions_to_uses()
        except SyntaxError:
            pass
        return self.dfg
    
    def _link_definitions_to_uses(self):
        """Liên kết tất cả các định nghĩa với việc sử dụng chúng"""
        for var, use_nodes in self.dfg.uses.items():
            def_nodes = self.dfg.definitions.get(var, [])
            
            for use_id in use_nodes:
                use_node = self.dfg.nodes[use_id]
                
                # Find the most recent definition before this use
                reaching_defs = []
                for def_id in def_nodes:
                    def_node = self.dfg.nodes[def_id]
                    # Simple scope-based reaching: same or outer scope
                    if use_node.scope.startswith(def_node.scope):
                        if def_node.lineno <= use_node.lineno:
                            reaching_defs.append(def_id)
                
                # Connect to all reaching definitions
                for def_id in reaching_defs:
                    self.dfg.add_edge(def_id, use_id, var)
    
    def visit_FunctionDef(self, node: ast.FunctionDef):
        """Xử lý định nghĩa hàm"""
        # Function name is a definition in outer scope
        self.dfg.add_definition(
            node.name,
            node.lineno,
            node.col_offset,
            self._current_scope
        )
        
        # Enter function scope
        self._scope_stack.append(node.name)
        
        # Parameters are definitions in function scope
        for arg in node.args.args:
            self.dfg.add_definition(
                arg.arg,
                node.lineno,
                arg.col_offset,
                self._current_scope
            )
        
        # Visit function body
        for stmt in node.body:
            self.visit(stmt)
        
        # Exit function scope
        self._scope_stack.pop()
    
    def visit_AsyncFunctionDef(self, node):
        """Xử lý định nghĩa hàm async"""
        self.visit_FunctionDef(node)
    
    def visit_ClassDef(self, node: ast.ClassDef):
        """Xử lý định nghĩa lớp"""
        # Class name is a definition
        self.dfg.add_definition(
            node.name,
            node.lineno,
            node.col_offset,
            self._current_scope
        )
        
        # Enter class scope
        self._scope_stack.append(node.name)
        
        # Visit class body
        for stmt in node.body:
            self.visit(stmt)
        
        # Exit class scope
        self._scope_stack.pop()
    
    def visit_Assign(self, node: ast.Assign):
        """Xử lý phép gán"""
        # First visit the value (uses)
        self.visit(node.value)
        
        # Then add definitions for targets
        for target in node.targets:
            self._add_definitions_from_target(target, node.lineno)
    
    def visit_AugAssign(self, node: ast.AugAssign):
        """Xử lý phép gán kết hợp (+=, -=, etc.)"""
        # This is both a use and a definition
        if isinstance(node.target, ast.Name):
            # First it's used
            self.dfg.add_use(
                node.target.id,
                node.lineno,
                node.target.col_offset,
                self._current_scope
            )
            # Then redefined
            self.dfg.add_definition(
                node.target.id,
                node.lineno,
                node.target.col_offset,
                self._current_scope
            )
        
        # Visit the value
        self.visit(node.value)
    
    def visit_For(self, node: ast.For):
        """Xử lý vòng lặp for"""
        # Loop variable is a definition
        self._add_definitions_from_target(node.target, node.lineno)
        
        # Visit iterator (uses)
        self.visit(node.iter)
        
        # Visit body
        for stmt in node.body:
            self.visit(stmt)
        
        # Visit else
        for stmt in node.orelse:
            self.visit(stmt)
    
    def visit_Name(self, node: ast.Name):
        """Xử lý tham chiếu tên biến"""
        if isinstance(node.ctx, ast.Load):
            # This is a use
            if node.id not in self._builtins:
                self.dfg.add_use(
                    node.id,
                    node.lineno,
                    node.col_offset,
                    self._current_scope
                )
    
    def visit_Import(self, node: ast.Import):
        """Xử lý câu lệnh import"""
        for alias in node.names:
            name = alias.asname or alias.name
            self.dfg.add_definition(
                name,
                node.lineno,
                node.col_offset,
                self._current_scope
            )
    
    def visit_ImportFrom(self, node: ast.ImportFrom):
        """Xử lý câu lệnh from...import"""
        for alias in node.names:
            name = alias.asname or alias.name
            self.dfg.add_definition(
                name,
                node.lineno,
                node.col_offset,
                self._current_scope
            )
    
    def _add_definitions_from_target(self, target: ast.AST, lineno: int):
        """Thêm định nghĩa từ đích gán (target assignment)"""
        if isinstance(target, ast.Name):
            self.dfg.add_definition(
                target.id,
                lineno,
                target.col_offset,
                self._current_scope
            )
        elif isinstance(target, ast.Tuple) or isinstance(target, ast.List):
            for elt in target.elts:
                self._add_definitions_from_target(elt, lineno)
    
    def generic_visit(self, node):
        """Duyệt tất cả các node con"""
        for child in ast.iter_child_nodes(node):
            self.visit(child)


def build_dfg(code: str) -> Dict[str, Any]:
    """
    Xây dựng Đồ thị Luồng dữ liệu (DFG) từ mã nguồn Python.
    Trả về dictionary biểu diễn của DFG.
    """
    builder = DFGBuilder()
    dfg = builder.build(code)
    return dfg.to_dict()


def analyze_data_flow(code: str) -> Dict[str, Any]:
    """
    Phân tích luồng dữ liệu trong code Python.
    Trả về thông tin về định nghĩa, sử dụng biến và các vấn đề tiềm ẩn.
    """
    builder = DFGBuilder()
    dfg = builder.build(code)
    
    unused = dfg.find_unused_definitions()
    undefined = dfg.find_undefined_uses()
    
    return {
        "graph": dfg.to_dict(),
        "issues": {
            "unused_definitions": [
                {"variable": n.variable, "line": n.lineno, "scope": n.scope}
                for n in unused
            ],
            "undefined_uses": [
                {"variable": n.variable, "line": n.lineno, "scope": n.scope}
                for n in undefined
            ]
        },
        "statistics": {
            "total_definitions": len([n for n in dfg.nodes.values() if n.node_type == DFGNodeType.DEFINITION]),
            "total_uses": len([n for n in dfg.nodes.values() if n.node_type == DFGNodeType.USE]),
            "unique_variables": len(dfg.definitions)
        }
    }
