# OTT 이중자막 (Dual Subs) Privacy Policy

Last updated: 2026-11-21

OTT 이중자막 (Dual Subs) is a Chrome extension that displays Korean and English subtitles together on supported OTT services, currently Netflix and Coupang Play. When a video has only one of the two subtitles, it can create the missing English or Korean subtitle with AI. It can also show a Japanese subtitle line (free beta) and short expression notes beside subtitles.

## 1. What this extension does

- detects subtitle resources requested by supported OTT services
- displays Korean and English subtitles together on the video player
- creates a missing English or Korean subtitle with AI when the video provides only one of them (free beta)
- optional: replaces the English line with a Japanese line translated by AI (free beta, off by default)
- optional: shows short English expression notes beside subtitles, from a local phrase dictionary or, only if the user connects their own Gemini API key, from Google Gemini
- lets the user adjust subtitle size, color, and position, and download detected subtitle files

## 2. What data is processed locally

- the current tab URL, to check whether the page is a supported OTT playback page
- subtitle resource URLs and subtitle text retrieved directly from the supported OTT service
- subtitle preferences (size, color, position, top-line language, note depth)
- a local phrase dictionary and cached translations stored in the extension's own browser storage

## 3. What data leaves the browser, and when

**AI subtitles (free beta).** The extension sends subtitle lines to the developer's translation server (ott-api.datapopcorn.ai, operated on Cloudflare) only in these cases:

- dual subtitles are on and the video provides only Korean or only English subtitles: the available subtitle lines are sent to create the missing language;
- the user selects 日本語 as the top-line language: the English subtitle lines (or Korean, if there is no English) are sent to create Japanese.

