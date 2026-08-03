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
        db.query(Store).filter(Store.market_id == MARKET_ID).delete()
        db.add_all(Store(**s) for s in stores)
        db.commit()
        print(f"Imported {len(stores)} stores into market '{MARKET_ID}'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
