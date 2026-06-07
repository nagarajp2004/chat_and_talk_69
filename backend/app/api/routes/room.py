from fastapi import APIRouter
from backend.app.services.room_manager import room_manager

router = APIRouter(prefix="/api")


@router.get("/rooms/{room_id}/members")
async def get_members(room_id: str):
    members = list(room_manager.get_Signal_peers(room_id))
    return {"room_id": room_id, "members": members, "count": len(members)}


@router.get("/health")
async def health():
    return {"status": "ok"}