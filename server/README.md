# 번역 중계 서버 (일본어 무료 베타)

- Cloudflare Worker `ott-dual-subs-beta` (계정 Dev@datapopcorn.ai, 6647a1f7…), 도메인 https://ott-api.datapopcorn.ai
- 바인딩: D1 `ott-dual-subs-usage` (`DB`, id 9a57276b-9b6f-4d08-8e86-b57089cb6b62), 시크릿 `GEMINI_API_KEY` (AI Studio 키 이름 `ott-dual-subs-beta-translate`, Default Gemini Project Tier 1)
- 모델: `gemini-3.1-flash-lite` (100만 토큰당 입력 $0.25 / 출력 $1.50)
- 한도: 설치 ID당 하루 4,000줄, 전체 하루 100,000줄 (KST 기준). 넘으면 429 `USER_LIMIT` / `DAILY_LIMIT`
- 저장: 자막 문장·번역문·IP는 저장하지 않음. `usage_daily`에 (날짜, 무작위 설치 ID, 언어)별 요청·줄·글자·토큰·오류 수만, 12개월 보관

## 사용량 보기 (D1 콘솔 또는 API)

```sql
-- 날짜별 사용자 수, 줄 수, 추정 비용(USD)
SELECT day, COUNT(DISTINCT iid) AS users, SUM(requests) AS requests, SUM(lines) AS lines,
       ROUND(SUM(in_tokens) * 0.25 / 1e6 + SUM(out_tokens) * 1.5 / 1e6, 4) AS est_usd, SUM(errors) AS errors
FROM usage_daily GROUP BY day ORDER BY day DESC;

-- 한도에 걸린 횟수
SELECT * FROM limit_events ORDER BY day DESC;
```

## 배포

대시보드 API(`PUT /accounts/{account}/workers/scripts/ott-dual-subs-beta`, 메타데이터에 `keep_bindings: ["secret_text"]`) 또는 wrangler로 `translate-worker.js`를 올린다. 키를 바꿀 때는 시크릿만 교체한다.
