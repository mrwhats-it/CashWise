from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    supabase_jwt_secret: str = ""

    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "gemma4:e2b"

    groq_api_key: str = ""
    groq_model: str = "qwen/qwen3-32b"
    groq_base_url: str = "https://api.groq.com/openai/v1"

    cors_origins: str = "http://localhost:3000"


settings = Settings()
