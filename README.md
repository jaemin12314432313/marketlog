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

# marketlog-backend07.25/.env 에 아래 값 설정 (아래 "환경변수" 절 참고)

python -m uvicorn main:app --reload --port 8000
```

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
| `Store` | 시장 소속 점포. 현재 **양동시장 3곳만 실데이터**, 망원/자갈치는 `Market` row만 있고 점포는 비어있음 |
| `Product` | 상품 피드. `market_id`/`region` 포함 |
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
| POST | `/api/analyze-product` | AI 신선도 분석. 품목/등급은 자체 학습 모델(`marketlog_vision`, EfficientNetV2-S + CORAL) 실추론, 세부 점수(신선도/결함/균일도)·종합의견은 Gemini(`gemini-3.6-flash`)가 사진+등급을 보고 생성 (실패 시 기존 휴리스틱으로 폴백). 모델/이미지 없으면 Mock(`SCAN_MOCK`, 무·사과·감자 3종) |
| POST | `/api/docent-story` | 도슨트 스크립트 (정적 스텁, Gemini 미연동) |

공공 시세(`publicMarketPrice`)는 `kamis.py`를 통해 **KAMIS(농산물유통정보) 소매가격 API**로 조회한다(등급 특/상→상품, 보통→중품 근사 매핑). 데이터 없는 품목(현재 감은 KAMIS에 아예 없음)이나 API 실패 시 정적 추정치로 폴백하고, 이 경우 응답의 `publicGuarantee` 문구도 "참고 시세(자체 추정치)"로 정직하게 바뀐다. **주의**: 지금은 전국 소매 평균이고 가락시장(도매) 데이터는 아님 — 가락시장 특정 + 등급별로 바꾸려면 `periodWholesaleProductList` API로 교체 필요 (검토 중).

### 지도 `/api/v1/map`
| Method | Path | 설명 |
|---|---|---|
| GET | `/config` | 네이버 지도 client id |
| GET | `/stores?market_name=...` | 해당 시장의 점포 핀 + 중심좌표 (시장명 불일치 시 양동시장으로 폴백) |

### 상인 (전부 Bearer 필요, `role=merchant` 계정만 가능)
| Method | Path | 설명 |
|---|---|---|
| POST | `/api/kakao-register` | 카카오톡 채팅/이미지로 상품 등록 (Gemini 연동 예정, 현재 스텁) |
| POST | `/api/v1/merchant/upload` | 사진 업로드로 상품 등록 (파일 업로드 전용, 필드 적음) |
| POST | `/api/v1/merchant/products` | **신규.** `MerchantView` 수동 등록 폼용 — title/category/price/grade/imageUrl 등 JSON으로 상품 생성 |
| PUT | `/api/v1/merchant/products/{id}` | 내 상품 수정 (다른 상인 상품이면 403) |
| DELETE | `/api/v1/merchant/products/{id}` | 내 상품 삭제 (다른 상인 상품이면 403) |

등록되는 상품의 `shopName`은 요청 본문이 아니라 **로그인한 계정의 `shop_name`**에서 자동으로 채워진다(가짜 이름으로 상품 등록 불가). `customer` 계정으로 호출하면 403.

### 추천 `/api/v1/recommend?item=...`
정적 규칙 기반 연관상품 추천 (삼겹살/은갈치/딸기) — **프론트가 호출 안 함(죽은 엔드포인트)**. `ProductDetailModal`이 완전히 별개의, 더 풍부한 로컬 레시피 추천 로직을 자체적으로 갖고 있음.

## 프론트 연동 현황

| 기능 | 상태 |
|---|---|
| 상품 피드, 지도(Naver Maps 실제 SDK + 점포 핀), AI 스캔 분석(Gemini 해설 포함), 도슨트 | 실제 연결됨 |
| 인증(회원가입/로그인) | 실제 연결됨. `LoginModal`이 이메일/비밀번호로 `/api/v1/auth/login`·`/register` 직접 호출, 토큰은 `localStorage` |
| 찜/AI스캔 저장 | 실제 연결됨. 로그인 직후 `fetchBookmarks`/`fetchScannedProducts`로 로드, 추가/삭제도 즉시 API 반영 |
| 상인 수동 상품 등록/수정/삭제 (`MerchantView`) | 실제 연결됨 (`/api/v1/merchant/products`) |
| AI 스캔에서 "내 점포 물건으로 등록" | 실제 연결됨 (동일 엔드포인트로 등록) |
| `kakaoRegister()` | `api.ts`에 함수만 있고 어느 컴포넌트도 호출 안 함 (죽은 코드) |
| 아이디/비밀번호 찾기 (`LoginModal`) | 프론트 UI는 있으나 완전히 가짜 응답 (백엔드에 이 기능 자체가 없음) |
| 지갑(퀘스트/쿠폰), 장바구니 | 이번 프론트 리디자인에서 화면 자체가 빠짐. `App.tsx`엔 `quests`/`coupons`/`handleUseCoupon` 죽은 상태로 남아있음 |
| 상품↔지도 핀 연결 | **느슨함.** `Product.shop_name`은 그냥 문자열이고 `Store`와 FK 관계가 없음. 지도엔 점포 3곳(양동수산/호남상회/상록회관)만 핀이 있어서, 다른 이름으로 등록된 상품은 "지도에서 보기"를 눌러도 안 나옴 |

## 알려진 이슈 / TODO

- **상품↔지도 연동 구조 개선** — 상인이 상품을 등록해도 지도에 자동으로 반영 안 됨 (위 표 참고). Product-Store를 실제로 연결하거나, 최소한 상품 등록 시 Store row를 자동 생성하도록 고쳐야 함
- 지갑(퀘스트/쿠폰) — 백엔드 자체가 없음. 구매/이벤트 기록 흐름부터 설계 필요
- 망원/자갈치 시장은 `Store` 실데이터 없음
- 아이디/비밀번호 찾기 — 백엔드에 이 기능이 없어서 프론트가 가짜 응답만 보여줌. 실제로 쓰려면 `User.phone` 컬럼 추가 + 비밀번호 재설정 로직 신규 개발 필요
- 회원가입 폼의 휴대폰 번호 — UI엔 입력받지만 `RegisterRequest`에 필드가 없어서 서버로 전송 안 됨
- KAMIS 공공시세 — 지금은 전국 소매 평균, 가락시장 도매가 아님 (위 API 표 참고). 등급도 특/상/보통 3단계가 아니라 KAMIS의 상품/중품 2단계에 근사 매핑 중
- `감`(persimmon)은 KAMIS 품목 코드 자체가 없어서 공공시세 항상 자체 추정치로 폴백

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
