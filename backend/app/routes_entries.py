import uuid
from fastapi import APIRouter, HTTPException
from .auth import CurrentUser
from .db import user_client
from .models import EntryIn, EntryOut, EntryUpdate
from .recurrence import expand_dates

router = APIRouter(prefix="/api/entries", tags=["entries"])


@router.get("", response_model=list[EntryOut])
def list_entries(user=CurrentUser):
    db = user_client(user["token"])
    res = (
        db.table("entries")
        .select("*")
        .eq("user_id", user["id"])
        .order("entry_date", desc=False)
        .execute()
    )
    return res.data or []


@router.post("", response_model=list[EntryOut])
def create_entry(entry: EntryIn, user=CurrentUser):
    """Insert one row per recurrence occurrence. Returns all inserted rows."""
    db = user_client(user["token"])
    dates = expand_dates(entry.entry_date, entry.repeat, entry.end_date)
    series_id = str(uuid.uuid4()) if entry.repeat != "never" else None
    rows = [
        {
            "user_id": user["id"],
            "kind": entry.kind,
            "title": entry.title,
            "category": entry.category,
            "amount": entry.amount,
            "entry_date": d.isoformat(),
            "memo": entry.memo,
            "series_id": series_id,
        }
        for d in dates
    ]
    res = db.table("entries").insert(rows).execute()
    if not res.data:
        raise HTTPException(400, "Insert failed")
    return res.data


@router.patch("/{entry_id}", response_model=list[EntryOut])
def update_entry(entry_id: str, patch: EntryUpdate, user=CurrentUser):
    """Update a single entry, or the whole series if it has a series_id.

    entry_date is never propagated to the whole series (each occurrence keeps
    its own date). All other fields overwrite every row in the series.
    """
    db = user_client(user["token"])
    current = (
        db.table("entries").select("*")
        .eq("id", entry_id).eq("user_id", user["id"]).execute().data
    )
    if not current:
        raise HTTPException(404, "Entry not found")
    row = current[0]

    body = patch.model_dump(mode="json", exclude_unset=True)
    if not body:
        return [row]

    # Always update the single row completely.
    (
        db.table("entries").update(body)
        .eq("id", entry_id).eq("user_id", user["id"]).execute()
    )

    # Propagate non-date fields to the rest of the series, if any.
    if row.get("series_id"):
        propagate = {k: v for k, v in body.items() if k != "entry_date"}
        if propagate:
            (
                db.table("entries").update(propagate)
                .eq("series_id", row["series_id"])
                .eq("user_id", user["id"]).execute()
            )

    updated = (
        db.table("entries").select("*")
        .eq("series_id", row["series_id"] or "__none__")
        .eq("user_id", user["id"]).execute().data
        if row.get("series_id")
        else db.table("entries").select("*")
             .eq("id", entry_id).eq("user_id", user["id"]).execute().data
    )
    return updated or []


@router.delete("/{entry_id}")
def delete_entry(entry_id: str, user=CurrentUser):
    """Delete a single entry, or the whole series if it has a series_id."""
    db = user_client(user["token"])
    row = (
        db.table("entries").select("series_id")
        .eq("id", entry_id).eq("user_id", user["id"]).execute().data
    )
    series_id = row[0]["series_id"] if row else None
    if series_id:
        (
            db.table("entries").delete()
            .eq("series_id", series_id).eq("user_id", user["id"]).execute()
        )
    else:
        (
            db.table("entries").delete()
            .eq("id", entry_id).eq("user_id", user["id"]).execute()
        )
    return {"ok": True}
