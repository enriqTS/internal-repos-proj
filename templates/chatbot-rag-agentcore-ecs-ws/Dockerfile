# Multi-stage build for Python 3.12 slim
FROM python:3.12-slim AS builder

WORKDIR /build
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv && uv export --format requirements-txt > requirements.txt
RUN pip install --no-cache-dir --target /build/deps -r requirements.txt

FROM python:3.12-slim AS runtime

WORKDIR /app
COPY --from=builder /build/deps /usr/local/lib/python3.12/site-packages/
COPY src/app/ ./app/

ENV PORT=8080
ENV PYTHONUNBUFFERED=1

EXPOSE 8080

# Graceful shutdown via SIGTERM
STOPSIGNAL SIGTERM

CMD ["python", "-m", "app.main"]
