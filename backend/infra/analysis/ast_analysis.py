import ast
from typing import Dict, List, Any, Optional



def build_ast_graph(
    code: str,
    max_nodes: int = 800,
    *,
    max_depth: int = 40,
    compact: bool = True,
) -> Dict[str, Any]:
    """Xây dựng một đồ thị AST để hiển thị.

    Return đồ thị có thể render trên UI `CodeVisualization`:
    {
        "nodes": [{"id": int, "type": str, "label": str, "line": int?}, ...],
        "edges": [{"source": int, "target": int, "type": str}],
        "entry": int,
        "truncated": bool,
        "max_nodes": int
    }
    """
    tree = ast.parse(code)

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    next_id = 1
    truncated = False

    # Loại node thường gây nhiễu cho đồ thị.
    SKIP_NODE_TYPES = (ast.Load, ast.Store, ast.Del, ast.Param)

    def node_type(n: ast.AST) -> str:
        # Map các node AST thông thường đến các loại node trong đồ thị.
        if isinstance(n, ast.Module):
            return "entry"
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return "definition"
        if isinstance(n, (ast.For, ast.While)):
            return "loop_header"
        if isinstance(n, ast.If):
            return "condition"
        if isinstance(n, ast.Return):
            return "return"
        if isinstance(n, ast.Call):
            return "function_call"
        if isinstance(n, ast.Name):
            return "use"
        return "statement"

    def node_label(n: ast.AST) -> str:
        t = type(n).__name__
        # Thêm thông tin cho dễ đọc
        try:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return f"{t}: {n.name}"
            if isinstance(n, ast.ClassDef):
                return f"{t}: {n.name}"
            if isinstance(n, ast.Name):
                return f"{t}: {n.id}"
            if isinstance(n, ast.arg):
                return f"arg: {n.arg}"
            if isinstance(n, ast.Attribute):
                return f"{t}: {n.attr}"
            if isinstance(n, ast.Constant):
                v = getattr(n, "value", None)
                s = repr(v)
                if len(s) > 16:
                    s = s[:13] + "..."
                return f"{t}: {s}"
        except Exception:
            pass
        return t

    def add_node(n: ast.AST) -> Optional[int]:
        nonlocal next_id, truncated
        if len(nodes) >= max_nodes:
            truncated = True
            return None

        nid = next_id
        next_id += 1

        node: Dict[str, Any] = {
            "id": nid,
            "type": node_type(n),
            "label": node_label(n),
        }
        if hasattr(n, "lineno"):
            try:
                node["line"] = int(getattr(n, "lineno"))
            except Exception:
                pass

        nodes.append(node)
        return nid

    def walk(n: ast.AST, parent_id: Optional[int], depth: int) -> Optional[int]:
        nonlocal truncated

        if depth > max_depth:
            truncated = True
            return parent_id

        # Trong chế độ compact, bỏ qua các node có tín hiệu thấp và gán các con của chúng vào cùng một cha.
        if compact and isinstance(n, SKIP_NODE_TYPES):
            for child in ast.iter_child_nodes(n):
                if truncated:
                    break
                walk(child, parent_id, depth + 1)
            return parent_id

        this_id = add_node(n)
        if this_id is None:
            return None

        if parent_id is not None:
            edges.append({"source": parent_id, "target": this_id, "type": "ast"})

        # Dừng mở rộng các con khi đã cắt.
        if truncated:
            return this_id

        for child in ast.iter_child_nodes(n):
            if truncated:
                break
            walk(child, this_id, depth + 1)

        return this_id

    entry_id = walk(tree, None, 0) or 1

    if truncated:
        # Thêm một nút marker cuối cùng để UI hiển thị rằng đồ thị đã bị cắt.
        marker_id = next_id
        nodes.append({"id": marker_id, "type": "statement", "label": "TRUNCATED: too many AST nodes"})
        edges.append({"source": entry_id, "target": marker_id, "type": "ast"})

    return {
        "nodes": nodes,
        "edges": edges,
        "entry": entry_id,
        "truncated": truncated,
        "max_nodes": max_nodes,
        "max_depth": max_depth,
        "compact": compact,
    }
