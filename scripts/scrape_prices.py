#!/usr/bin/env python3
"""
LLMHub 가격 스크래퍼.
세 제공사 가격 페이지를 파싱해 prices.json을 갱신한다.
파싱 실패 시 기존 데이터를 유지하고 오류를 출력한다.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
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
    페이지 구조: 모델명 행(셀 1개) → Input/Output 타입 행(셀 여러 개) 반복."""
    url = "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"[WARN] Google fetch failed: {e}", file=sys.stderr)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    models_by_name: dict[str, dict] = {}
    SKIP_KEYWORDS = {"audio", "image", "grounding", "gemma", "live", "translate", "computer use"}

    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
        # Model/Type 구조 테이블만 처리 (Google 고유 형식)
        if not any("model" in h for h in headers) or not any("type" in h for h in headers):
            continue
        if "gemini" not in table.get_text().lower():
            continue

        current_name: str | None = None
        current_input: float | None = None
        current_output: float | None = None

        for row in table.find_all("tr")[1:]:
            cells = [td.get_text(separator=" ", strip=True) for td in row.find_all("td")]
            if not cells:
                continue

            if len(cells) == 1:
                # 모델명 행: 직전 모델 저장 후 새 모델 시작
                if current_name and current_input and current_output:
                    if current_name not in models_by_name:
                        model_id = re.sub(r"[^a-z0-9]+", "-", current_name.lower()).strip("-")
                        models_by_name[current_name] = {
                            "id": model_id,
                            "name": current_name,
                            "provider": "google",
                            "input_price_per_mtok": current_input,
                            "output_price_per_mtok": current_output,
                            "deprecated": False,
                        }
                name = cells[0].strip()
                if name.lower().startswith("gemini") and not any(kw in name.lower() for kw in SKIP_KEYWORDS):
                    current_name = name
                    current_input = None
                    current_output = None
                else:
                    current_name = None
            elif current_name and len(cells) >= 2:
                row_type = cells[0].lower()
                price = parse_price(cells[1])
                if price is None:
                    continue
                # text input만 수집 (audio/image/video 제외)
                if "input" in row_type and "text" in row_type and current_input is None:
                    current_input = price
                elif "text output" in row_type and current_output is None:
                    current_output = price

        # 마지막 모델 저장
        if current_name and current_input and current_output and current_name not in models_by_name:
            model_id = re.sub(r"[^a-z0-9]+", "-", current_name.lower()).strip("-")
            models_by_name[current_name] = {
                "id": model_id,
                "name": current_name,
                "provider": "google",
                "input_price_per_mtok": current_input,
                "output_price_per_mtok": current_output,
                "deprecated": False,
            }

    models = list(models_by_name.values())
    if not models:
        print("[WARN] Google: 0 models — 기존 데이터 유지", file=sys.stderr)
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


def _changes_to_table(changes: list[str]) -> str:
    """merge()가 반환한 변동 문자열 목록을 마크다운 테이블로 변환."""
    rows = []
    for line in changes:
        line = line.strip()
        m = re.match(r"(.+?) \[신규\] 입력 \$([0-9.]+) / 출력 \$([0-9.]+)", line)
        if m:
            rows.append(
                f"| {m.group(1)} | 신규 | — | ${m.group(2)} / ${m.group(3)} | — |"
            )
            continue
        name_m = re.match(r"(.+?):\s+(.+)", line)
        if name_m:
            model_name = name_m.group(1)
            for diff in name_m.group(2).split(", "):
                dm = re.match(
                    r"(입력|출력) \$([0-9.]+)→\$([0-9.]+) \(([↑↓][0-9.]+%)\)", diff.strip()
                )
                if dm:
                    rows.append(
                        f"| {model_name} | {dm.group(1)} | ${dm.group(2)} | ${dm.group(3)} | {dm.group(4)} |"
                    )
    if not rows:
        return ""
    return (
        "\n### 변동 내역\n\n"
        "| 모델 | 구분 | 이전 | 이후 | 변동률 |\n"
        "|------|------|-----:|-----:|-------:|\n"
        + "\n".join(rows) + "\n"
    )


