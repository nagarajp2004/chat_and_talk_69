import json 
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.room_manager import room_manager

router=APIRouter()


@router.websocket("/ws/signal/{room_id}/{user_id}")
async def signal_endpoint(websocket:WebSocket,room_id:str,user_id:str):
    await websocket.accept()
    await room_manager.join_signal(room_id,user_id,websocket)

    try:
        while True:
            raw=await websocket.receive_text()
            data=json.loads(raw)
            msg_type=data.get('type')

            if msg_type == 'ready':

                peers=room_manager.get_Signal_peers(room_id,exclude=user_id)

                await websocket.send_text(json.dumps({"type":"peers","peers":peers}))

                await room_manager.relay_signal(room_id,user_id,{'type':'new_peer',"user_id":user_id})

            elif msg_type in ("offer","answer","ice"):
                await room_manager.relay_signal(room_id,user_id,data)

            elif msg_type == 'leave':
                break
    except WebSocketDisconnect:
        pass
    finally:
        await room_manager.leave_signal(room_id,user_id)
        await room_manager.relay_signal(room_id,user_id,{'type':'peer_left','user_id':user_id})    

        
                             
         
       
