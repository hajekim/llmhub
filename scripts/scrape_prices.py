#!/usr/bin/env python3
"""
LLMHub 가격 스크래퍼.
세 제공사 가격 페이지를 파싱해 prices.json을 갱신한다.
파싱 실패 시 기존 데이터를 유지하고 오류를 출력한다.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent.parent
PRICES_FILE = ROOT / "prices.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; LLMHub-Scraper/1.0)"}


def load_existing() -> dict:
    if PRICES_FILE.exists():
        with open(PRICES_FILE) as f:
            return json.load(f)
    return {"models": []}


def save(data: dict) -> None:
    data["last_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(PRICES_FILE, "w") as f:
        json.dump(data, f, indent=2)
    print(f"[OK] prices.json saved ({len(data['models'])} models)")


def parse_price(text: str) -> float | None:
    """'$1.25 / MTok' 또는 '$0.075' 형태에서 float 추출."""
    m = re.search(r"\$([0-9]+(?:\.[0-9]+)?)", text)
    return float(m.group(1)) if m else None


def scrape_anthropic() -> list[dict]:
    """Anthropic 가격 페이지에서 Claude 모델 파싱."""
    url = "https://platform.claude.com/docs/en/about-claude/pricing"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"[WARN] Anthropic fetch failed: {e}", file=sys.stderr)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    models = []

    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        if not any("Input" in h for h in headers):
            continue
        for row in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 3:
                continue
            name = cells[0].replace(" (deprecated)", "").strip()
            deprecated = "deprecated" in cells[0].lower()
            input_price  = parse_price(cells[1])
            output_price = parse_price(cells[-1])
            if not name or input_price is None or output_price is None:
                continue
            model_id = "claude-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            models.append({
                "id": model_id,
                "name": name,
                "provider": "anthropic",
                "input_price_per_mtok": input_price,
                "output_price_per_mtok": output_price,
                "deprecated": deprecated,
            })

    print(f"[Anthropic] {len(models)} models")
    return models


def scrape_openai() -> list[dict]:
    """OpenAI 가격 페이지에서 GPT·o 모델 파싱."""
    url = "https://developers.openai.com/api/docs/pricing"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"[WARN] OpenAI fetch failed: {e}", file=sys.stderr)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    models = []

    SKIP_KEYWORDS = {"realtime", "audio", "image", "video", "sora", "transcribe", "tts", "whisper"}

    for table in soup.find_all("table"):
        headers_text = table.get_text().lower()
        if "input" not in headers_text or "output" not in headers_text:
            continue
        for row in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 3:
                continue
            name = cells[0].strip()
            if any(kw in name.lower() for kw in SKIP_KEYWORDS):
                continue
            input_price  = parse_price(cells[1])
            output_price = parse_price(cells[2])
            if not name or input_price is None or output_price is None:
                continue
            model_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            models.append({
                "id": model_id,
                "name": name,
                "provider": "openai",
                "input_price_per_mtok": input_price,
                "output_price_per_mtok": output_price,
                "deprecated": False,
            })

    print(f"[OpenAI] {len(models)} models")
    return models


def scrape_google() -> list[dict]:
    """Google 가격 페이지에서 Gemini 모델 파싱."""
    url = "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"[WARN] Google fetch failed: {e}", file=sys.stderr)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    models = []
    SKIP_KEYWORDS = {"audio", "video", "image", "grounding", "gemma"}

    for table in soup.find_all("table"):
        headers_text = table.get_text().lower()
        if "input" not in headers_text or "output" not in headers_text:
            continue
        for row in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 3:
                continue
            name = cells[0].strip()
            if not name.lower().startswith("gemini"):
                continue
            if any(kw in name.lower() for kw in SKIP_KEYWORDS):
                continue
            input_price  = parse_price(cells[1])
            output_price = parse_price(cells[2])
            if input_price is None or output_price is None:
                continue
            model_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            models.append({
                "id": model_id,
                "name": name,
                "provider": "google",
                "input_price_per_mtok": input_price,
                "output_price_per_mtok": output_price,
                "deprecated": False,
            })

    print(f"[Google] {len(models)} models")
    return models


def merge(existing: dict, scraped: list[dict]) -> dict:
    """
    스크래핑 결과를 기존 데이터와 병합.
    - 기존에 있는 모델은 가격만 업데이트 (long_context 필드 유지)
    - 새 모델은 추가
    - 스크래핑에서 사라진 모델은 유지 (수동 삭제만 가능)
    """
    existing_map = {m["id"]: m for m in existing.get("models", [])}
    for m in scraped:
        if m["id"] in existing_map:
            existing_map[m["id"]].update({
                "input_price_per_mtok": m["input_price_per_mtok"],
                "output_price_per_mtok": m["output_price_per_mtok"],
                "deprecated": m["deprecated"],
            })
        else:
            existing_map[m["id"]] = m
    return {"models": list(existing_map.values())}


def main():
    existing = load_existing()
    scraped  = scrape_anthropic() + scrape_openai() + scrape_google()

    if not scraped:
        print("[ERROR] 모든 스크래퍼 실패 — prices.json 유지", file=sys.stderr)
        sys.exit(1)

    merged = merge(existing, scraped)
    save(merged)


if __name__ == "__main__":
    main()
