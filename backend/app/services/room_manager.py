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
                        
