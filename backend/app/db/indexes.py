from __future__ import annotations

from pymongo import ASCENDING, DESCENDING

from .mongodb import get_database


async def ensure_indexes() -> None:
    """Create indexes required by core collections."""
    db = get_database()

    await db["users"].create_index(
        [("email", ASCENDING)], unique=True, name="users_email_unique"
    )

    await db["classes"].create_index(
        [("class_code", ASCENDING)], unique=True, name="classes_class_code_unique"
    )

    await db["documents"].create_index(
        [("id", ASCENDING)], unique=True, name="documents_id_unique"
    )

    await db["reports"].create_index(
        [("report_id", ASCENDING)], unique=True, name="reports_report_id_unique"
    )
    await db["reports"].create_index(
        [("created_at", ASCENDING)], name="reports_created_at_idx"
    )
    await db["reports"].create_index(
        [("assignment_id", ASCENDING), ("generated_at", DESCENDING)],
        name="reports_assignment_generated_idx",
    )
