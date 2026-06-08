from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    redis_url: str = "redis://redis_server:6379"
    cors_origins: str = "*"

    class Config:
        env_file = ".env"

settings = Settings()