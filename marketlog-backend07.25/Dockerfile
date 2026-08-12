FROM python:3.12-slim

WORKDIR /app

# torch/torchvision/timm이 opencv 등에서 쓰는 최소 시스템 라이브러리
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

COPY . .

# 루트가 아닌 사용자로 실행 + uploads/static을 쓰기 가능하게
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Cloud Run은 컨테이너에 PORT 환경변수를 넣어주고 그 포트로 리슨할 것을 기대한다
# (고정 포트가 아님). 로컬 테스트용으로 기본값 8080을 넣어둔다.
ENV PORT=8080
EXPOSE 8080

CMD uvicorn main:app --host 0.0.0.0 --port $PORT
