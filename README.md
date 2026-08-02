# 마켓로그 (MarketLog)

전통시장 상인·소비자 신뢰 플랫폼. AI가 상품 사진으로 신선도/등급을 스캔하고, 공공 시세와 비교해 가격 신뢰도를 보여주며, 지도 기반으로 가게 위치와 연관 쿠폰(퀘스트)을 안내한다. 광주 양동시장을 파일럿으로 잡고 있다.

## 저장소 구조

```
marketlog-backend07.25/   FastAPI 백엔드
마켓로그_프론트0729/         React 프론트엔드 (Google AI Studio로 생성)
```

## ⚠️ 프론트 관련 중요 안내

프론트는 친구가 **Google AI Studio로 계속 재생성**한다. AI Studio는 보통 파일을 통째로 다시 뽑아내기 때문에, 프론트 쪽에 손으로 넣은 통합 코드(`src/lib/api.ts`의 인증/저장 함수 등)는 다음 재생성 때 사라질 수 있다. 그래서:

- **백엔드를 안정적인 API 계약으로 취급한다.** FastAPI가 `/docs`에서 OpenAPI 스펙을 자동 제공하므로, 프론트를 다시 뽑을 때 이 스펙을 기준으로 맞추면 된다.
- 프론트 컴포넌트 내부 구현에는 깊게 개입하지 않고, 연동에 필요한 사항은 이 문서와 `src/lib/api.ts`에 정리해둔다.
- `git init` 완료됨 — 재생성으로 무언가 사라지면 `git diff`/`git log`로 복구 가능.

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
cd 마켓로그_프론트0729
npm install
npm run dev
```

`.env`(`VITE_API_BASE_URL`, 기본 `http://localhost:8000`)로 백엔드 주소를 잡는다.

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
| GET | `/api/v1/consumer/store/{store_id}/story` | 가게 스토리 (없으면 404) |
| POST | `/api/analyze-product` | AI 신선도 분석 (모델 있으면 실추론, 없으면 Mock) |
| POST | `/api/docent-story` | 도슨트 스크립트 (정적 스텁, Gemini 미연동) |

### 지도 `/api/v1/map`
| Method | Path | 설명 |
|---|---|---|
| GET | `/config` | 네이버 지도 client id |
| GET | `/stores?market_name=...` | 해당 시장의 점포 핀 + 중심좌표 (시장명 불일치 시 양동시장으로 폴백) |

### 상인 (전부 Bearer 필요, `role=merchant` 계정만 가능)
| Method | Path | 설명 |
|---|---|---|
| POST | `/api/kakao-register` | 카카오톡 채팅/이미지로 상품 등록 (Gemini 연동 예정, 현재 스텁) |
| POST | `/api/v1/merchant/upload` | 사진 업로드로 상품 등록 |

등록되는 상품의 `shopName`은 요청 본문이 아니라 **로그인한 계정의 `shop_name`**에서 자동으로 채워진다(가짜 이름으로 상품 등록 불가). `customer` 계정으로 호출하면 403.

### 추천 `/api/v1/recommend?item=...`
정적 규칙 기반 연관상품 추천 (삼겹살/은갈치/딸기).

## 프론트 연동 현황

| 기능 | 상태 |
|---|---|
| 상품 피드, 지도, AI 스캔 분석, 도슨트 | 실제 연결됨 |
| 인증(회원가입/로그인), 찜/AI스캔 저장 | 백엔드 + `api.ts` 클라이언트 함수는 준비됨, **`LoginModal`/`App.tsx`/`SavedView` 배선은 아직 안 함** (로컬 state로만 동작) |
| `kakaoRegister()` | `api.ts`에 함수만 있고 어느 컴포넌트도 호출 안 함 (죽은 코드) |
| 지갑(퀘스트/쿠폰), 장바구니 | 백엔드 없음, 프론트 정적 데이터(`initialData.ts`)로만 동작 |

## 알려진 이슈 / TODO

- 지갑(퀘스트/쿠폰) — 구매/이벤트를 기록하는 흐름이 없어서 보류 중. 먼저 주문/이벤트 기록이 필요
- 망원/자갈치 시장은 `Store` 실데이터 없음
- 프론트 LoginModal에 이메일/비밀번호 입력 폼이 없음 (지금은 role만 선택하는 데모 UI) — 실계정 인증을 쓰려면 폼 추가 필요

## 환경변수

`marketlog-backend07.25/.env` (git-ignore됨, 값은 각자 로컬에 보관):
- `GEMINI_API_KEY`
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- `JWT_SECRET` — 로컬 개발용 랜덤값. **배포 전 반드시 교체**

`마켓로그_프론트0729/.env`:
- `VITE_API_BASE_URL` (기본 `http://localhost:8000`)

## 지금까지 진행한 작업 (세션 요약)

1. `auth.py`(이메일+비밀번호 실계정, JWT) + `saved.py`(찜/AI스캔 저장) — SQLite 기반으로 신규 구축
2. `git init` + `.gitignore` 정리 (secrets, `node_modules`, AI 모델 가중치, DB 파일 제외) 후 초기 커밋
3. 상품 피드를 메모리 리스트(`feed_db`)에서 `Product` DB 테이블로 이전 — 서버 재시작해도 상품/찜이 유지되도록 수정
4. `Market`/`Store` 모델 통합 — 지도 점포 데이터와 가게 스토리를 하나의 소스로 정리, 시장별 필터링 버그(어떤 시장을 골라도 양동시장 데이터만 나오던 문제) 수정
5. 프론트 지역 필터 버그 발견 — 백엔드 상품에 `marketId`/`region`이 없어 기본 지역에서 피드가 안 보이던 문제, `Product` 모델에 필드 추가로 해결
6. 상인 업로드 API에 인증 연결 — `kakao-register`/`merchant/upload`는 이제 `role=merchant` 계정 로그인 필요, `shopName`은 요청 값이 아니라 로그인 계정의 `shop_name`으로 서버에서 자동 지정
7. `AiScanModal`의 카메라 버튼 배선 수정 — 중앙 셔터 버튼이 실제 카메라를 열지 않고 그냥 샘플 이미지로 재분석만 하던 버그, 갤러리용 input을 분리해 해결
