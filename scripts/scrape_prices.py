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


def normalize_openai_name(raw: str) -> str:
    """페이지 원본 이름을 표시용으로 변환. 'gpt-5.4-mini' → 'GPT-5.4 Mini'
    이미 정규화된 이름('GPT-5.5')은 소문자 'gpt-'로 시작하지 않으므로 그대로 반환."""
    if not raw.startswith("gpt-"):
        return raw
    m = re.match(r"(\d+\.\d+(?:\.\d+)?)(.*)", raw[4:])
    if m:
        version, rest = m.group(1), m.group(2).lstrip("- ")
        return f"GPT-{version}" + (f" {rest.replace('-', ' ').title()}" if rest else "")
    return raw


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
    models_by_name: dict[str, dict] = {}  # 테이블이 여러 개여도 이름 기준 중복 제거

    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        if not any("Input" in h for h in headers):
            continue
        for row in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 3:
                continue
            raw = cells[0]
            # "(deprecated)", "(retired, ...)" 등 퇴역 표기 제거 후 이름 정규화
            name = re.sub(r"\s*\((?:deprecated|retired)[^)]*\)", "", raw, flags=re.IGNORECASE).strip()
            if not name or name in models_by_name:
                continue
            deprecated = bool(re.search(r"\((?:deprecated|retired)", raw, re.IGNORECASE))
            input_price = parse_price(cells[1])
            output_price = parse_price(cells[-1])
            if input_price is None or output_price is None:
                continue
            # "Claude Opus 4.7" → "claude-opus-4-7" (claude- 이중 접두사 방지)
            model_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            models_by_name[name] = {
                "id": model_id,
                "name": name,
                "provider": "anthropic",
                "input_price_per_mtok": input_price,
                "output_price_per_mtok": output_price,
                "deprecated": deprecated,
            }

    models = list(models_by_name.values())
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
    models_by_name: dict[str, dict] = {}

    SKIP_KEYWORDS = {"realtime", "audio", "image", "video", "sora", "transcribe", "tts", "whisper", "search"}

    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
        if not any("input" in h for h in headers) or not any("output" in h for h in headers):
            continue
        # Training/fine-tuning 테이블 제외 (chat 모델 아님)
        if any("training" in h for h in headers):
            continue

        # Short/Long Context 분리 테이블 감지
        # 헤더: ['', 'short context', 'long context', 'model', 'input', 'cached input', 'output', ...]
        # 데이터 셀: [name, sc_input, sc_cached, sc_output, lc_input, lc_cached, lc_output]
        has_short_long = any("short context" in h for h in headers) and any("long context" in h for h in headers)

        if has_short_long:
            for row in table.find_all("tr")[1:]:
                cells = [td.get_text(separator=" ", strip=True) for td in row.find_all("td")]
                if len(cells) < 4:
                    continue
                raw_name = cells[0].strip()
                if not raw_name or not any(c.isdigit() for c in raw_name):
                    continue
                if any(kw in raw_name.lower() for kw in SKIP_KEYWORDS):
                    continue
                name = normalize_openai_name(raw_name)
                if name in models_by_name:
                    continue
                # Long Context 가격 우선, 없으면 Short Context로 fallback
                if len(cells) >= 7 and parse_price(cells[4]) is not None and parse_price(cells[6]) is not None:
                    input_price  = parse_price(cells[4])
                    output_price = parse_price(cells[6])
                else:
                    input_price  = parse_price(cells[1])
                    output_price = parse_price(cells[3])
                if input_price is None or output_price is None:
                    continue
                model_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
                models_by_name[name] = {
                    "id": model_id,
                    "name": name,
                    "provider": "openai",
                    "input_price_per_mtok": input_price,
                    "output_price_per_mtok": output_price,
                    "deprecated": False,
                }
            continue

        # 일반 테이블: 헤더에서 입력/출력 컬럼 위치 감지
        input_col  = next((i for i, h in enumerate(headers) if "input"  in h), 1)
        output_col = next((i for i, h in enumerate(headers) if "output" in h), 2)

        for row in table.find_all("tr")[1:]:
            # separator=' ' 로 셀 내부 요소 사이에 공백 삽입 (예: "o4-mini\nwith data sharing" → 올바른 이름)
            cells = [td.get_text(separator=" ", strip=True) for td in row.find_all("td")]
            if len(cells) <= max(input_col, output_col):
                continue

            raw_name = cells[0].strip()
            # 버전 숫자 없는 이름은 섹션 헤더 등 비모델 행 (예: "Text", "Responses")
            if not raw_name or not any(c.isdigit() for c in raw_name):
                continue
            if any(kw in raw_name.lower() for kw in SKIP_KEYWORDS):
                continue
            name = normalize_openai_name(raw_name)
            if name in models_by_name:
                continue

            input_price  = parse_price(cells[input_col])
            output_price = parse_price(cells[output_col])
            if input_price is None or output_price is None:
                continue

            model_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            models_by_name[name] = {
                "id": model_id,
                "name": name,
                "provider": "openai",
                "input_price_per_mtok": input_price,
                "output_price_per_mtok": output_price,
                "deprecated": False,
            }

    models = list(models_by_name.values())
    print(f"[OpenAI] {len(models)} models")
    return models


