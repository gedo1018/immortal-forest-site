#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞书产品表 安全读写工具 (stdlib only, 无需 pip install)

设计原则: 绝不盲改。
  - read   把整张表读出来, 打印对齐表格并缓存到 .cache/feishu_read.json
  - plan   读取 plan.json(要改的格子), 先打印"旧值 -> 新值"差异,
           必须手动输入 APPLY 才真正写入; 任意其他输入都中止, 零改动。

用法:
  python feishu_sheet.py read
  python feishu_sheet.py plan plan.json
  python feishu_sheet.py testrow        # 在下一个空行写入测试标记行(验证写链路用)
  python feishu_sheet.py clearrow <行号> # 清空指定行(清理测试行用)

plan.json 格式 (row/col 均为 1 起始, 含表头; row=1 是表头行):
  {
    "updates": [
      {"row": 2, "col": 5, "value": "¥ 3.9 / 支"},
      {"row": 3, "col": 2, "value": "images/products/p02.svg"}
    ]
  }

凭据来自本地 .env (FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_SHEET_TOKEN ...),
绝不上传、绝不入 git。
"""

import os
import sys
import json
import urllib.request
import urllib.error
from urllib.parse import quote

# ---------- 极简 .env 加载 ----------
def load_env(path=".env"):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)

load_env()

APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
SPREADSHEET_TOKEN = os.environ.get("FEISHU_SHEET_TOKEN", "")
SHEET_NAME = os.environ.get("FEISHU_SHEET_NAME", "")
DOMAIN = os.environ.get("FEISHU_DOMAIN", "open.feishu.cn").strip()

if not (APP_ID and APP_SECRET and SPREADSHEET_TOKEN):
    sys.exit("✗ 缺少凭据: 请在 .env 中设置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_SHEET_TOKEN")

API = "https://" + DOMAIN


# ---------- 低层 HTTP ----------
def call(method, path, token=None, body=None):
    url = API + path
    headers = {}
    data = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"code": -1, "msg": str(e)}


def get_token():
    j = call("POST", "/open-apis/auth/v3/tenant_access_token/internal",
             body={"app_id": APP_ID, "app_secret": APP_SECRET})
    if j.get("code") != 0:
        sys.exit("✗ 获取 token 失败: " + json.dumps(j, ensure_ascii=False))
    return j["tenant_access_token"]


def get_sheet_id(token):
    j = call("GET", "/open-apis/sheets/v3/spreadsheets/%s/sheets/query" % SPREADSHEET_TOKEN, token)
    if j.get("code") != 0:
        sys.exit("✗ 查询子表失败: " + json.dumps(j, ensure_ascii=False))
    sheets = (j.get("data") or {}).get("sheets") or []
    if not sheets:
        sys.exit("✗ 表格里没有任何子表")
    if SHEET_NAME:
        for s in sheets:
            if s.get("title") == SHEET_NAME:
                return s["sheet_id"]
        sys.exit("✗ 没找到名为 %r 的子表, 现有: %s" % (SHEET_NAME, [s.get("title") for s in sheets]))
    return sheets[0]["sheet_id"]


# ---------- 列号 <-> 字母 ----------
def col_letter(n):  # 1-based
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def read_full(token, sheet_id):
    rng = "%s!A1:Z1000" % sheet_id
    j = call("GET", "/open-apis/sheets/v2/spreadsheets/%s/values/%s" %
             (SPREADSHEET_TOKEN, quote(rng)), token)
    if j.get("code") != 0:
        sys.exit("✗ 读取失败: " + json.dumps(j, ensure_ascii=False))
    return (j.get("data") or {}).get("valueRange", {}).get("values", [])


def write_cell(token, sheet_id, row, col, value):
    rng = "%s!%s%d" % (sheet_id, col_letter(col), row)
    body = {"valueRange": {"range": rng, "values": [[value]]}}
    j = call("PUT", "/open-apis/sheets/v2/spreadsheets/%s/values" % SPREADSHEET_TOKEN, token, body)
    return j


# ---------- 命令: read ----------
def cmd_read():
    token = get_token()
    sheet_id = get_sheet_id(token)
    values = read_full(token, sheet_id)
    if not values:
        print("表格为空")
        return
    # 对齐打印
    widths = [0] * len(values[0])
    for row in values:
        for i, c in enumerate(row):
            widths[i] = max(widths[i], len(str(c)))
    def show(row):
        cells = [(str(c) if c is not None else "") for c in row]
        return " | ".join(cells[i].ljust(widths[i]) for i in range(len(cells)))
    print("子表 sheet_id = %s" % sheet_id)
    print("行数 = %d, 列数 = %d\n" % (len(values), len(values[0])))
    header = show(values[0])
    print(header)
    print("-" * len(header))
    for r in values[1:]:
        print(show(r))
    os.makedirs(".cache", exist_ok=True)
    with open(".cache/feishu_read.json", "w", encoding="utf-8") as f:
        json.dump(values, f, ensure_ascii=False, indent=2)
    print("\n已缓存到 .cache/feishu_read.json")


# ---------- 命令: plan ----------
def cmd_plan(plan_path):
    if not os.path.exists(plan_path):
        sys.exit("✗ 找不到 plan 文件: " + plan_path)
    plan = json.load(open(plan_path, encoding="utf-8"))
    updates = plan.get("updates", [])
    if not updates:
        sys.exit("✗ plan 里没有 updates")

    token = get_token()
    sheet_id = get_sheet_id(token)
    values = read_full(token, sheet_id)
    header = values[0] if values else []

    print("=== 即将执行的改动 (预览, 尚未写入) ===")
    ok = True
    for u in updates:
        row, col, val = u["row"], u["col"], u.get("value", "")
        if row < 1 or col < 1:
            print("✗ 非法坐标 row=%s col=%s" % (row, col)); ok = False; continue
        cur = values[row - 1][col - 1] if row - 1 < len(values) and col - 1 < len(values[row - 1]) else ""
        colname = "%s%d" % (col_letter(col), row)
        hname = header[col - 1] if col - 1 < len(header) else "?"
        print("  [%s] %s : %r  ->  %r" % (colname, hname, cur, val))
    if not ok:
        sys.exit("✗ 存在非法坐标, 已中止, 零改动")

    ans = input("\n确认写入以上 %d 处改动? 输入 APPLY 执行, 其他任意键中止: " % len(updates))
    if ans.strip() != "APPLY":
        print("已取消, 零改动。")
        return

    print("\n正在写入...")
    ok_count = 0
    for u in updates:
        row, col, val = u["row"], u["col"], u.get("value", "")
        j = write_cell(token, sheet_id, row, col, val)
        if j.get("code") == 0:
            ok_count += 1
            print("  ✓ %s%d" % (col_letter(col), row))
        else:
            print("  ✗ %s%d 失败: %s" % (col_letter(col), row, json.dumps(j, ensure_ascii=False)))
    print("\n完成: 成功 %d / 共 %d" % (ok_count, len(updates)))


# ---------- 命令: testrow (写入链路测试, 非交互) ----------
TEST_MARKER = "__写入测试__"

def find_next_empty_row(values):
    """从数据区(第2行起)向下找第一处 中文名(列5) 为空的行号(1-based)。"""
    for i in range(1, len(values)):
        row = values[i]
        name = row[4] if len(row) > 4 else None
        if not (name and str(name).strip()):
            return i + 1  # 1-based
    return len(values) + 1

def cmd_testrow():
    token = get_token()
    sheet_id = get_sheet_id(token)
    values = read_full(token, sheet_id)
    row = find_next_empty_row(values)
    print("下一个空行 = ROW %d (将写入测试标记行)" % row)
    marker = [
        "test", "测试", "Test", "images/products/p10.svg",
        TEST_MARKER, "写表链路测试行,验证后会自动清理", "¥ 0.01 / 测试",
        "Write Test", "Write-path test row, will be cleared.", "$0.01 / test",
        "1", "1天", "EXW",
    ]
    print("即将写入:")
    for i, v in enumerate(marker, start=1):
        print("  %s%d = %r" % (col_letter(i), row, v))
    ok = 0
    for ci, v in enumerate(marker, start=1):
        j = write_cell(token, sheet_id, row, ci, v)
        if j.get("code") == 0:
            ok += 1
        else:
            print("  ✗ %s%d 失败: %s" % (col_letter(ci), row, json.dumps(j, ensure_ascii=False)))
    print("\n写入完成: 成功 %d / 共 %d。测试行位于 ROW %d" % (ok, len(marker), row))
    if ok == len(marker):
        print("→ 用 `python feishu_sheet.py clearrow %d` 清理此测试行。" % row)

# ---------- 命令: clearrow (清空指定行) ----------
def cmd_clearrow(row):
    try:
        row = int(row)
    except ValueError:
        sys.exit("✗ 行号必须是数字")
    if row < 2:
        sys.exit("✗ 不允许清空表头或非法行")
    token = get_token()
    sheet_id = get_sheet_id(token)
    values = read_full(token, sheet_id)
    cols = len(values[0]) if values else 13
    ok = 0
    for ci in range(1, cols + 1):
        j = write_cell(token, sheet_id, row, ci, "")
        if j.get("code") == 0:
            ok += 1
    print("已清空 ROW %d: 成功 %d / 共 %d" % (row, ok, cols))

# ---------- 入口 ----------
if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("用法:\n  python feishu_sheet.py read\n  python feishu_sheet.py plan plan.json\n  python feishu_sheet.py testrow\n  python feishu_sheet.py clearrow <行号>")
    cmd = sys.argv[1]
    if cmd == "read":
        cmd_read()
    elif cmd == "plan":
        cmd_plan(sys.argv[2] if len(sys.argv) > 2 else "plan.json")
    elif cmd == "testrow":
        cmd_testrow()
    elif cmd == "clearrow":
        cmd_clearrow(sys.argv[2] if len(sys.argv) > 2 else "")
    else:
        sys.exit("未知命令: " + cmd)
