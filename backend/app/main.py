from fastapi import FastAPI
from contextlib import asynccontextmanager
import redis.asyncio as aioredis
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    app.state.redis = aioredis.from_url(REDIS_URL)
    print("✅ Redis connected")
    yield
    # shutdown
    await app.state.redis.close()
    print("🛑 Redis disconnected")

app = FastAPI(lifespan=lifespan)

@app.get("/")
async def root():
    return {"message": "Chat server running"}

@app.get("/health")
async def health():
    return {"status": "ok"}