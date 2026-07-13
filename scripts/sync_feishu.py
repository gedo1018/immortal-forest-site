#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
仙人森林 · IMMORTAL FOREST — Feishu (Lark) sheet -> products.json sync

Reads a Feishu spreadsheet range and builds the site's products.json,
which is the data source consumed by assets/js/catalog.js.

Designed to run inside GitHub Actions (no third-party deps — stdlib only),
so the workflow needs no `pip install`.

Environment variables:
  FEISHU_APP_ID            (required) Feishu self-built app ID
  FEISHU_APP_SECRET        (required) Feishu self-built app secret
  FEISHU_SPREADSHEET_TOKEN (required) spreadsheet token (from the sheet URL)
  FEISHU_SHEET_RANGE       (required) e.g. "Sheet1!A1:K1000"
  FEISHU_API_BASE          (optional) default https://open.feishu.cn
  OUTPUT                   (optional) path to write, default products.json
  SITE_URL                 (optional) e.g. https://immortal-forest.netlify.app
                                    used to prefix a bare "images/xxx.jpg" path
"""

import os
import sys
import json
import urllib.parse
import urllib.request
import urllib.error

API_BASE = os.environ.get("FEISHU_API_BASE", "https://open.feishu.cn").rstrip("/")
OUTPUT = os.environ.get("OUTPUT", "products.json")
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")

# Canonical field -> header synonyms (Chinese or English). First match wins.
FIELDS = ["cat", "img", "zh_name", "zh_desc", "zh_price",
          "en_name", "en_desc", "en_price", "moq", "lead", "term"]

SYNONYMS = {
    "cat":     ["cat", "分类", "类别", "category", "类型"],
    "img":     ["img", "image", "图片", "图", "产品图"],
    "zh_name": ["zh_name", "zh name", "中文名", "中文名称", "名称(中)", "名称（中）"],
    "zh_desc": ["zh_desc", "中文描述", "描述(中)", "描述（中）"],
    "zh_price":["zh_price", "中文价", "价格(中)", "单价(中)", "中文价格"],
    "en_name": ["en_name", "en name", "英文名", "英文名称", "名称(英)", "名称（英）"],
    "en_desc": ["en_desc", "英文描述", "描述(英)", "描述（英）"],
    "en_price":["en_price", "英文价", "价格(英)", "单价(英)", "英文价格"],
    "moq":     ["moq", "MOQ", "起订量", "最小起订", "最小起订量"],
    "lead":    ["lead", "交期", "lead time", "工期", "交货期"],
    "term":    ["term", "贸易术语", "贸易条款", "贸易条件", "trade term"],
}


def _norm(s):
    return (s if s is not None else "").strip()


def get_tenant_token(app_id, app_secret):
    url = API_BASE + "/open-apis/auth/v3/tenant_access_token/internal"
    data = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        j = json.loads(r.read().decode("utf-8"))
    if j.get("code") != 0:
        raise RuntimeError("Feishu token error: %s" % json.dumps(j, ensure_ascii=False))
    return j["tenant_access_token"]


def read_range(token, spreadsheet_token, rng):
    rng_enc = urllib.parse.quote(rng, safe="")
    url = API_BASE + "/open-apis/sheets/v2/spreadsheets/%s/values/%s" % (spreadsheet_token, rng_enc)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer %s" % token})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode("utf-8"))
    if j.get("code") != 0:
        raise RuntimeError("Feishu read error: %s" % json.dumps(j, ensure_ascii=False))
    return j["data"]["valueRange"]["values"]


def map_headers(header_row):
    idx = {}
    for i, h in enumerate(header_row):
        hn = _norm(h).lower()
        if not hn:
            continue
        for key, syns in SYNONYMS.items():
            if hn in [s.lower() for s in syns]:
                idx.setdefault(key, i)
                break
    return idx


def build_products(values):
    """values: list of rows (list of cells). Row 0 = headers."""
    if not values or len(values) < 2:
        return []
    idx = map_headers([_norm(x) for x in values[0]])
    out = []
    for row in values[1:]:
        if not row or all(_norm(c) == "" for c in row):
            continue

        def get(k):
            i = idx.get(k)
            if i is None or i >= len(row):
                return ""
            return _norm(row[i])

        cat = get("cat") or "stationery"
        img = get("img")
        if img and img.startswith("images/") and SITE_URL:
            img = SITE_URL + "/" + img
        out.append({
            "cat": cat,
            "img": img,
            "zh": {"name": get("zh_name"), "desc": get("zh_desc"), "price": get("zh_price")},
            "en": {"name": get("en_name"), "desc": get("en_desc"), "price": get("en_price")},
            "spec": {"moq": get("moq"), "lead": get("lead"), "term": get("term")},
        })
    return out


def main():
    app_id = os.environ.get("FEISHU_APP_ID")
    app_secret = os.environ.get("FEISHU_APP_SECRET")
    sp_token = os.environ.get("FEISHU_SPREADSHEET_TOKEN")
    rng = os.environ.get("FEISHU_SHEET_RANGE")
    if not all([app_id, app_secret, sp_token, rng]):
        print("ERROR: missing required env vars "
              "(FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_SPREADSHEET_TOKEN, FEISHU_SHEET_RANGE)",
              file=sys.stderr)
        sys.exit(1)

    token = get_tenant_token(app_id, app_secret)
    values = read_range(token, sp_token, rng)
    products = build_products(values)

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump({"products": products}, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("OK: wrote %d products to %s" % (len(products), OUTPUT))


if __name__ == "__main__":
    main()
