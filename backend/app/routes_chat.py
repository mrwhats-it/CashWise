from fastapi import APIRouter, HTTPException, Request
from .auth import CurrentUser
from .db import user_client
from .gemini import chat
from .models import ChatRequest, InferenceConfirm

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("")
def chat_endpoint(req: ChatRequest, request: Request, user=CurrentUser):
    provider = (request.headers.get("x-llm-provider") or "ollama").lower()
    user_key = request.headers.get("x-llm-key") or None
    user_model = request.headers.get("x-llm-model") or None
    try:
        return chat(
            [m.model_dump() for m in req.messages],
            user,
            provider=provider,
            api_key=user_key,
            model_name=user_model,
        )
    except Exception as e:
        raise HTTPException(500, f"{provider} error: {e}")


@router.post("/confirm-inference")
def confirm_inference(body: InferenceConfirm, user=CurrentUser):
    """Called when the user accepts (or edits) an AI-suggested entry."""
    if not body.accepted:
        return {"ok": True, "skipped": True}
    db = user_client(user["token"])
    payload = body.model_dump(mode="json", exclude={"accepted"}) | {"user_id": user["id"]}
    res = db.table("entries").insert(payload).execute()
    if not res.data:
        raise HTTPException(400, "Insert failed")
    return {"ok": True, "entry": res.data[0]}
