import json 
import asyncio
from typing import Dict, Set
from redis.asyncio import Redis


class RoomManager:
    def __init__(self):
        self._chat_connections: Dict[str, Dict[str,object]] = {}
        self._signal_connections: Dict[str, Dict[str,object]] = {}
        self._redis :Redis | None = None
        self._pubsub_task: Dict[str, asyncio.Task] = {}

    def set_redis(self, redis: Redis):
        self._redis = redis 


    async def join_chat(self,room_id:str, user_id:str,ws)->None:
        self._chat_connections.setdefault(room_id, {})[user_id] = ws
        await self._ensure_subscriber(room_id)
        await self._publish(room_id,{'type':'user_joined','user_id':user_id})


    async def leave_chat(self,room_id:str,user_id:str)->None:
        room =self._chat_connections.get(room_id)
        room.pop(user_id,None) 
        if not room:
            self._chat_connections.pop(room_id,None)
        awit self._publish(room_id,{'type':'user_left','user_id':user_id})


    async def brodcast_text(self,room_id:str,user_id:str,text:str)->None:
        await self._publish(room_id,{'type':'message','user_id':user_id,'text':text})



    async def join_signal(self, room_id: str, user_id: str, ws) -> None:
        self._signal_connections.setdefault(room_id, {})[user_id] = ws
 
    async def leave_signal(self, room_id: str, user_id: str) -> None:
        self._signal_connections.get(room_id, {}).pop(user_id, None)


    async def relay_signal(self,room_id:str,sender_id:str,payload:dict)->None:
        target_id=payload.get('target_id')
        msg=json.dumps({**payload,'from':sender_id})
        room=self._signal_connections.get(room_id, {})
        
        if target_id:
            ws=room.get(target_id)
            if ws:
                try:                
                    await ws.send_text(msg)
                eccept Exception as e:
                    pass    
        else:
            for uid,ws in room.items():
                if uid != sender_id:
                    try:
                        await ws.send_text(msg)
                    except Exception as e:
                        pass
    
                        
