"""
Hybrid Code Analyzer - Kết hợp AST Analysis + Sandbox Execution
Phân tích cú pháp và thực thi động để bắt lỗi toàn diện
"""

import ast
import subprocess
import os
import logging
import time
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass

from app.settings import SANDBOX_IMAGE, EXEC_TIMEOUT_SECONDS, EXEC_MEMORY_LIMIT_MB

logger = logging.getLogger(__name__)


@dataclass
class ASTAnalysisResult:
    """Kết quả phân tích AST"""
    valid_syntax: bool
    error: Optional[str] = None
    error_line: Optional[int] = None
    
    # Thông tin cấu trúc
    has_for_loop: bool = False
    has_while_loop: bool = False
    has_function: bool = False
    has_class: bool = False
    has_recursion: bool = False
    has_return: bool = False
    
    # Metrics
    num_functions: int = 0
    num_loops: int = 0
    num_conditions: int = 0
    max_nesting: int = 0
    cyclomatic_complexity: int = 1
    
    # Các vấn đề phát hiện
    undefined_variables: List[str] = None
    unused_variables: List[str] = None
    potential_infinite_loop: bool = False
    missing_return: bool = False
    
    def __post_init__(self):
        if self.undefined_variables is None:
            self.undefined_variables = []
        if self.unused_variables is None:
            self.unused_variables = []


@dataclass
class SandboxResult:
    """Kết quả thực thi trong Sandbox"""
    success: bool
    output: str
    error: Optional[str] = None
    execution_time: float = 0.0
    memory_used_mb: float = 0.0
    timeout_reached: bool = False


@dataclass
class HybridAnalysisResult:
    """Kết quả phân tích tổng hợp từ AST + Sandbox"""
    ast_analysis: ASTAnalysisResult
    sandbox_result: Optional[SandboxResult] = None
    
    # Phân tích kết hợp
    error_type: str = "none"  # syntax, logic, runtime, infinite_loop
    error_message: str = ""
    error_line: Optional[int] = None
    
    concepts_involved: List[str] = None
    suggested_fix: str = ""
    
    def __post_init__(self):
        if self.concepts_involved is None:
            self.concepts_involved = []


