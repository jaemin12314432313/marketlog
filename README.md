# 마켓로그 (MarketLog)

전통시장 상인·소비자 신뢰 플랫폼. AI가 상품 사진으로 신선도/등급을 스캔하고, 공공 시세와 비교해 가격 신뢰도를 보여주며, 지도 기반으로 가게 위치와 연관 쿠폰(퀘스트)을 안내한다. 광주 양동시장을 파일럿으로 잡고 있다.

## 저장소 구조

```
marketlog-backend07.25/   FastAPI 백엔드
마켓로그_front0802/        React 프론트엔드 (Google AI Studio로 생성)
```

## ⚠️ 프론트 관련 중요 안내

프론트는 친구가 **Google AI Studio로 계속 재생성**한다. AI Studio는 보통 파일을 통째로 다시 뽑아내기 때문에, 프론트 쪽에 손으로 넣은 통합 코드(`src/lib/api.ts`의 인증/저장 함수 등)는 다음 재생성 때 사라질 수 있다. 그래서:

- **백엔드를 안정적인 API 계약으로 취급한다.** FastAPI가 `/docs`에서 OpenAPI 스펙을 자동 제공하므로, 프론트를 다시 뽑을 때 이 스펙을 기준으로 맞추면 된다.
- 프론트 컴포넌트 내부 구현에는 깊게 개입하지 않고, 연동에 필요한 사항은 이 문서와 `src/lib/api.ts`에 정리해둔다.
- `git init` 완료됨 — 재생성으로 무언가 사라지면 `git diff`/`git log`로 복구 가능.
- **실제로 한 번 겪은 사고**: `마켓로그_front0802` 재생성 때 AI Studio가 `src/lib/api.ts`, `vite-env.d.ts`를 통째로 지우고 그 자리에 **자체 Express 서버(`server.ts`)를 새로 생성**해서 Gemini를 프론트에서 직접 호출하고 우리 FastAPI 라우트(`/api/analyze-product` 등)와 이름이 겹치는 사고가 있었음. 재생성 후엔 항상 `server.ts` 존재 여부와 `src/lib/api.ts` 생존 여부부터 확인할 것.

## 백엔드 시작하기

```bash
cd marketlog-backend07.25
pip install -r requirements.txt
# GPU 없는 환경이면 CPU 전용 torch 휠을 쓰는 게 훨씬 빠르고 가볍다:
#   pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

# marketlog-backend07.25/.env 에 아래 값 설정 (아래 "환경변수" 절 참고)

python -m uvicorn main:app --reload --port 8000
```

Windows에서 `--reload`가 가끔 재시작 도중 멈추는 현상이 있었다 (StatReload가 "Reloading..."에서 응답 없음). 멈추면 프로세스를 강제 종료하고 `--reload` 없이 다시 띄우는 게 빠르다.

- Swagger 문서: http://localhost:8000/docs
- 헬스체크: `GET /api/health`

## 프론트 시작하기

```bash
cd 마켓로그_front0802
npm install
npm run dev
```

`.env`(`VITE_API_BASE_URL`, 기본 `http://localhost:8000`)로 백엔드 주소를 잡는다. `server.ts`는 없음 — 순수 Vite dev 서버로만 뜬다(위 사고 이력 참고).

## 데이터베이스

SQLite 파일(`marketlog-backend07.25/marketlog.db`, git-ignore됨). 서버 최초 기동 시 `db.py`/`models.py` 기준으로 테이블을 자동 생성하고, `seed.py`가 비어있는 테이블에 시드 데이터를 넣는다(재실행해도 안전).

### 모델 (`models.py`)

