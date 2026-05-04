import ast

class VariableRenamer(ast.NodeTransformer):
    """
    AST Transformer để đổi tên biến về dạng chuẩn (var1, var2...)
    Giúp model embedding tập trung vào cấu trúc logic thay vì tên biến.
    """
    def __init__(self):
        self.var_map = {}
        self.arg_map = {}
        self.var_counter = 1
        self.arg_counter = 1

    def visit_FunctionDef(self, node):
        # Reset scope cho local vars mỗi function, nhưng giữ args map
        old_var_map = self.var_map.copy()
        
        # Rename arguments
        if node.args.args:
            for arg in node.args.args:
                if arg.arg not in self.arg_map:
                    new_name = f"arg{self.arg_counter}"
                    self.arg_map[arg.arg] = new_name
                    self.arg_counter += 1
                arg.arg = self.arg_map[arg.arg]
        
        self.generic_visit(node)
        self.var_map = old_var_map # Restore scope
        return node

    def visit_Name(self, node):
        # Chỉ rename biến thông thường (Store/Load), không rename builtin/function calls
        if isinstance(node.ctx, (ast.Store, ast.Load)):
            # Bỏ qua nếu là tên hàm builtin hoặc self
            if node.id in {'self', 'print', 'range', 'len', 'int', 'str', 'float', 'input'}:
                return node
                
            if node.id not in self.var_map:
                # Kiểm tra xem có phải là arg không
                if node.id in self.arg_map:
                    node.id = self.arg_map[node.id]
                else:
                    new_name = f"var{self.var_counter}"
                    self.var_map[node.id] = new_name
                    self.var_counter += 1
                    node.id = new_name
            else:
                node.id = self.var_map[node.id]
        return node

def normalize_code(code: str, remove_comments: bool = True, rename_vars: bool = False) -> str:
    """
    Chuẩn hoá code cho quy trình Preprocessing.
    
    Các bước xử lý:
    1. Loại bỏ docstrings và comments (nếu enable).
    2. Chuẩn hóa tên biến (nếu enable) -> var1, var2...
    3. Chuẩn hóa khoảng trắng.
    """
    if not code:
        return ""

    # Bước 1 & 2: Dùng AST
    if remove_comments or rename_vars:
        try:
            parsed = ast.parse(code)
            
            # 1. Remove Docstrings
            if remove_comments:
                for node in ast.walk(parsed):
                    if not isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef, ast.Module)):
                        continue
                    if not (node.body and isinstance(node.body[0], ast.Expr)):
                        continue
                    if hasattr(node.body[0], 'value') and isinstance(node.body[0].value, ast.Str):
                        if len(node.body) == 1:
                            node.body[0] = ast.Pass()
                        else:
                            node.body.pop(0)

            # 2. Rename Variables (Alpha Renaming)
            if rename_vars:
                renamer = VariableRenamer()
                parsed = renamer.visit(parsed)

            if hasattr(ast, 'unparse'):
                code = ast.unparse(parsed)
                
        except Exception:
            # Fallback nếu lỗi syntax (code sinh viên thường lỗi)
            pass

    # Bước 3: Regex cleaning cho comments # (nếu unparse không chạy hoặc không sạch hết)
    if remove_comments:
        lines = []
        for line in code.splitlines():
            if '#' in line:
                line = line.split('#', 1)[0]
            if line.strip():
                lines.append(line.rstrip())
        normalized = "\n".join(lines)
    else:
        lines = [line.rstrip() for line in code.splitlines() if line.strip()]
        normalized = "\n".join(lines)

    return normalized.strip() + "\n"