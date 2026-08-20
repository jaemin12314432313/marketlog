# 마켓로그 (MarketLog)

전통시장 상인·소비자 신뢰 플랫폼. AI가 상품 사진으로 품목/등급을 스캔하고, 공공 시세(KAMIS)와 비교해 가격 신뢰도를 보여주며, 지도 기반으로 실제 점포 위치와 AI 음성 도슨트를 제공한다. 광주 양동시장을 파일럿으로 잡고 있으며, Android 앱(Capacitor)으로 배포된다.

데모/포트폴리오 프로젝트로, 실사용 규모 확장(유료 인프라 전환 등)은 의도적으로 보류하고 있다.

## 저장소 구조

```
marketlog-backend07.25/   FastAPI 백엔드
마켓로그_2026-08-10/        React + Capacitor 프론트엔드 (Android 앱으로 빌드)
```

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 백엔드 | FastAPI, SQLAlchemy, Postgres(Neon, 운영) / SQLite(로컬 개발 폴백), JWT 인증 |
| AI 비전 | `mlv2` 파이프라인 — YOLO(검출) → 품목 분류(EfficientNetV2-S) → 2단계(특상/보통) 등급(CORAL 순서형 회귀) |
| AI 텍스트 | Gemini(`gemini-3.6-flash`) — 신선도/결함/균일도 세부점수 및 종합의견, 매장별 AI 도슨트 스크립트 생성 |
| 공공데이터 | KAMIS(농산물유통정보) 소매가격 API, 광주광역시 전통시장 점포 현황(463개 실점포) |
| 프론트엔드 | React 19 + TypeScript + Vite + Tailwind, Naver Maps SDK |
| 모바일 앱 | Capacitor 8 (Android) — 네이티브 TTS(`@capacitor-community/text-to-speech`), 카메라, 위치, 상태바 플러그인 |
| 배포 | 백엔드: Google Cloud Run (`asia-northeast3`, 요청 없으면 0으로 스케일) / DB: Neon Postgres Launch 플랜(5분 유휴 시 컴퓨트 자동 절전, 사용량만큼 과금) |
| 이미지 저장 | Google Cloud Storage(`marketlog-505311-product-images`, 공개 읽기) — `image_storage.py`가 상품 등록/수정 시 base64 사진을 업로드하고 DB엔 URL만 저장 |

## 백엔드 시작하기

```bash
cd marketlog-backend07.25
pip install -r requirements.txt
# GPU 없는 환경이면 CPU 전용 torch 휠을 쓰는 게 훨씬 빠르고 가볍다:
#   pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

# marketlog-backend07.25/.env 에 아래 값 설정 (아래 "환경변수" 절 참고)

python -m uvicorn main:app --reload --port 8000
```

- Swagger 문서: http://localhost:8000/docs
- `DATABASE_URL`을 설정하면 Postgres(Neon 등)를, 안 하면 로컬 SQLite 파일(`marketlog.db`)을 자동으로 쓴다.

### 백엔드 배포하기 (Cloud Run)

**`git push`만으로는 배포되지 않는다** — 이 저장소엔 GitHub→Cloud Run 자동배포 트리거가 연결돼 있지 않다. 코드를 실제 운영 서버에 반영하려면 로컬에서 아래 명령을 직접 실행해야 한다.

```bash
cd marketlog-backend07.25

# Windows에서 gcloud가 기본 python3.13과 안 맞아 깨지는 경우, Cloud SDK와 호환되는
# 버전(3.12 등)을 먼저 지정해준다. macOS/Linux나 이미 맞는 버전이면 생략 가능.
export CLOUDSDK_PYTHON="/path/to/python3.12"

gcloud run deploy marketlog-backend --source . --region asia-northeast3
```

