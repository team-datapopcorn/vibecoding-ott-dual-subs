# OTT 이중자막 (Dual Subs) Privacy Policy

Last updated: 2026-11-21

OTT 이중자막 (Dual Subs) is a Chrome extension that displays Korean and English subtitles together on supported OTT services, currently Netflix and Coupang Play. It can also show a Japanese subtitle line (free beta) and short expression notes beside subtitles.

## 1. What this extension does

- detects subtitle resources requested by supported OTT services
- displays Korean and English subtitles together on the video player
- optional: replaces the English line with a Japanese line translated by AI (free beta, off by default)
- optional: shows short English expression notes beside subtitles, from a local phrase dictionary or, only if the user connects their own Gemini API key, from Google Gemini
- lets the user adjust subtitle size, color, and position, and download detected subtitle files

## 2. What data is processed locally

- the current tab URL, to check whether the page is a supported OTT playback page
- subtitle resource URLs and subtitle text retrieved directly from the supported OTT service
- subtitle preferences (size, color, position, top-line language, note depth)
- a local phrase dictionary and cached translations stored in the extension's own browser storage

## 3. What data leaves the browser, and only when you turn it on

**Japanese subtitle free beta (off by default).** When the user selects 日本語 as the top-line language, the extension sends the English subtitle lines of the video being watched, in batches of up to 40 lines, to the developer's translation server (ott-api.datapopcorn.ai, operated on Cloudflare). The server forwards these lines to Google Gemini (Google's paid API) to translate them and returns the translation. Together with the lines, the extension sends the target language, the extension version, and a random install ID created by the extension. The random install ID is not linked to any account, name, email, or device identifier.

- The server does not store subtitle lines, translations, page URLs, video titles, or IP addresses.
- The server keeps daily usage counters per random install ID (number of requests, lines, characters, AI tokens, errors, extension version) to measure beta usage, control costs, and enforce daily free limits. These counters are kept for up to 12 months.
- Translations are cached only in the user's own browser.
- Switching the top line back to English stops all translation requests.

**Optional AI expression notes (off by default).** Only if the user enters their own Gemini API key and agrees to automatic sending, the current English and Korean subtitle lines (and, if selected, one adjacent English line) are sent directly from the browser to Google Gemini. This request does not go through the developer's server. Google's terms and data policy for the user's own key apply.

## 4. What is not collected

- no account, name, email, or other personal identifier
- no browsing history outside supported playback pages
- no analytics, advertising, or tracking SDKs
- no sale of data, and no use of data for advertising, profiling, or credit decisions

## 5. Chrome permissions

- `webRequest`: to detect subtitle file requests from supported OTT services
- `tabs`: to identify supported playback tabs and communicate with the active tab
- `storage`: to keep subtitle state, preferences, the phrase dictionary, and translation cache locally
- host permissions for supported OTT domains: to run on supported playback pages and process subtitle resources
- optional host permission for generativelanguage.googleapis.com: requested only when the user connects their own Gemini API key for expression notes

## 6. Third-party services

- the supported OTT websites the user opens
- Google Gemini API, used by the developer's translation server for the Japanese beta, and directly by the browser for expression notes only if the user connects their own key
- Cloudflare, which hosts the developer's translation server

## 7. Changes to this policy

If this policy changes, the updated version will be published with a new date.

## 8. Contact

- dev@datapopcorn.ai

---

# OTT 이중자막 (Dual Subs) 개인정보처리방침

최종 업데이트일: 2026-11-21

OTT 이중자막 (Dual Subs)은 넷플릭스와 쿠팡플레이에서 한국어와 영어 자막을 함께 보여주는 Chrome 확장 프로그램입니다. 일본어 자막(무료 베타)과 자막 옆 표현 주석도 선택해 쓸 수 있습니다.

## 1. 기능

