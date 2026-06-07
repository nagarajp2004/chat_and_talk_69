from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import from_url
 
from backend.app.core.config import settings
from backend.app.services.room_manager import room_manager
from backend.app.api.routes import chats, signal, room
 
 
@asynccontextmanager
async def lifespan(app: FastAPI):
    redis = from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    room_manager.set_redis(redis)
    yield
    await redis.aclose()
 
 
app = FastAPI(title="VoiceChat", lifespan=lifespan)


 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
 
app.include_router(room.router)
app.include_router(chats.router)
app.include_router(signal.router)