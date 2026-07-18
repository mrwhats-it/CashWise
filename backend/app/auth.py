from fastapi import Depends, HTTPException, Request, status
from supabase import create_client

from .config import settings


def get_current_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = auth.split(" ", 1)[1]

    # Ask Supabase to validate the token. Works for both legacy HS256 and the
    # newer asymmetric (ES256/RS256) signing keys — no local alg config needed.
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    try:
        res = client.auth.get_user(token)
    except Exception as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}")

    user = getattr(res, "user", None)
    if not user or not getattr(user, "id", None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token: no user")

    return {"id": user.id, "email": user.email, "token": token}


CurrentUser = Depends(get_current_user)
