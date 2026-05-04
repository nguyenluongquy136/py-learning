#!/usr/bin/env python3
import sys

if __name__ == "__main__":
    if len(sys.argv) > 1:
        code_file = sys.argv[1]
        with open(code_file, 'r', encoding='utf-8-sig') as f:
            code = f.read()
        exec(code)
    else:
        print("Usage: python run_code.py <code_file>")
        sys.exit(1)
