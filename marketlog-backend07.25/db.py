import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Cloud Run 컨테이너 로컬 디스크(SQLite 파일)는 인스턴스가 재시작될 때마다 초기화되고,
# 인스턴스가 2개 이상 동시에 뜨면 서로 다른 로컬 파일을 갖게 되어 데이터가 어긋난다.
# DATABASE_URL이 설정되어 있으면(Neon/Supabase 등 관리형 Postgres) 그쪽을 쓰고,
# 없으면 로컬 개발용으로 기존처럼 프로젝트 폴더의 SQLite 파일을 쓴다.
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # 일부 관리형 Postgres 제공자는 "postgres://" 스킴을 내려주는데, SQLAlchemy 2.x는
    # "postgresql://"만 인식한다.
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    SQLALCHEMY_DATABASE_URL = DATABASE_URL
    engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
else:
    DB_PATH = os.getenv("DB_PATH", "./marketlog.db")
    SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
