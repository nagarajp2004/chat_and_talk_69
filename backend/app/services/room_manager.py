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
        room =self._chat_connections.get(room_id, {})
        room.pop(user_id,None) 
        if not room:
            self._chat_connections.pop(room_id,None)
        await self._publish(room_id,{'type':'user_left','user_id':user_id})


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
                except Exception as e:
                    pass    
        else:
            for uid,ws in room.items():
                if uid != sender_id:
                    try:
                        await ws.send_text(msg)
                    except Exception as e:
                        pass

    def get_Signal_peers(self,room_id:str,exclude:str)->list[str]:
        room=self._signal_connections.get(room_id,{})
        return [uid for  uid in room if uid != exclude]

    
    async def _publish(self,room_id:str,payload:dict)->None:
        if self._redis:
            await self._redis.publish(f"room:{room_id}",json.dumps(payload))


    async def _ensure_subscriber(self,room_id:str)->None:
        if room_id not in self._pubsub_task :
            task=asyncio.create_task(self._subscribe_loop(room_id))
            self._pubsub_task[room_id]=task


    async def _subscribe_loop(self,room_id:str)->None:
        pubsub=self._redis.pubsub()
        await pubsub.subscribe(f"room:{room_id}")
        try:
            async for messsage in pubsub.listen():
                if message['type']!='meassage':
                    continue
                data=json.loads(message['data'])
                await self._fan_out(room_id,data)
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe(f"room:{room_id}")
            await pubsub.close()                

    async def _fan_out(self,room_id:str,data:dict)->None:
        msg=json.dumps(data)
        for ws in self._chat_connections.get(room_id,{}).values():
            try:
                await ws.send_text(msg)
            except Exception as e:
                pass

room_manager=RoomManager()