- 프로젝트: `marketlog-505311` / 서비스: `marketlog-backend` / 리전: `asia-northeast3`
- Cloud Build가 `Dockerfile`로 이미지를 새로 빌드해서 Cloud Run에 새 리비전을 만들고, 자동으로 트래픽 100%를 그쪽으로 넘긴다. 배포는 보통 몇 분 걸린다.
- 스키마(모델 컬럼)를 바꿨다면 별도 마이그레이션 명령 없이 이 배포만으로 충분하다 — 아래 "스키마 변경사항 반영" 참고.
- 배포가 실제로 반영됐는지 확인하려면 `https://<서비스 URL>/api/health`가 아니라, 바뀐 필드가 실제 API 응답에 들어있는지(예: `/api/v1/auth/register` 응답에 새 필드가 있는지)로 확인하는 게 정확하다 — health 체크는 코드가 안 바뀌어도 항상 200을 반환한다.

## 프론트엔드 시작하기 (웹 미리보기)

```bash
cd 마켓로그_2026-08-10
npm install
npm run dev
```

`.env.local`(`VITE_API_BASE_URL`, 기본 `http://localhost:8000`)로 백엔드 주소를 잡는다. 브라우저에서 대부분의 기능을 확인할 수 있지만, **네이티브 TTS(AI 도슨트 음성)는 Android WebView 전용**이라 일반 브라우저에서는 소리가 안 나거나 브라우저 자체 음성 합성으로 대체된다.

## Android 앱 빌드하기

```bash
cd 마켓로그_2026-08-10
npm run build   # 또는 npx vite build
npx cap sync android

cd android
JAVA_HOME="<JDK 21 경로>" ANDROID_HOME="<Android SDK 경로>" ./gradlew bundleRelease assembleRelease
```

- `android/app/build.gradle`의 `versionCode`/`versionName`을 빌드마다 올려야 Play Console/기기에서 업데이트로 인식된다.
- 결과물: `android/app/build/outputs/bundle/release/app-release.aab`(Play 제출용), `android/app/build/outputs/apk/release/app-release.apk`(직접 설치용).
- 서명 키스토어(`android/keystore/`)는 `.gitignore`로 저장소에서 제외된다 — 새 환경에서 릴리즈 빌드하려면 별도로 준비해야 한다.

## 데이터베이스

### 모델 (`models.py`)

| 모델 | 설명 |
|---|---|
| `User` | 아이디(`username`) + bcrypt 해시 비밀번호, `role`(customer/merchant), `phone`, `shop_name`. `avatar_icon`/`avatar_color`/`profile_image`(마이 탭 프로필 사진, base64) |
| `Market` | 시장 (양동/망원/자갈치). `id`가 프론트의 `marketId` 슬러그와 동일. 실데이터가 있는 곳은 양동시장뿐 |
| `Store` | 시장 소속 점포. 광주광역시 공공데이터(463개 실점포) 기반 + 상인이 직접 지도에 핀을 찍어 등록한 점포. `phone`/`hours`/`story_text`가 채워져 있어야 그 점포 명의로 신규 상품 등록이 가능하다 |
| `Product` | 상품 피드. `store_id`(FK)로 `Store`와 연결 — 등록 시 상인의 `shop_name`과 같은 이름의 `Store`를 자동 매칭. `unit`(예: "1.5kg", 상품명과 분리), `origin`(예: "국내산 · 완도"), `tags`(쉼표로 이어붙인 해시태그) |
| `Bookmark` | 유저별 찜한 `Product` 참조 |
| `ScannedProduct` | 유저별 AI 스캔 저장목록 (상품 스냅샷 전체 저장 + `ai_summary`) |

### 스키마 변경사항 반영 (자동 마이그레이션)

별도 마이그레이션 도구(Alembic 등)는 안 쓴다. `main.py`가 시작할 때마다:

1. `Base.metadata.create_all()` — 아예 없는 테이블만 새로 만든다(기존 테이블은 안 건드림).
2. `main.py`의 `_pending_columns` 딕셔너리를 보고, 거기 적힌 컬럼이 실제 테이블에 없으면 `ALTER TABLE ... ADD COLUMN`을 직접 실행한다.