- 지원 OTT 서비스가 요청하는 자막 리소스를 감지
- 영상 위에 한국어와 영어 자막을 함께 표시
- 선택 기능: 영어 줄을 AI로 번역한 일본어 줄로 바꿔 표시 (무료 베타, 기본값 꺼짐)
- 선택 기능: 자막 옆 영어 표현 주석. 로컬 표현 사전을 쓰고, 사용자가 직접 Gemini API 키를 연결한 경우에만 Google Gemini로 생성
- 자막 크기·색상·위치 조정, 감지된 자막 파일 다운로드

## 2. 브라우저 안에서만 처리하는 정보

- 현재 탭 URL: 지원 재생 페이지인지 확인
- 지원 OTT 서비스에서 직접 받은 자막 리소스 URL과 자막 텍스트
- 자막 설정(크기, 색상, 위치, 위 줄 언어, 주석 깊이)
- 확장 전용 브라우저 저장소에 두는 표현 사전과 번역 캐시

## 3. 사용자가 켰을 때만 외부로 보내는 정보

**일본어 자막 무료 베타 (기본값 꺼짐).** 사용자가 위 줄 언어로 日本語를 고르면, 보고 있는 영상의 영어 자막 문장을 최대 40줄씩 개발자 번역 서버(ott-api.datapopcorn.ai, Cloudflare에서 운영)로 보냅니다. 서버는 이 문장을 Google Gemini(Google 유료 API)에 보내 번역한 뒤 결과를 돌려줍니다. 문장과 함께 대상 언어, 확장 버전, 확장이 만든 무작위 설치 ID를 보냅니다. 무작위 설치 ID는 계정, 이름, 이메일, 기기 식별자와 연결되지 않습니다.

- 서버는 자막 문장, 번역문, 페이지 URL, 작품 제목, IP 주소를 저장하지 않습니다.
- 베타 사용량 측정, 비용 관리, 하루 무료 한도 적용을 위해 무작위 설치 ID별 하루 사용량(요청 수, 줄 수, 글자 수, AI 토큰 수, 오류 수, 확장 버전)만 저장하며, 최대 12개월 보관합니다.
- 번역 결과는 사용자 브라우저에만 캐시합니다.
- 위 줄 언어를 영어로 되돌리면 번역 요청을 보내지 않습니다.

**선택형 AI 표현 주석 (기본값 꺼짐).** 사용자가 본인 Gemini API 키를 입력하고 자동 전송에 동의한 경우에만, 현재 영어·한국어 자막(선택 시 앞뒤 영어 자막 1개)을 브라우저에서 Google Gemini로 직접 보냅니다. 이 요청은 개발자 서버를 거치지 않으며, 사용자 키에는 Google의 약관과 데이터 정책이 적용됩니다.

## 4. 수집하지 않는 정보

- 계정, 이름, 이메일 등 개인 식별 정보
- 지원 재생 페이지 밖의 방문 기록
- 분석·광고·추적 SDK
- 데이터 판매, 광고·프로파일링·신용 판단 목적 사용

## 5. Chrome 권한 사용 목적

- `webRequest`: 지원 OTT 서비스의 자막 파일 요청 감지
- `tabs`: 지원 재생 탭 확인과 콘텐츠 스크립트 통신
- `storage`: 자막 상태, 설정, 표현 사전, 번역 캐시를 로컬에 저장
- 지원 OTT 도메인 호스트 권한: 지원 재생 페이지에서 실행하고 자막 리소스 처리
- generativelanguage.googleapis.com 선택 권한: 사용자가 표현 주석용으로 본인 Gemini 키를 연결할 때만 요청

## 6. 제3자 서비스

- 사용자가 직접 연 지원 OTT 웹사이트
- Google Gemini API: 일본어 베타에서는 개발자 번역 서버가 사용하고, 표현 주석에서는 사용자가 본인 키를 연결한 경우에만 브라우저가 직접 사용
- Cloudflare: 개발자 번역 서버 호스팅

## 7. 정책 변경

정책이 바뀌면 새 날짜와 함께 최신 버전을 게시합니다.

## 8. 문의처

- dev@datapopcorn.ai
