# LLMHub

LLM API 가격을 한눈에 비교하는 정적 웹사이트입니다.

**🔗 https://hajekim.github.io/llmhub/**

---

## 기능

### 가격 계산기
- 입력/출력 토큰 수를 입력하면 모델별 실제 비용을 계산
- 총 비용 기준 오름차순 정렬 및 Top 5 바 차트 시각화
- 프로바이더 필터 칩으로 원하는 회사만 선택
- Long Context 토글 (Gemini >200K, GPT >272K 구간 요금 자동 적용)
- Deprecated 모델 포함/제외 토글
- OpenRouter Chat 버튼으로 바로 대화 시작

### 가격표
- 프로바이더별 모델 전체 목록 및 입출력 단가 ($/MTok)
- Long Context 구간 요금 및 임계값 표시
- Shutdown Date 색상 경고 (임박: 주황, 종료: 빨강)
- 최신 버전 모델이 상단에 정렬

### 오픈 모델 (CSP 비교)
- AWS Bedrock · GCP Model Garden · Azure AI Foundry 서버리스 엔드포인트 가격 비교
- 동일 모델에서 가장 저렴한 CSP를 초록색으로 강조

---

## 다루는 모델

### 직접 API

| 프로바이더 | 모델 계열 |
|-----------|---------|
| Anthropic | Claude Haiku · Sonnet · Opus (3~4.x) |
| OpenAI | GPT-5.4 Nano · Mini · Codex · GPT-5.4 · 5.5 · Pro |
| Google | Gemini 2.0 · 2.5 · 3 Flash / Pro |
| xAI | Grok 4.1 Fast · 4.3 · 4.20 |

### 오픈 모델 (AWS Bedrock / GCP Model Garden)

| 패밀리 | 모델 |
|-------|------|
| Meta (Llama) | Llama 3.3 70B · Llama 4 Scout 17B · Llama 4 Maverick 17B |
| Mistral AI | Mistral Small 3.1 · Mistral Medium 3 · Ministral 3B/8B/14B · Magistral Small 1.2 · Codestral 2 · Devstral 2 135B |
| DeepSeek | DeepSeek V3.1 · V3.2 · R1 |
| Qwen (Alibaba) | Qwen3 32B · 80B · 235B · Coder 30B · Coder 480B |
| Google (Gemma) | Gemma 3 4B/12B/27B · Gemma 4 26B |
| xAI (Grok) | Grok 4.20 · Grok 4.1 Fast |

---

## 가격 출처

| 프로바이더 | 출처 |
|-----------|------|
| Anthropic | https://platform.claude.com/docs/en/about-claude/pricing |
| OpenAI | https://developers.openai.com/api/docs/pricing |
| Google (Gemini) | https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing |
| xAI | https://docs.x.ai/developers/models |
| AWS Bedrock | https://aws.amazon.com/bedrock/pricing/ |
| GCP Model Garden | https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing |
| Azure AI Foundry | https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models |

AWS 가격은 **US East (N. Virginia)** 기준. DeepSeek V3.2는 해당 리전 미제공으로 AP·EU 기준 표기.
Azure 가격은 **Global** 기준.

---

## 기술 스택

- **프론트엔드**: HTML · CSS · Vanilla JS
- **차트**: [Chart.js](https://www.chartjs.org/)
- **스타일**: [Tailwind CSS](https://tailwindcss.com/) · Dracula 테마 · Google Fonts (Google Sans, Roboto Mono)
- **배포**: GitHub Pages
- **가격 업데이트**: GitHub Actions (주간 자동화)

---

## 로컬 실행

별도 빌드 없이 정적 파일 서버로 실행합니다.

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve .
```

브라우저에서 `http://localhost:8000` 접속.

---

## 라이선스

[MIT](LICENSE)
