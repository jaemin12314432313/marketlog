from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from api.map import router as map_router
import os
from api import merchant, consumer, recommend, auth, saved
from db import Base, engine, SessionLocal
import models  # noqa: F401  (모델을 등록해야 create_all에서 테이블이 생성됨)
from seed import seed_if_empty

load_dotenv()

Base.metadata.create_all(bind=engine)

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)