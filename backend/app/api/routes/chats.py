import json 
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.app.services.room_manager import room_manager
from fastapi import WebSocket

router=APIRouter()

@router.websocket("/ws/{room_id}/{user_id}")
async def chat_endpoint(websocket:WebSocket,room_id:str,user_id:str):
    await websocket.accept()
    await room_manager.join_chat(room_id,user_id,websocket)

    members=list(room_manager.get_Signal_peers(room_id,user_id))
    await websocket.send_text(json.dumps({'type':'room_state','members':members}))

    try:
        while True:
            raw =await websocket.receive_text()
            data=json.loads(raw)
            if data.get('type')=='text_message':
                await room_manager.brodcast_text(room_id,user_id,data.get('text',''))

    except WebSocketDisconnect:
        await room_manager.leave_chat(room_id,user_id)          