| 모델 | 설명 |
|---|---|
| `User` | 이메일 + bcrypt 해시 비밀번호, `role`(customer/merchant) |
| `Market` | 시장 (양동/망원/자갈치). `id`가 프론트의 `marketId` 슬러그와 동일 |
| `Store` | 시장 소속 점포. **양동시장은 광주광역시 공공데이터(`data/광주광역시_전통시장_점포_현황_20211119.csv`) 기반 실점포 463곳**(`gwangju_market_data.py`가 파싱, `import_gwangju_stores.py`로 갱신). `alley` 컬럼은 CSV의 하위 시장명(예: "양동수산시장")으로, 도슨트 생성 시 문맥으로 쓰인다. 망원/자갈치는 여전히 `Market` row만 있고 점포는 비어있음 |
| `Product` | 상품 피드. `market_id`/`region`/**`store_id`**(신규, nullable FK) 포함 — 등록 시 `shop_name`과 같은 이름의 `Store`를 자동 매칭해서 채움 |
| `Bookmark` | 유저별 찜한 `Product` 참조 |
| `ScannedProduct` | 유저별 AI 스캔 저장목록 (상품 스냅샷 전체 저장) |

## API 엔드포인트

### 인증 `/api/v1/auth`
| Method | Path | 설명 |
|---|---|---|
| POST | `/register` | 회원가입 (`email`, `password`, `role`, `displayName`, `shopName?`) → JWT |
| POST | `/login` | 로그인 → JWT |
| GET | `/me` | 현재 유저 정보 (`Authorization: Bearer <token>` 필요) |

### 저장/찜 `/api/v1/saved` (전부 Bearer 필요)
| Method | Path | 설명 |
|---|---|---|
| GET/POST/DELETE | `/bookmarks[/{product_id}]` | 찜 목록 조회/추가/삭제 |
| GET/POST/DELETE | `/scanned[/{item_id}]` | AI 스캔 저장목록 조회/추가/삭제 |

### 상품 피드 `/api/v1/consumer`, `/api`
| Method | Path | 설명 |
|---|---|---|
| GET | `/api/v1/consumer/feed` | 전체 상품 피드 (최신순, DB) |
| GET | `/api/v1/consumer/store/{store_id}/story` | 가게 스토리 (없으면 404) — **현재 프론트에서 호출하는 곳 없음(죽은 엔드포인트)** |
| POST | `/api/analyze-product` | AI 신선도 분석. 품목/등급은 자체 학습 모델(`marketlog_vision`, EfficientNetV2-S + CORAL) 실추론, 세부 점수(신선도/결함/균일도)·종합의견은 Gemini(`gemini-3.6-flash`)가 사진+등급을 보고 생성 (실패 시 기존 휴리스틱으로 폴백). 모델/이미지 없으면 Mock(`SCAN_MOCK`, 무·사과·감자 3종) — Mock의 `sellingPrice`는 KAMIS 라이브 가격이 잡히면 그 가격 기준으로 목표 할인율(`priceDiffPercent`, 9~10%)을 역산해서 채운다(절대금액을 고정하면 라이브 시세가 바뀔 때 "더 저렴함" 스토리가 깨질 수 있어서) |
| POST | `/api/docent-story` | 매장 단위 AI 도슨트 스크립트. `storeId`를 주면 **그 점포 하나**에 집중한 해설을 Gemini가 생성(점포의 실제 주소·전화번호가 담긴 `story_text`를 참고자료로 사용), 없으면 구역(`alleyName`) 단위로 폴백. 같은 점포는 30분 캐싱(무료 티어 하루 20회 제한 완화용). Gemini 실패 시 같은 데이터로 만든 템플릿 문장으로 폴백 |

공공 시세(`publicMarketPrice`)는 `kamis.py`를 통해 **KAMIS(농산물유통정보) 소매가격 API**로 조회한다(등급 특/상→상품, 보통→중품 근사 매핑, 단위별 실제 kg 환산치로 전 품목을 원/kg 기준 통일). 데이터 없는 품목(현재 감은 KAMIS에 아예 없음)이나 API 실패 시 정적 추정치로 폴백하고, 이 경우 응답의 `publicGuarantee` 문구도 "참고 시세(자체 추정치)"로 정직하게 바뀐다. 캐시는 하루 1회 갱신하되, **일시적 실패(타임아웃 등)와 "진짜 데이터 없음"을 구분**해서 실패면 5분 쿨다운 후 같은 날 안에도 재시도한다(예전엔 첫 시도가 실패하면 그날 종일 정적 폴백에 묶였음). **주의**: 지금은 전국 소매 평균이고 가락시장(도매) 데이터는 아님 — 가락시장 특정 + 등급별로 바꾸려면 `periodWholesaleProductList` API로 교체 필요 (검토 중).

### 지도 `/api/v1/map`
| Method | Path | 설명 |
|---|---|---|
| GET | `/config` | 네이버 지도 client id |
| GET | `/stores?market_name=...` | 해당 시장의 점포 핀 + 중심좌표 + **점포별 연결 상품 목록**(`products`, 신규). 지도가 너무 빽빽해지는 일반 도소매/소매 점포(463개 중 410개)는 핀에서 제외하되 DB엔 그대로 유지 (시장명 불일치 시 양동시장으로 폴백) |

### 상인 (전부 Bearer 필요, `role=merchant` 계정만 가능)
| Method | Path | 설명 |
|---|---|---|
| POST | `/api/kakao-register` | 카카오톡 채팅/이미지로 상품 등록 (Gemini 연동 예정, 현재 스텁 — 프론트에서 호출하는 곳도 없는 죽은 엔드포인트) |
| POST | `/api/v1/merchant/upload` | 사진 업로드로 상품 등록 (파일 업로드 전용, 필드 적음). 업로드 파일명은 서버가 UUID로 새로 발급하고 확장자 화이트리스트(jpg/png/webp) + 10MB 제한을 검증한다 — 예전엔 클라이언트가 보낸 파일명을 그대로 경로에 써서 path traversal이 가능했음 |
| POST | `/api/v1/merchant/products` | **신규.** `MerchantView` 수동 등록 폼용 — title/category/price/grade/imageUrl 등 JSON으로 상품 생성 |
| PUT | `/api/v1/merchant/products/{id}` | 내 상품 수정 (다른 상인 상품이면 403) |
| DELETE | `/api/v1/merchant/products/{id}` | 내 상품 삭제 (다른 상인 상품이면 403) |

등록되는 상품의 `shopName`은 요청 본문이 아니라 **로그인한 계정의 `shop_name`**에서 자동으로 채워진다(가짜 이름으로 상품 등록 불가). `customer` 계정으로 호출하면 403.

### 추천 `/api/v1/recommend?item=...`
정적 규칙 기반 연관상품 추천 (삼겹살/은갈치/딸기) — **프론트가 호출 안 함(죽은 엔드포인트)**. `ProductDetailModal`이 완전히 별개의, 더 풍부한 로컬 레시피 추천 로직을 자체적으로 갖고 있음.

## 프론트 연동 현황

| 기능 | 상태 |
|---|---|
| 상품 피드, 지도(Naver Maps 실제 SDK + 실점포 핀 + 검색), AI 스캔 분석(Gemini 해설 포함), 매장별 AI 도슨트(실시간 재생시간 포함) | 실제 연결됨 |
| 인증(회원가입/로그인) | 실제 연결됨. `LoginModal`이 이메일/비밀번호로 `/api/v1/auth/login`·`/register` 직접 호출, 토큰은 `localStorage` |
| 찜/AI스캔 저장 | 실제 연결됨. 로그인 직후 `fetchBookmarks`/`fetchScannedProducts`로 로드, 추가/삭제도 즉시 API 반영 |
| 상인 수동 상품 등록/수정/삭제 (`MerchantView`) | 실제 연결됨 (`/api/v1/merchant/products`) |
| AI 스캔에서 "내 점포 물건으로 등록" | 실제 연결됨 (동일 엔드포인트로 등록) |
| `kakaoRegister()` | `api.ts`에 함수만 있고 어느 컴포넌트도 호출 안 함 (죽은 코드) |
| 아이디/비밀번호 찾기 (`LoginModal`) | 프론트 UI는 있으나 완전히 가짜 응답 (백엔드에 이 기능 자체가 없음) |
| 지갑(퀘스트/쿠폰), 장바구니 | 이번 프론트 리디자인에서 화면 자체가 빠짐. `App.tsx`엔 `quests`/`coupons`/`handleUseCoupon` 죽은 상태로 남아있음 |
| 상품↔지도 핀 연결 | **연결됨 (신규).** `Product.store_id`로 `Store`와 FK 연결, 등록 시 `shop_name`이 같은 이름의 실점포를 자동 매칭. 지도 핀에 연결된 상품 개수 뱃지가 표시됨. 단, 즐겨찾기(하트) 버튼은 여전히 `onClick`조차 없는 장식용이고, 애초에 백엔드에 "점포 즐겨찾기" 개념 자체가 없음(`Bookmark`는 상품 전용) |

## 알려진 이슈 / TODO

- 지갑(퀘스트/쿠폰) — 백엔드 자체가 없음. 구매/이벤트 기록 흐름부터 설계 필요
- 망원/자갈치 시장은 `Store` 실데이터 없음
- 지도 좌측의 "단골 점포"(하트) 버튼 — 완전히 죽어있음. 살리려면 점포 단위 즐겨찾기 테이블/API부터 새로 만들어야 함
- 아이디/비밀번호 찾기 — 백엔드에 이 기능이 없어서 프론트가 가짜 응답만 보여줌. 실제로 쓰려면 `User.phone` 컬럼 추가 + 비밀번호 재설정 로직 신규 개발 필요
- 회원가입 폼의 휴대폰 번호 — UI엔 입력받지만 `RegisterRequest`에 필드가 없어서 서버로 전송 안 됨
- KAMIS 공공시세 — 지금은 전국 소매 평균, 가락시장 도매가 아님 (위 API 표 참고). 등급도 특/상/보통 3단계가 아니라 KAMIS의 상품/중품 2단계에 근사 매핑 중
- `감`(persimmon)은 KAMIS 품목 코드 자체가 없어서 공공시세 항상 자체 추정치로 폴백
- **Gemini 무료 티어 한도가 실사용엔 부족** — `gemini-3.6-flash`가 하루 20회로 제한되어 있어(분당 5회 제한도 별도로 있음), 지도에서 매장 몇 개만 클릭해도 하루 한도를 다 씀. 이 프로젝트는 실사용보다 데모/포트폴리오 목적이라 유료 전환은 보류 중 — 한도 초과 시엔 항상 실제 DB 데이터 기반 템플릿 문장으로 조용히 폴백하니 완전히 깨지진 않음
- **배포 파이프라인이 없음** — `marketlog-backend07.25/static/`은 7월 28일자 완전 구버전 빌드(Tailwind CDN, 네이버 키 하드코딩)가 방치돼 있고, `마켓로그_front0802/dist/`도 최근 작업 반영 전 빌드라 최신이 아님. `dist` → `static` 자동 배포 스크립트 자체가 없어서, 지금 그대로 배포하면 최근 작업이 하나도 안 보임
- **AI 모델 가중치가 git에 없음** — `checkpoints/*.pt`(156MB, item recognition + quality grading)가 `.gitignore`에 걸려있어 새 환경에 클론하면 AI 스캔이 조용히 Mock 모드로 전락. 배포 시 가중치를 별도로 옮기는 절차 필요
- **SQLite/업로드 파일의 영속성** — 대부분의 무료 PaaS(Render/Railway 등)는 파일시스템이 ephemeral이라 재배포/재시작마다 `marketlog.db`와 `uploads/`가 날아갈 수 있음. 배포 시 영구 볼륨 필요
- CORS가 `allow_origins=["*"]` + `allow_credentials=True` — 배포 전엔 실제 프론트 도메인으로 좁혀야 함
- JWT를 `localStorage`에 저장 — XSS 발생 시 탈취 가능 (httpOnly 쿠키보다 약함)

## 환경변수

`marketlog-backend07.25/.env` (git-ignore됨, 값은 각자 로컬에 보관):
- `GEMINI_API_KEY` — AI 스캔 세부점수/종합의견 생성용
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- `KAMIS_CERT_KEY`, `KAMIS_CERT_ID` — 농산물유통정보(KAMIS) Open API 인증키+아이디 (둘 다 있어야 동작)
- `JWT_SECRET` — 로컬 개발용 랜덤값. **배포 전 반드시 교체**

`마켓로그_front0802/.env`:
- `VITE_API_BASE_URL` (기본 `http://localhost:8000`)

## 지금까지 진행한 작업 (세션 요약)

1. `auth.py`(이메일+비밀번호 실계정, JWT) + `saved.py`(찜/AI스캔 저장) — SQLite 기반으로 신규 구축
2. `git init` + `.gitignore` 정리 (secrets, `node_modules`, AI 모델 가중치, DB 파일 제외) 후 초기 커밋
3. 상품 피드를 메모리 리스트(`feed_db`)에서 `Product` DB 테이블로 이전 — 서버 재시작해도 상품/찜이 유지되도록 수정
4. `Market`/`Store` 모델 통합 — 지도 점포 데이터와 가게 스토리를 하나의 소스로 정리, 시장별 필터링 버그(어떤 시장을 골라도 양동시장 데이터만 나오던 문제) 수정
5. 프론트 지역 필터 버그 발견 — 백엔드 상품에 `marketId`/`region`이 없어 기본 지역에서 피드가 안 보이던 문제, `Product` 모델에 필드 추가로 해결
6. 상인 업로드 API에 인증 연결 — `kakao-register`/`merchant/upload`는 이제 `role=merchant` 계정 로그인 필요, `shopName`은 요청 값이 아니라 로그인 계정의 `shop_name`으로 서버에서 자동 지정
7. `AiScanModal`의 카메라 버튼 배선 수정 — 중앙 셔터 버튼이 실제 카메라를 열지 않고 그냥 샘플 이미지로 재분석만 하던 버그, 갤러리용 input을 분리해 해결
8. AI Studio가 `마켓로그_front0802`를 재생성하면서 만든 중복 Express 백엔드(`server.ts`, Gemini 직접 호출) 제거 — `src/lib/api.ts`/`vite-env.d.ts` 복원, `package.json`/`.env.example`을 순수 Vite 구조로 되돌림
9. 새 프론트에서 빠졌던 연동 재배선 — 상품 피드/지도(Naver Maps 실제 SDK 포함) 백엔드 연결 복구, 로그인/회원가입을 실제 `/api/v1/auth` 호출로 전환(이메일 검증 때문에 "아이디"→"이메일" 라벨 변경), 찜/AI스캔 저장을 실제 API로 전환
10. 상인 수동 상품 등록/수정/삭제용 신규 엔드포인트 추가 (`POST/PUT/DELETE /api/v1/merchant/products`) — 기존 `merchant/upload`는 파일 업로드 전용이라 수동 입력 폼과 필드가 안 맞았음
11. AI 스캔 결과에 실제 값 반영 — 신선도/결함/균일도 세부점수와 종합의견을 Gemini(`gemini-3.6-flash`)가 사진+우리 모델이 정한 등급을 보고 생성하도록 변경 (실패 시 기존 방식으로 폴백)
12. 공공시세를 KAMIS(농산물유통정보) 소매가격 API로 실연동 (`kamis.py`) — 등급별(특/상→상품, 보통→중품) 가격 조회, 데이터 없으면 정직하게 "자체 추정치"로 라벨링
13. Mock/시드 데이터가 품목 인식 모델이 학습하지 않은 품목(은갈치/삼겹살/딸기)이었던 것을 실제 학습된 10개 클래스(무·배추·양파·마늘·양배추·감·사과·배·감귤·감자) 기준으로 전면 교체 (`SCAN_MOCK`, `seed.py`, `AiScanModal` 프리셋)
14. 광주광역시 전통시장 점포 현황 공공데이터(CSV, 463개 점포)를 `Store` 테이블에 실데이터로 반영 — 기존 양동시장 가짜 점포 3곳을 대체 (`gwangju_market_data.py`, `import_gwangju_stores.py`, `seed.py`가 재사용)
15. 지도가 너무 빽빽해서 일반 도소매/소매 점포(463개 중 410개)는 `/api/v1/map/stores` 응답에서 제외 (DB는 그대로 유지), 마커 카드에서 중복되던 카테고리 뱃지 제거, 줌 19 미만에서는 핀 자체를 숨기고 안내 문구만 표시 (같은 건물 안 점포들이 몇 미터 간격이라 클러스터링 대신 줌 게이팅으로 해결) — 마커 클러스터링도 한 번 시도했다가 사용자 피드백으로 제거함
16. 검색창을 실제로 동작하게 구현 — placeholder만 있던 장식용 input을 로드된 점포 이름/부제/취급품목 기준 실시간 필터링 드롭다운으로 교체, 결과 클릭 시 해당 위치로 지도 이동+확대+도슨트 자동 재생
17. AI 도슨트를 **구역(alley) 단위 → 매장(store) 단위**로 재설계 — 예전엔 같은 구역 안 점포를 클릭해도 다 같은 문장이 나왔음. `storeId`를 넘겨 그 점포 하나에 집중한 해설을 생성하고, 점포의 실제 주소/전화번호(`story_text`)까지 프롬프트에 포함시켜 내용을 풍부하게 함. 같은 점포는 30분 캐싱해서 Gemini 무료 티어 호출량을 줄임. 점포 마커를 클릭하기 전엔 하단 도슨트 배너 자체가 안 보이도록 수정 (예전엔 정적 기본 스크립트를 마치 실제 도슨트처럼 처음부터 띄우고 있었음)
18. 도슨트 재생시간 표시를 실제 값으로 교체 — "01:24"/"03:45"는 그냥 하드코딩된 문자열이었고 진행바도 실제 재생과 무관하게 1초에 1%씩 증가하는 가짜 시뮬레이션이었음. 이제 텍스트 길이 기반 추정 총 재생시간 + 실제 경과 시간(`Date.now()` 기준)으로 표시, 마커 클릭/재생 버튼 두 경로의 TTS 속도(rate)도 통일
19. KAMIS 연동 강화 — 단위(1단/10개 등)를 실제 kg으로 환산해서 전 품목을 원/kg 기준으로 통일(`unit_weight_kg`), 서버 기동 시 자동 갱신 + 매일 자정 재갱신 루프 추가, 일시적 API 실패와 "진짜 데이터 없음"을 구분해서 실패 시엔 5분 쿨다운 후 재시도(예전엔 하루 첫 시도가 실패하면 그날 종일 정적 폴백에 묶였음). AI 스캔 Mock 데이터의 판매가를 라이브 공공시세 기준으로 목표 할인율만큼 역산하도록 수정(라이브 연동 켜지자마자 무 데모가 "9% 저렴"이 아니라 "73% 더 비쌈"으로 나오던 버그 수정)
20. 배포 관점에서 코드 전수 점검 후 발견한 버그 수정 — `requirements.txt`에 `consumer.py`가 최상단에서 쓰는 torch/torchvision/timm/Pillow가 아예 빠져있어서 새 환경에 배포하면 서버 자체가 부팅 안 되는 문제, 상품 사진 업로드가 클라이언트 파일명을 그대로 경로에 써서 path traversal이 가능하던 취약점(서버가 UUID 파일명 발급 + 확장자/용량 검증으로 수정), `Product`-`Store` 사이 FK가 없어 상인이 등록한 상품이 지도에 전혀 반영 안 되던 문제(자동 매칭으로 연결 + 지도 API가 점포별 상품 목록 반환)
