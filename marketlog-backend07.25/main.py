import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from api.map import router as map_router
import os
from sqlalchemy import inspect, text
from api import merchant, consumer, recommend, auth, saved
from db import Base, engine, SessionLocal
import kamis
import models  # noqa: F401  (모델을 등록해야 create_all에서 테이블이 생성됨)
from seed import seed_if_empty

load_dotenv()

Base.metadata.create_all(bind=engine)

# create_all은 없는 테이블만 만들고, 이미 있는 테이블에 나중에 추가된 컬럼은 채워주지 않는다.
# products.unit(상품명/단위 분리)이나 users.avatar_*(프로필 사진/아이콘 저장)처럼 기존 DB
# 파일에 없을 수 있는 컬럼은 여기서 직접 추가한다.
_inspector = inspect(engine)
_pending_columns = {
    "products": [
        ("unit", "VARCHAR NOT NULL DEFAULT ''"),
        ("origin", "VARCHAR NOT NULL DEFAULT ''"),
        ("tags", "VARCHAR NOT NULL DEFAULT ''"),
    ],
    "users": [
        ("avatar_icon", "VARCHAR"),
        ("avatar_color", "VARCHAR"),
        ("profile_image", "TEXT"),
    ],
    "scanned_products": [("ai_summary", "VARCHAR")],
}
for _table, _columns in _pending_columns.items():
    if _table not in _inspector.get_table_names():
        continue
    _existing_columns = {col["name"] for col in _inspector.get_columns(_table)}
    for _column_name, _column_def in _columns:
        if _column_name not in _existing_columns:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN {_column_name} {_column_def}"))

_seed_db = SessionLocal()
try:
    seed_if_empty(_seed_db)
finally:
    _seed_db.close()

app = FastAPI(title="MarketLog API Server", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 📍 라우터 등록 영역 (map_router 추가!)
app.include_router(merchant.router)
app.include_router(consumer.router)
app.include_router(recommend.router)
app.include_router(map_router)  # 👈 이 줄이 추가되었습니다!
app.include_router(auth.router)
app.include_router(saved.router)

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

os.makedirs("static/assets", exist_ok=True)
app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def serve_frontend():
    index_path = "static/index.html"
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "MarketLog 백엔드 서버 작동 중!"}

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "MarketLog Backend"}

@app.on_event("startup")
async def start_kamis_auto_refresh():
    asyncio.create_task(kamis.auto_refresh_loop())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)