from __future__ import annotations

from typing import Optional


def normalize_stdin(raw: Optional[str]) -> Optional[str]:
	"""Chuẩn hoá stdin người dùng trước khi chạy trong sandbox.

	Hỗ trợ các trường hợp hay gặp:
	- Người dùng nhập nhầm "/n" thay vì xuống dòng "\n".
	- Dữ liệu lưu trong DB dạng escape ("\\n", "\\t", "\\r").
	- UI/editor đã giải escape sẵn (trường hợp này không bị ảnh hưởng).
	"""
	if raw is None:
		return None

	s = str(raw)

	# Người dùng hay nhập nhầm khi gõ test thủ công
	s = s.replace("/n", "\n").replace("/t", "\t").replace("/r", "\r")

	# Nếu DB lưu dạng escape sequences
	s = s.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")

	return s