그래서 `models.py`에 컬럼을 추가했다면, `_pending_columns`에도 같은 컬럼을 등록해야 로컬 SQLite든 운영 Neon Postgres든 다음 시작(=다음 배포) 때 자동으로 반영된다. 배포 전에 DB에 수동으로 `ALTER TABLE`을 미리 돌려둘 필요는 없다 — 오히려 순서를 반대로 하면 안 된다(새 컬럼을 참조하는 코드가 먼저 배포되고 컬럼이 없으면 그 즉시 크래시).

## API 엔드포인트

### 인증 `/api/v1/auth`
| Method | Path | 설명 |
|---|---|---|
| POST | `/register` | 회원가입 (`username`, `password`, `role`, `displayName`, `phone`, `shopName?`) → JWT |
| POST | `/login` | 로그인 → JWT |
| GET | `/me` | 현재 유저 정보 (Bearer 토큰 필요) |
| PUT | `/me` | 프로필 수정 (표시이름/전화번호/비밀번호) |
| POST | `/find-username`, `/reset-password` | 이름+전화번호 일치 기반 아이디 찾기/비밀번호 재설정 (데모용, 실제 본인확인 없음) |

### 저장/찜 `/api/v1/saved` (전부 Bearer 필요)
| Method | Path | 설명 |
|---|---|---|
| GET/POST/DELETE | `/bookmarks[/{product_id}]` | 찜 목록 조회/추가/삭제 |
| GET/POST/DELETE | `/scanned[/{item_id}]` | AI 스캔 저장목록 조회/추가/삭제 |

### 상품 피드/AI 스캔/도슨트
| Method | Path | 설명 |
|---|---|---|
| GET | `/api/v1/consumer/feed` | 전체 상품 피드 (최신순) |
| POST | `/api/analyze-product` | AI 스캔. `mlv2` 파이프라인이 검출→품목분류→등급(특상/보통)을 직접 추론하고, Gemini가 사진+등급을 보고 세부점수·종합의견을 생성. 검출 실패 시 `{"success": false, "reason", "hint"}`로 정직하게 응답(가짜 성공 없음) |
| POST | `/api/docent-story` | 매장 단위 AI 도슨트 스크립트. `storeId`를 주면 그 점포 하나에 집중한 해설을 Gemini가 생성(전화번호/소개글 등 실데이터 참고), 같은 점포는 30분 캐싱. Gemini 실패 시 템플릿 문장으로 폴백 |

공공 시세(`publicMarketPrice`)는 `kamis.py`로 KAMIS 소매가격 API를 조회한다(등급 근사 매핑, kg 환산 통일). 데이터 없는 품목이나 API 실패 시 정적 추정치로 폴백하고 이 경우 응답 문구도 정직하게 "참고 시세(자체 추정치)"로 바뀐다.

### 지도 `/api/v1/map`
| Method | Path | 설명 |
|---|---|---|
| GET | `/config` | 네이버 지도 client id |
| GET | `/stores?market_name=...` | 해당 시장의 점포 핀 + 중심좌표 + 점포별 연결 상품 목록 |
| GET | `/store?name=...` | 특정 점포 상세(부제/전화/영업시간/소개) — 없으면 `store: null`로 정직하게 응답 |

### 상인 `/api/v1/merchant` (전부 Bearer 필요, `role=merchant` 계정만)
| Method | Path | 설명 |
|---|---|---|
| POST/PUT/DELETE | `/products[/{id}]` | 상품 등록/수정/삭제. **신규 등록은 점포 위치+전화번호+영업시간이 모두 등록돼 있어야 허용**(없으면 400) |
| GET/PUT | `/store-location` | 점포 지도 좌표 조회/등록(위경도 직접 지정 또는 주소 검색) |
| GET/PUT | `/store-profile` | 점포 상세정보(부제/전화/영업시간/소개글) 조회/저장 — 위치 등록 전엔 404 |

등록되는 상품의 `shopName`은 요청 본문이 아니라 로그인 계정의 실제 `shop_name`에서 자동으로 채워진다.

## AI 비전 파이프라인 (`mlv2`)