class EnhancedASTVisitor(ast.NodeVisitor):
    """AST Visitor để phân tích chi tiết code structure"""
    
    def __init__(self):
        self.functions = []
        self.classes = []
        self.loops = []
        self.conditions = []
        self.variables_defined = set()
        self.variables_used = set()
        self.imports = []
        self.current_depth = 0
        self.max_depth = 0
        self.has_return = False
        self.recursion_candidates = []
        self._current_function = None
    
    def visit_FunctionDef(self, node):
        self.functions.append({
            'name': node.name,
            'args': [arg.arg for arg in node.args.args],
            'line': node.lineno,
            'has_return': any(isinstance(n, ast.Return) for n in ast.walk(node))
        })
        
        prev_function = self._current_function
        self._current_function = node.name

        self.variables_defined.add(node.name)
        
        for arg in node.args.args:
            self.variables_defined.add(arg.arg)
        
        self.current_depth += 1
        self.max_depth = max(self.max_depth, self.current_depth)
        self.generic_visit(node)
        self.current_depth -= 1
        self._current_function = prev_function
    
    def visit_ClassDef(self, node):
        self.classes.append({
            'name': node.name,
            'line': node.lineno
        })
        self.variables_defined.add(node.name)
        self.generic_visit(node)
    
    def visit_For(self, node):
        if isinstance(node.target, ast.Name):
            self.variables_defined.add(node.target.id)
        
        self.loops.append({
            'type': 'for',
            'line': node.lineno,
            'target': ast.dump(node.target)
        })
        self.current_depth += 1
        self.max_depth = max(self.max_depth, self.current_depth)
        self.generic_visit(node)
        self.current_depth -= 1
    
    def visit_While(self, node):
        is_infinite = False
        if isinstance(node.test, ast.Constant) and node.test.value is True:
            has_break = any(isinstance(n, ast.Break) for n in ast.walk(node))
            has_return = any(isinstance(n, ast.Return) for n in ast.walk(node))
            is_infinite = not (has_break or has_return)
        
        self.loops.append({
            'type': 'while',
            'line': node.lineno,
            'potential_infinite': is_infinite
        })
        self.current_depth += 1
        self.max_depth = max(self.max_depth, self.current_depth)
        self.generic_visit(node)
        self.current_depth -= 1
    
    def visit_If(self, node):
        self.conditions.append({'line': node.lineno})
        self.current_depth += 1
        self.max_depth = max(self.max_depth, self.current_depth)
        self.generic_visit(node)
        self.current_depth -= 1
    
    def visit_Assign(self, node):
        for target in node.targets:
            if isinstance(target, ast.Name):
                self.variables_defined.add(target.id)
            elif isinstance(target, ast.Tuple):
                for elt in target.elts:
                    if isinstance(elt, ast.Name):
                        self.variables_defined.add(elt.id)
        self.generic_visit(node)
    
    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.variables_used.add(node.id)
        self.generic_visit(node)
    
    def visit_Call(self, node):
        if self._current_function and isinstance(node.func, ast.Name):
            if node.func.id == self._current_function:
                self.recursion_candidates.append(self._current_function)
        self.generic_visit(node)
    
    def visit_Return(self, node):
        self.has_return = True
        self.generic_visit(node)
    
    def visit_Import(self, node):
        for alias in node.names:
            self.imports.append(alias.name)
            name = alias.asname if alias.asname else alias.name.split('.')[0]
            self.variables_defined.add(name)
        self.generic_visit(node)
    
    def visit_ImportFrom(self, node):
        self.imports.append(node.module or "")
        for alias in node.names:
            name = alias.asname if alias.asname else alias.name
            self.variables_defined.add(name)
        self.generic_visit(node)


