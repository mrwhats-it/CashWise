from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

from .models import Repeat


DEFAULT_HORIZON_MONTHS = 12  # if no end_date, cap recurring series at 12 months


def expand_dates(start: date, repeat: Repeat, end: date | None) -> list[date]:
    """Return every occurrence date from `start` up to and including `end`.

    If `repeat == "never"` returns [start].
    If `end` is None and repeat is set, cap to DEFAULT_HORIZON_MONTHS from start.
    """
    if repeat == "never":
        return [start]

    horizon = end or (start + relativedelta(months=DEFAULT_HORIZON_MONTHS))
    if horizon < start:
        return [start]

    step = {
        "daily": timedelta(days=1),
        "weekly": timedelta(weeks=1),
        "biweekly": timedelta(weeks=2),
        "monthly": relativedelta(months=1),
        "quarterly": relativedelta(months=3),
        "yearly": relativedelta(years=1),
    }[repeat]

    out: list[date] = []
    cur = start
    while cur <= horizon and len(out) < 400:  # hard safety cap
        out.append(cur)
        cur = cur + step
    return out