def write_history(before_sha: str, counts: dict, changes: list[str], data: dict, success: bool) -> None:
    """HISTORY.md에 실행 결과를 맨 위에 prepend."""
    KST = timezone(timedelta(hours=9))
    now = datetime.now(KST)
    weekdays = ["월", "화", "수", "목", "금", "토", "일"]
    date_str = now.strftime(f"%Y-%m-%d ({weekdays[now.weekday()]}) %H:%M KST")

    status = "성공" if success else "실패"
    total = sum(counts.values())
    display = {"anthropic": "Anthropic", "openai": "OpenAI", "google": "Google"}
    counts_str = " · ".join(f"{display.get(p, p)} {n}개" for p, n in counts.items())
    change_label = f"{len(changes)}건" if changes else "없음"

    changes_md = _changes_to_table(changes)

    provider_order = {"anthropic": 0, "google": 1, "openai": 2}
    models = sorted(
        data.get("models", []),
        key=lambda m: (provider_order.get(m["provider"], 9), m["name"]),
    )
    snapshot_rows = "\n".join(
        f"| {display.get(m['provider'], m['provider'])} | {m['name']} "
        f"| ${m['input_price_per_mtok']:.3f} | ${m['output_price_per_mtok']:.3f} "
        f"| {'deprecated' if m.get('deprecated') else ''} |"
        for m in models
    )
    snapshot_md = (
        "\n### 전체 가격 스냅샷\n\n"
        "| 제공사 | 모델 | 입력 ($/MTok) | 출력 ($/MTok) | 비고 |\n"
        "|--------|------|-------------:|-------------:|------|\n"
        + snapshot_rows + "\n"
    )

    entry = (
        f"## {date_str}\n\n"
        f"**실행 상태:** {status}  \n"
        f"**이전 커밋:** `{before_sha}` — 롤백: `git checkout {before_sha} -- prices.json`  \n"
        f"**수집 현황:** {counts_str} (총 {total}개)  \n"
        f"**가격 변동:** {change_label}\n"
        f"{changes_md}{snapshot_md}\n---\n"
    )

    HEADER = (
        "# LLMHub 가격 수집 이력\n\n"
        "자동화된 월간 스크래핑 실행 결과를 기록합니다.  \n"
        "잘못 수집된 데이터 발견 시 각 항목의 롤백 명령어를 사용하세요.\n\n"
        "---\n"
    )

    history_file = ROOT / "HISTORY.md"
    if history_file.exists():
        existing = history_file.read_text(encoding="utf-8")
        marker = "---\n"
        idx = existing.find(marker)
        if idx != -1:
            new_content = existing[: idx + len(marker)] + "\n" + entry + existing[idx + len(marker):]
        else:
            new_content = HEADER + "\n" + entry
    else:
        new_content = HEADER + "\n" + entry

    history_file.write_text(new_content, encoding="utf-8")
    print(f"[OK] HISTORY.md 갱신 ({date_str})")


def main():
    before_sha = os.environ.get("BEFORE_SHA", "unknown")
    existing = load_existing()
    counts = {}
    anthropic = scrape_anthropic(); counts["anthropic"] = len(anthropic)
    openai    = scrape_openai();    counts["openai"]    = len(openai)
    google    = scrape_google();    counts["google"]    = len(google)
    scraped   = anthropic + openai + google

    if not scraped:
        print("[ERROR] 모든 스크래퍼 실패 — prices.json 유지", file=sys.stderr)
        write_history(before_sha, counts, [], existing, success=False)
        sys.exit(1)

    merged, changes = merge(existing, scraped)

    if changes:
        save(merged)
        summary_path = ROOT / "price_changes.txt"
        summary_path.write_text("\n".join(changes), encoding="utf-8")
        print(f"[변경] {len(changes)}건:\n" + "\n".join(changes))
    else:
        print("[변경 없음] prices.json 유지")

    write_history(before_sha, counts, changes, merged, success=True)


if __name__ == "__main__":
    main()
