"""Loads the malbawi market's stores from the Gwangju public-data CSV.

Run once from marketlog-backend07.25/ (set DATABASE_URL first to target the
live Postgres DB instead of local sqlite):

    python import_malbawi_stores.py
"""
from db import Base, engine, SessionLocal
from models import Store
from gwangju_market_data import load_malbawi_stores, MALBAWI_MARKET_ID


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        stores = load_malbawi_stores()
        # category='merchant'는 상인이 직접 찍은 핀이라 공공데이터가 아니다 — 지우면 그
        # 점포에 연결된 실제 등록 상품까지 참조 무결성 위반으로 깨질 수 있다(양동시장
        # 재수입 때 실제로 겪음). 공공데이터로 넣은 점포만 지우고 새로 채운다.
        db.query(Store).filter(Store.market_id == MALBAWI_MARKET_ID, Store.category != "merchant").delete()
        db.add_all(Store(**s) for s in stores)
        db.commit()
        print(f"Imported {len(stores)} stores into market '{MALBAWI_MARKET_ID}'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