1. **검출**: YOLO(`yolo11s_synth_v1.pt`)로 사진 속 대상 농산물을 찾아 크롭
2. **품목 분류**: 10개 클래스(감·감귤·감자·마늘·무·배·배추·사과·양배추·양파) 중 하나로 분류(`item_crop_v1.pt`). **마늘은 정확도가 낮아(약 4/12) 무로 오분류하는 경우가 있음이 확인됨** — 표시할 때 유의
3. **등급**: 특상/보통 2단계(`quality_grading_effv2s_v2.pt`, CORAL 순서형 회귀). 항상 `grade_reliable: false`와 확신도(`grade_p_high`)를 함께 반환하므로, **프론트는 등급 라벨만 단독으로 보여주지 말고 항상 확신도 %를 같이 표시**해야 한다("특상 53%"와 "특상 99%"는 신뢰도가 다르다)

체크포인트(`checkpoints/*.pt`, 약 180MB)는 git에 커밋되어 있어 클론만 하면 바로 동작한다.

## 알려진 이슈 / TODO

- **양동시장 외 지역 데이터 없음** — 망원/자갈치시장은 `Market` row만 있고 실제 점포 데이터가 없음
- **상인 계정 승인 절차 없음** — 회원가입 시 "판매자" 선택만으로 즉시 판매자 권한 부여. 사업자 확인/운영진 심사는 의도적으로 고도화 단계로 미룸
- **Gemini 무료 티어 한도** — 하루 요청 수 제한이 있어 실사용엔 부족할 수 있음. 한도 초과 시엔 항상 실제 DB 데이터 기반 템플릿 문장으로 조용히 폴백
- **Cloud Run/Neon 콜드 스타트** — 둘 다 유휴 시 스케일 0(Cloud Run)/컴퓨트 절전(Neon)이라 첫 요청이 느림. Neon은 Launch 플랜(유료, 사용량 과금)으로 전환해서 데이터 전송량 한도 자체는 사라졌지만, 절전 후 첫 요청 지연은 그대로 남아있음
- **기존에 base64로 저장된 이미지 미이전** — GCS 업로드(`image_storage.py`)는 신규 등록/수정 건부터 적용되고, 그 이전에 이미 Postgres에 base64로 박혀있던 상품/스캔 사진들은 아직 GCS로 옮기지 않음 — 그 행들을 조회할 때마다 여전히 큰 데이터가 DB에서 빠져나간다
- **아이디/비밀번호 찾기** — 실제 문자/이메일 인증 없이 이름+전화번호 일치만으로 처리하는 데모 수준 구현
- **지갑 탭의 쿠폰/퀘스트** — 백엔드 자체가 없는 프론트 전용 mock 상태로 남아있음
- CORS가 `allow_origins=["*"]` — 실사용 확장 시 프론트 도메인으로 좁혀야 함
- JWT를 프론트 `localStorage`에 저장 — XSS 발생 시 탈취 가능 (httpOnly 쿠키보다 약함)

## 환경변수

`marketlog-backend07.25/.env`:
- `DATABASE_URL` — Postgres 연결 문자열(Neon 등). 없으면 로컬 SQLite로 폴백
- `GEMINI_API_KEY` — AI 스캔 세부점수/종합의견, AI 도슨트 생성용
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- `KAMIS_CERT_KEY`, `KAMIS_CERT_ID` — 농산물유통정보(KAMIS) Open API 인증키+아이디 (둘 다 필요)
- `JWT_SECRET` — 배포 전 반드시 임의의 강력한 값으로 교체
- `GCS_BUCKET_NAME` — 상품/스캔 사진 업로드용 GCS 버킷 이름. 없으면 `marketlog-505311-product-images`로 기본 설정. Cloud Run 배포 환경에선 기본 서비스 계정 자격증명(Application Default Credentials)을 그대로 쓰므로 별도 키 파일이 필요 없음

`마켓로그_2026-08-10/.env.local`:
- `VITE_API_BASE_URL` — FastAPI 백엔드 주소 (기본 `http://localhost:8000`)

## 히스토리

전체 변경 이력은 `git log`를 참고. (이 문서는 매 커밋마다 갱신하지 않으므로, 특정 시점의 상세 변경 내역보다 "지금 구조가 어떤가"를 반영하는 데 집중한다.)
