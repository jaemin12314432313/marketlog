"""상품/스캔 사진을 base64로 DB(Neon)에 통째로 저장하던 걸 Google Cloud Storage로 옮긴다.

원래는 image_url 컬럼에 "data:image/jpeg;base64,..." 문자열을 그대로 저장했는데, 그러면
상품 목록을 불러올 때마다 등록된 사진 전체가 DB에서 그대로 빠져나가서(Neon "network
transfer") 무료 티어 할당량을 순식간에 다 써버린다(실제로 겪음: 일주일 만에 5GB 초과).
이제 사진은 GCS에 올리고 DB엔 짧은 URL만 저장한다 — DB는 가벼운 텍스트만 주고받는다.
"""
import base64
import os
import re
import uuid
from datetime import datetime, timezone

GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "marketlog-505311-product-images")

_client = None
_client_checked = False

_DATA_URI_RE = re.compile(r"^data:image/(?P<ext>[a-zA-Z0-9.+-]+);base64,(?P<data>.+)$", re.DOTALL)


def _get_client():
    """GCS 클라이언트를 지연 초기화한다. Cloud Run에서는 기본 서비스 계정 자격증명을
    자동으로 쓰고(Application Default Credentials), 로컬에서는 `gcloud auth
    application-default login`으로 만든 자격증명을 그대로 쓴다."""
    global _client, _client_checked
    if _client_checked:
        return _client
    _client_checked = True
    try:
        from google.cloud import storage

        _client = storage.Client()
    except Exception as e:
        print(f"GCS 클라이언트 초기화 실패 (base64 그대로 저장으로 폴백): {e}")
        _client = None
    return _client


def upload_base64_image(data_uri: str, prefix: str) -> str:
    """"data:image/...;base64,..." 문자열을 GCS에 올리고 공개 URL을 돌려준다.

    data_uri가 이미 data: 형식이 아니면(이미 URL이거나 빈 문자열) 그대로 돌려준다 —
    호출부가 "이게 새로 올린 base64인지 아닌지" 신경 안 쓰고 그냥 넘겨도 되게 하기 위함.
    업로드에 실패하면(자격증명 문제 등) 원본 base64를 그대로 돌려줘서 최소한 상품 등록
    자체는 깨지지 않게 한다 — 다만 이 경우 Neon 전송량 문제는 그대로 남는다.
    """
    if not data_uri or not data_uri.startswith("data:"):
        return data_uri

    match = _DATA_URI_RE.match(data_uri)
    if not match:
        return data_uri

    client = _get_client()
    if client is None:
        return data_uri

    try:
        ext = match.group("ext").split("+")[0]  # "svg+xml" 같은 경우 대비
        if ext not in ("jpeg", "jpg", "png", "webp", "gif"):
            ext = "jpg"
        raw = base64.b64decode(match.group("data"))

        date_prefix = datetime.now(timezone.utc).strftime("%Y%m%d")
        blob_name = f"{prefix}/{date_prefix}/{uuid.uuid4().hex}.{ext}"

        bucket = client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(blob_name)
        blob.upload_from_string(raw, content_type=f"image/{ext}")

        return f"https://storage.googleapis.com/{GCS_BUCKET_NAME}/{blob_name}"
    except Exception as e:
        print(f"GCS 이미지 업로드 실패 (base64 그대로 저장으로 폴백): {e}")
        return data_uri
