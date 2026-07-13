#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成品牌风格的产品占位图（SVG），用于开发期测试图片渲染管线。
每个产品对应一张 images/products/pXX.svg，另生成 images/placeholder.svg 作为通用兜底。

真实产品照到位后：把照片丢进 images/products/（建议 WebP/AVIF，< 1MB），
飞书「图片」列把值改成对应文件名即可，例如 images/products/p02.webp
"""
import json
import os
import subprocess
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "images", "products")
API = "https://immortal-forest-site.pages.dev/api/products"

FONT = "'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', system-ui, sans-serif"
EMERALD = "#2bd47d"
BRIGHT = "#4dffa6"


def fetch_products():
    try:
        with urllib.request.urlopen(API, timeout=25) as r:
            data = json.load(r)
        return data.get("products", [])
    except Exception as e:
        print("WARN fetch failed:", e)
        return []


def svg(name, cat, label):
    safe = name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c1f17"/>
      <stop offset="0.55" stop-color="#0f3a2c"/>
      <stop offset="1" stop-color="#06251c"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.72" cy="0.28" r="0.85">
      <stop offset="0" stop-color="{EMERALD}" stop-opacity="0.38"/>
      <stop offset="1" stop-color="{EMERALD}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <rect width="800" height="600" fill="url(#glow)"/>
  <g fill="{EMERALD}" opacity="0.07">
    {dots()}
  </g>
  <rect x="0" y="0" width="800" height="8" fill="{EMERALD}"/>
  <text x="400" y="296" text-anchor="middle" font-family="{FONT}" font-size="52" font-weight="700" fill="#eafff5">{safe}</text>
  <text x="400" y="346" text-anchor="middle" font-family="{FONT}" font-size="22" letter-spacing="6" fill="{BRIGHT}">{cat}</text>
  <text x="400" y="544" text-anchor="middle" font-family="{FONT}" font-size="15" letter-spacing="4" fill="#7fa99a">{label}</text>
</svg>
'''


def dots():
    out = []
    for x in range(60, 800, 70):
        for y in range(60, 600, 70):
            out.append(f'<circle cx="{x}" cy="{y}" r="2.2"/>')
    return "\n    ".join(out)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    products = fetch_products()
    if not products:
        # 离线兜底：线上 API 不可达时使用（名称取自 2026-07-14 线上清单）
        fallback = [
            ("飞书修改测试2", "文具纸张"), ("苔纹再生笔记本", "文具纸张"),
            ("云栖激光打印机", "办公设备"), ("雾林投影仪", "办公设备"),
            ("苔原升降桌", "家具收纳"), ("叠翠模块化柜", "家具收纳"),
            ("采购 SaaS 后台", "数字办公"), ("智能补给机器人", "数字办公"),
            ("森系环保湿巾", "清洁耗材"), ("test", "测试"),
        ]
        products = [{"zh": {"name": n}, "catLabel": {"zh": c}} for n, c in fallback]
    print("生成占位图（飞书「图片」列填写路径对照）：")
    for i, p in enumerate(products, 1):
        name = (p.get("zh") or {}).get("name") or f"产品{i}"
        cat = (p.get("catLabel") or {}).get("zh") or p.get("cat") or "sample"
        fname = f"p{i:02d}.svg"
        with open(os.path.join(OUT_DIR, fname), "w", encoding="utf-8") as f:
            f.write(svg(name, cat, "示例图 · SAMPLE · 待替换真实产品照"))
        print(f"  images/products/{fname}  ->  {name}（{cat}）")
    # 通用兜底占位
    with open(os.path.join(ROOT, "images", "placeholder.svg"), "w", encoding="utf-8") as f:
        f.write(svg("示例产品", "SAMPLE", "示例图 · SAMPLE · 待替换真实产品照"))
    print("  images/placeholder.svg  ->  通用兜底占位")
    print("完成。")


if __name__ == "__main__":
    main()
