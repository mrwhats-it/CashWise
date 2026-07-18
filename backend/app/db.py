from supabase import create_client, Client
from .config import settings


def service_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


def user_client(access_token: str) -> Client:
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(access_token)
    return client
