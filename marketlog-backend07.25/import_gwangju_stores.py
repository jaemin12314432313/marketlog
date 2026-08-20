"""Refreshes the yangdong market's stores from the Gwangju public-data CSV.

seed.py only seeds on an empty table, so an already-populated DB (e.g. the
committed marketlog.db with the old 3 placeholder stores) needs this to pick
up the real data. Run once from marketlog-backend07.25/:

    python import_gwangju_stores.py
"""
from db import Base, engine, SessionLocal
from models import Store
from gwangju_market_data import load_yangdong_stores, MARKET_ID


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        stores = load_yangdong_stores()
        # category='merchant'는 상인이 "점포 위치 등록"으로 직접 찍은 핀이라 공공데이터가
        # 아니다 — 여기서 지우면 그 점포에 연결된 실제 등록 상품(Product.store_id)까지
        # 참조 무결성 위반으로 깨진다(실제로 겪음: 과일가게/인혁단 배추 등 15개 상품).
        # 공공데이터로 넣은 점포만 지우고 새로 채운다.
        db.query(Store).filter(Store.market_id == MARKET_ID, Store.category != "merchant").delete()
        db.add_all(Store(**s) for s in stores)
        db.commit()
        print(f"Imported {len(stores)} stores into market '{MARKET_ID}'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