class HybridCodeAnalyzer:
    """
    Phân tích code kết hợp AST (cấu trúc) + Sandbox (thực thi).
    Giúp phát hiện cả lỗi static và runtime.
    """
    
    # Python built-in names
    BUILTINS = {
        'print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict',
        'set', 'tuple', 'bool', 'input', 'open', 'sum', 'max', 'min',
        'abs', 'round', 'sorted', 'reversed', 'enumerate', 'zip', 'map',
        'filter', 'any', 'all', 'type', 'isinstance', 'hasattr', 'getattr',
        'setattr', 'delattr', 'super', 'object', 'True', 'False', 'None',
        'Exception', 'ValueError', 'TypeError', 'IndexError', 'KeyError',
        'AttributeError', 'ImportError', 'RuntimeError', 'StopIteration',
        '__name__', '__file__', '__doc__'
    }
    
    def __init__(self):
        self.docker_image = SANDBOX_IMAGE
        self.default_timeout = EXEC_TIMEOUT_SECONDS
        self.default_memory = f"{EXEC_MEMORY_LIMIT_MB}m"
    
    def analyze_ast(self, code: str) -> ASTAnalysisResult:
        """
        Phân tích cây cú pháp (AST) để tìm lỗi cấu trúc.
        Không thực thi code, chỉ phân tích tĩnh.
        """
        try:
            tree = ast.parse(code)
            visitor = EnhancedASTVisitor()
            visitor.visit(tree)
            
            # Phát hiện biến chưa định nghĩa (không bao gồm builtins)
            undefined = visitor.variables_used - visitor.variables_defined - self.BUILTINS
            
            # Phát hiện biến đã định nghĩa nhưng chưa được sử dụng
            unused = visitor.variables_defined - visitor.variables_used
            # Loại bỏ biến trong vòng lặp và tham số hàm
            unused = {v for v in unused if not v.startswith('_')}
            
            # Phát hiện vòng lặp vô hạn
            potential_infinite = any(
                loop.get('potential_infinite', False) 
                for loop in visitor.loops
            )
            
            # Phát hiện thiếu return trong hàm
            missing_return = False
            for func in visitor.functions:
                if not func['has_return']:
                    missing_return = True
            
            # Tính toán độ phức tạp
            # M = E - N + 2P với E=edges, N=nodes, P=connected components
            # Tính toán đơn giản: 1 + conditions + loops
            complexity = 1 + len(visitor.conditions) + len(visitor.loops)
            
            return ASTAnalysisResult(
                valid_syntax=True,
                has_for_loop=any(l['type'] == 'for' for l in visitor.loops),
                has_while_loop=any(l['type'] == 'while' for l in visitor.loops),
                has_function=len(visitor.functions) > 0,
                has_class=len(visitor.classes) > 0,
                has_recursion=len(visitor.recursion_candidates) > 0,
                has_return=visitor.has_return,
                num_functions=len(visitor.functions),
                num_loops=len(visitor.loops),
                num_conditions=len(visitor.conditions),
                max_nesting=visitor.max_depth,
                cyclomatic_complexity=complexity,
                undefined_variables=list(undefined),
                unused_variables=list(unused),
                potential_infinite_loop=potential_infinite,
                missing_return=missing_return
            )
            
        except SyntaxError as e:
            return ASTAnalysisResult(
                valid_syntax=False,
                error=str(e.msg),
                error_line=e.lineno
            )
    
    def run_in_sandbox(
        self,
        code: str,
        timeout: int = None,
        memory_limit: str = None,
        stdin_input: str = None
    ) -> SandboxResult:
        """
        Thực thi code trong Docker Sandbox để đảm bảo an toàn.
        
        Features:
        - Network disabled (--network none)
        - Memory limited (default 512MB)
        - Timeout enforced (default 10s)
        - Read-only filesystem
        """
        timeout = timeout or self.default_timeout
        memory_limit = memory_limit or self.default_memory
        
        cmd = [
            "docker", "run", "--rm",
            "--network", "none",
            "--memory", memory_limit,
            "--read-only",
            "--tmpfs", "/tmp:rw,size=64m",
            self.docker_image,
            "python", "-c", code
        ]
        
        # Thêm stdin nếu có
        stdin_data = stdin_input.encode() if stdin_input else None
        
        try:
            start_time = time.time()
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                input=stdin_input
            )
            
            execution_time = time.time() - start_time
            
            if result.returncode == 0:
                return SandboxResult(
                    success=True,
                    output=result.stdout,
                    execution_time=execution_time
                )
            else:
                return SandboxResult(
                    success=False,
                    output=result.stdout,
                    error=result.stderr,
                    execution_time=execution_time
                )
                
        except subprocess.TimeoutExpired:
            return SandboxResult(
                success=False,
                output="",
                error="Lỗi: Vòng lặp vô tận hoặc quá thời gian thực thi (timeout).",
                timeout_reached=True,
                execution_time=float(timeout)
            )
        except FileNotFoundError:
            return SandboxResult(
                success=False,
                output="",
                error="Docker không được cài đặt hoặc không tìm thấy sandbox image."
            )
        except Exception as e:
            return SandboxResult(
                success=False,
                output="",
                error=f"Lỗi thực thi: {str(e)}"
            )
    
    def analyze_hybrid(
        self,
        code: str,
        run_sandbox: bool = True,
        timeout: int = None,
        stdin_input: str = None
    ) -> HybridAnalysisResult:
        """
        Phân tích tổng hợp: AST + Sandbox.
        
        1. Phân tích AST để tìm lỗi cấu trúc
        2. Nếu syntax OK và run_sandbox=True, thực thi trong sandbox
        3. Kết hợp kết quả để đưa ra chẩn đoán
        """
        # Bước 1: Phân tích AST
        ast_result = self.analyze_ast(code)
        
        result = HybridAnalysisResult(
            ast_analysis=ast_result
        )
        
        # Nếu có lỗi syntax, trả về ngay
        if not ast_result.valid_syntax:
            result.error_type = "syntax"
            result.error_message = ast_result.error or "Lỗi cú pháp"
            result.error_line = ast_result.error_line
            result.concepts_involved = ["python syntax", "indentation"]
            return result
        
        # Phát hiện vấn đề tiềm ẩn từ AST
        if ast_result.potential_infinite_loop:
            result.error_type = "infinite_loop"
            result.error_message = "Có thể có vòng lặp vô tận (while True không có break)"
            result.concepts_involved = ["loops", "break statement", "control flow"]
        
        if ast_result.undefined_variables:
            result.error_type = "runtime"
            result.error_message = f"Biến chưa được định nghĩa: {', '.join(ast_result.undefined_variables)}"
            result.concepts_involved = ["variables", "scope"]
        
        if ast_result.missing_return and ast_result.has_function:
            result.error_type = "logic"
            result.error_message = "Hàm có thể thiếu lệnh return"
            result.concepts_involved = ["functions", "return statement"]
        
        # Bước 2: Thực thi trong sandbox (nếu được yêu cầu)
        if run_sandbox:
            sandbox_result = self.run_in_sandbox(code, timeout, stdin_input=stdin_input)
            result.sandbox_result = sandbox_result
            
            if sandbox_result.timeout_reached:
                result.error_type = "infinite_loop"
                result.error_message = "Code chạy quá lâu (có thể là vòng lặp vô tận)"
                result.concepts_involved = ["loops", "recursion", "algorithm efficiency"]
            elif not sandbox_result.success and sandbox_result.error:
                result.error_type = "runtime"
                result.error_message = sandbox_result.error
                
                # Phân tích lỗi runtime để xác định khái niệm liên quan
                error_lower = sandbox_result.error.lower()
                if "nameerror" in error_lower:
                    result.concepts_involved = ["variables", "scope", "name binding"]
                elif "typeerror" in error_lower:
                    result.concepts_involved = ["data types", "type conversion"]
                elif "indexerror" in error_lower:
                    result.concepts_involved = ["lists", "indexing", "bounds checking"]
                elif "zerodivisionerror" in error_lower:
                    result.concepts_involved = ["division", "edge cases"]
                elif "recursionerror" in error_lower:
                    result.concepts_involved = ["recursion", "base case"]
        
        return result
    
    def get_code_structure_summary(self, code: str) -> Dict[str, Any]:
        """
        Lấy tóm tắt cấu trúc code để hiển thị cho user.
        """
        ast_result = self.analyze_ast(code)
        
        if not ast_result.valid_syntax:
            return {
                "valid": False,
                "error": ast_result.error,
                "error_line": ast_result.error_line
            }
        
        return {
            "valid": True,
            "structure": {
                "functions": ast_result.num_functions,
                "loops": ast_result.num_loops,
                "conditions": ast_result.num_conditions,
                "max_nesting": ast_result.max_nesting
            },
            "features": {
                "has_recursion": ast_result.has_recursion,
                "has_classes": ast_result.has_class
            },
            "issues": {
                "undefined_variables": ast_result.undefined_variables,
                "unused_variables": ast_result.unused_variables,
                "potential_infinite_loop": ast_result.potential_infinite_loop,
                "missing_return": ast_result.missing_return
            },
            "complexity": ast_result.cyclomatic_complexity
        }


# Singleton instance
_analyzer: Optional[HybridCodeAnalyzer] = None


def get_hybrid_analyzer() -> HybridCodeAnalyzer:
    """Get singleton instance of HybridCodeAnalyzer"""
    global _analyzer
    if _analyzer is None:
        _analyzer = HybridCodeAnalyzer()
    return _analyzer