def scrape_google() -> list[dict]:
    """Google 가격 페이지에서 Gemini 모델 파싱.
    Google 페이지는 JS 렌더링 의존도가 높아 파싱 실패 시 기존 데이터를 유지한다."""
    url = "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"[WARN] Google fetch failed: {e}", file=sys.stderr)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    models_by_name: dict[str, dict] = {}
    SKIP_KEYWORDS = {"audio", "video", "image", "grounding", "gemma"}

    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
        if not any("input" in h for h in headers) or not any("output" in h for h in headers):
            continue

        input_col  = next((i for i, h in enumerate(headers) if "input"  in h), 1)
        output_col = next((i for i, h in enumerate(headers) if "output" in h), 2)

        for row in table.find_all("tr")[1:]:
            cells = [td.get_text(separator=" ", strip=True) for td in row.find_all("td")]
            if len(cells) <= max(input_col, output_col):
                continue
            name = cells[0].strip()
            if not name.lower().startswith("gemini"):
                continue
            if any(kw in name.lower() for kw in SKIP_KEYWORDS):
                continue
            if name in models_by_name:
                continue
            input_price  = parse_price(cells[input_col])
            output_price = parse_price(cells[output_col])
            if input_price is None or output_price is None:
                continue
            model_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            models_by_name[name] = {
                "id": model_id,
                "name": name,
                "provider": "google",
                "input_price_per_mtok": input_price,
                "output_price_per_mtok": output_price,
                "deprecated": False,
            }

    models = list(models_by_name.values())
    if not models:
        print("[WARN] Google: 0 models (JS 렌더링 페이지 — 기존 데이터 유지)", file=sys.stderr)
    else:
        print(f"[Google] {len(models)} models")
    return models


def merge(existing: dict, scraped: list[dict]) -> tuple[dict, list[str]]:
    """
    스크래핑 결과를 기존 데이터와 병합.
    - ID 우선 매칭, 없으면 이름으로 fallback (ID 형식 변경 시 중복 방지)
    - 기존에 있는 모델은 가격만 업데이트 (long_context 등 수동 필드 유지)
    - 새 모델은 추가, 사라진 모델은 유지 (수동 삭제만 가능)
    """
    existing_map = {m["id"]: m for m in existing.get("models", [])}
    existing_by_name = {m["name"]: m["id"] for m in existing.get("models", [])}
    changes = []

    for m in scraped:
        matched_id = m["id"]

        # ID 불일치 시 이름으로 fallback (ID 형식 버그 수정 후 중복 생성 방지)
        if matched_id not in existing_map and m["name"] in existing_by_name:
            old_id = existing_by_name[m["name"]]
            existing_map[m["id"]] = existing_map.pop(old_id)
            existing_by_name[m["name"]] = m["id"]

        if matched_id in existing_map:
            old = existing_map[matched_id]
            diffs = []
            for field, label in [
                ("input_price_per_mtok",  "입력"),
                ("output_price_per_mtok", "출력"),
            ]:
                old_val = old.get(field)
                new_val = m[field]
                if old_val is not None and abs(old_val - new_val) > 1e-9:
                    pct = (new_val - old_val) / old_val * 100
                    arrow = "↑" if new_val > old_val else "↓"
                    diffs.append(f"{label} ${old_val:.3f}→${new_val:.3f} ({arrow}{abs(pct):.1f}%)")
            if diffs:
                changes.append(f"  {m['name']}: {', '.join(diffs)}")
            existing_map[matched_id].update({
                "id": m["id"],
                "input_price_per_mtok":  m["input_price_per_mtok"],
                "output_price_per_mtok": m["output_price_per_mtok"],
                "deprecated": m["deprecated"],
            })
        else:
            existing_map[m["id"]] = m
            changes.append(
                f"  {m['name']} [신규] 입력 ${m['input_price_per_mtok']:.3f} / 출력 ${m['output_price_per_mtok']:.3f}"
            )

    return {"models": list(existing_map.values())}, changes


def main():
    existing = load_existing()
    scraped  = scrape_anthropic() + scrape_openai() + scrape_google()

    if not scraped:
        print("[ERROR] 모든 스크래퍼 실패 — prices.json 유지", file=sys.stderr)
        sys.exit(1)

    merged, changes = merge(existing, scraped)

    if changes:
        save(merged)
        summary_path = ROOT / "price_changes.txt"
        summary_path.write_text("\n".join(changes), encoding="utf-8")
        print(f"[변경] {len(changes)}건:\n" + "\n".join(changes))
    else:
        print("[변경 없음] prices.json 유지")


if __name__ == "__main__":
    main()