Lines are sent in batches of up to 40, together with the source and target language, the extension version, and a random install ID created by the extension. The random install ID is not linked to any account, name, email, or device identifier. The server forwards the lines to Google Gemini (Google's paid API) and returns the result.

- The server stores generated subtitle lines (the AI output), keyed by a one-way SHA-256 hash of the source batch, so the same subtitles are not generated again for anyone. The source subtitle lines themselves, page URLs, video titles, and IP addresses are not stored, and stored subtitles are not linked to an install ID. A stored result is returned only to a request that sends the exact same source lines. Stored subtitles are deleted 12 months after their last use.
- The server keeps daily usage counters per random install ID (number of requests, generated and reused lines, characters, AI tokens, errors, extension version) to measure beta usage, control costs, and enforce daily free limits. These counters are kept for up to 12 months.
- Generated subtitles are also cached in the user's own browser.
- Turning dual subtitles off stops all requests. When both Korean and English subtitles are available and the top line is English, nothing is sent.

**Optional AI expression notes (off by default).** Only if the user enters their own Gemini API key and agrees to automatic sending, the current English and Korean subtitle lines (and, if selected, one adjacent English line) are sent directly from the browser to Google Gemini. This request does not go through the developer's server. Google's terms and data policy for the user's own key apply.

## 4. What is not collected

- no account, name, email, or other personal identifier
- no browsing history outside supported playback pages
- no analytics, advertising, or tracking SDKs
- no sale of data, and no use of data for advertising, profiling, or credit decisions

## 5. Chrome permissions

- `webRequest`: to detect subtitle file requests from supported OTT services
- `tabs`: to identify supported playback tabs and communicate with the active tab
- `storage`: to keep subtitle state, preferences, the phrase dictionary, and generated subtitle cache locally
- host permissions for supported OTT domains: to run on supported playback pages and process subtitle resources
- optional host permission for generativelanguage.googleapis.com: requested only when the user connects their own Gemini API key for expression notes

## 6. Third-party services

- the supported OTT websites the user opens
- Google Gemini API, used by the developer's translation server for AI subtitles, and directly by the browser for expression notes only if the user connects their own key
- Cloudflare, which hosts the developer's translation server

## 7. Changes to this policy

If this policy changes, the updated version will be published with a new date.

## 8. Contact

- dev@datapopcorn.ai

---

# OTT 이중자막 (Dual Subs) 개인정보처리방침

최종 업데이트일: 2026-11-21

OTT 이중자막 (Dual Subs)은 넷플릭스와 쿠팡플레이에서 한국어와 영어 자막을 함께 보여주는 Chrome 확장 프로그램입니다. 영상에 두 자막 중 하나만 있으면 없는 영어 또는 한국어 자막을 AI로 만들어 보여줍니다. 일본어 자막(무료 베타)과 자막 옆 표현 주석도 선택해 쓸 수 있습니다.

## 1. 기능

- 지원 OTT 서비스가 요청하는 자막 리소스를 감지
- 영상 위에 한국어와 영어 자막을 함께 표시
- 영상이 한국어 또는 영어 자막 하나만 줄 때 없는 자막을 AI로 생성 (무료 베타)
- 선택 기능: 영어 줄을 AI로 번역한 일본어 줄로 바꿔 표시 (무료 베타, 기본값 꺼짐)
- 선택 기능: 자막 옆 영어 표현 주석. 로컬 표현 사전을 쓰고, 사용자가 직접 Gemini API 키를 연결한 경우에만 Google Gemini로 생성
- 자막 크기·색상·위치 조정, 감지된 자막 파일 다운로드

## 2. 브라우저 안에서만 처리하는 정보

- 현재 탭 URL: 지원 재생 페이지인지 확인
- 지원 OTT 서비스에서 직접 받은 자막 리소스 URL과 자막 텍스트
- 자막 설정(크기, 색상, 위치, 위 줄 언어, 주석 깊이)
- 확장 전용 브라우저 저장소에 두는 표현 사전과 번역 캐시

## 3. 외부로 보내는 정보와 보내는 경우

**AI 자막 (무료 베타).** 다음 경우에만 자막 문장을 개발자 번역 서버(ott-api.datapopcorn.ai, Cloudflare에서 운영)로 보냅니다.

- 이중자막이 켜져 있고 영상이 한국어 또는 영어 자막 하나만 줄 때: 없는 언어를 만들기 위해 있는 자막 문장을 보냅니다.
- 사용자가 위 줄 언어로 日本語를 고를 때: 일본어를 만들기 위해 영어(없으면 한국어) 자막 문장을 보냅니다.

문장은 최대 40줄씩, 원문·대상 언어, 확장 버전, 확장이 만든 무작위 설치 ID와 함께 보냅니다. 무작위 설치 ID는 계정, 이름, 이메일, 기기 식별자와 연결되지 않습니다. 서버는 문장을 Google Gemini(Google 유료 API)로 보내 결과를 돌려줍니다.

- 같은 자막을 누구에게도 다시 생성하지 않도록, 서버는 AI가 만든 자막 문장을 원문 묶음의 단방향 SHA-256 해시를 키로 저장합니다. 원문 자막 문장, 페이지 URL, 작품 제목, IP 주소는 저장하지 않으며, 저장한 자막은 설치 ID와 연결되지 않습니다. 저장한 결과는 똑같은 원문 문장을 보낸 요청에만 돌려줍니다. 마지막 사용 후 12개월이 지나면 삭제합니다.
- 베타 사용량 측정, 비용 관리, 하루 무료 한도 적용을 위해 무작위 설치 ID별 하루 사용량(요청 수, 새로 만든 줄·재사용한 줄 수, 글자 수, AI 토큰 수, 오류 수, 확장 버전)만 저장하며, 최대 12개월 보관합니다.
- 만든 자막은 사용자 브라우저에도 저장합니다.
- 이중자막을 끄면 요청을 보내지 않습니다. 한국어와 영어 자막이 모두 있고 위 줄이 영어이면 아무것도 보내지 않습니다.

**선택형 AI 표현 주석 (기본값 꺼짐).** 사용자가 본인 Gemini API 키를 입력하고 자동 전송에 동의한 경우에만, 현재 영어·한국어 자막(선택 시 앞뒤 영어 자막 1개)을 브라우저에서 Google Gemini로 직접 보냅니다. 이 요청은 개발자 서버를 거치지 않으며, 사용자 키에는 Google의 약관과 데이터 정책이 적용됩니다.

## 4. 수집하지 않는 정보

- 계정, 이름, 이메일 등 개인 식별 정보
- 지원 재생 페이지 밖의 방문 기록
- 분석·광고·추적 SDK
- 데이터 판매, 광고·프로파일링·신용 판단 목적 사용

## 5. Chrome 권한 사용 목적

- `webRequest`: 지원 OTT 서비스의 자막 파일 요청 감지
- `tabs`: 지원 재생 탭 확인과 콘텐츠 스크립트 통신
- `storage`: 자막 상태, 설정, 표현 사전, 생성 자막 캐시를 로컬에 저장
- 지원 OTT 도메인 호스트 권한: 지원 재생 페이지에서 실행하고 자막 리소스 처리
- generativelanguage.googleapis.com 선택 권한: 사용자가 표현 주석용으로 본인 Gemini 키를 연결할 때만 요청

## 6. 제3자 서비스

- 사용자가 직접 연 지원 OTT 웹사이트
- Google Gemini API: AI 자막에는 개발자 번역 서버가 사용하고, 표현 주석에서는 사용자가 본인 키를 연결한 경우에만 브라우저가 직접 사용
- Cloudflare: 개발자 번역 서버 호스팅

## 7. 정책 변경

정책이 바뀌면 새 날짜와 함께 최신 버전을 게시합니다.

## 8. 문의처

- dev@datapopcorn.ai
