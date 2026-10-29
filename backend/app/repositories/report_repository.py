from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import uuid4

from bson import ObjectId

from ..db.mongodb import get_database


class ReportRepository:
    """MongoDB report repository."""

    def __init__(self) -> None:
        self.collection_name = "reports"

    @staticmethod
    def _serialize_report(doc: dict) -> dict:
        """Convert MongoDB report document into JSON-safe payload."""
        serialized = dict(doc)
        serialized["id"] = str(serialized.get("_id"))
        serialized.pop("_id", None)
        return serialized

    async def create_report(
        self,
        assignment_id: str,
        results: dict,
        average_similarity: float = 0.0,
        max_similarity: float = 0.0,
        input_fingerprint: str | None = None,
        submission_count: int | None = None,
        document_count: int | None = None,
    ) -> dict:
        """Create a new report."""
        db = get_database()
        collection = db[self.collection_name]

        report_data = {
            "report_id": str(uuid4()),
            "assignment_id": assignment_id,
            "results": results,
            "average_similarity": average_similarity,
            "max_similarity": max_similarity,
            "generated_at": datetime.utcnow(),
            "is_published": False,
            "input_fingerprint": input_fingerprint,
            "submission_count": submission_count,
            "document_count": document_count,
        }

        result = await collection.insert_one(report_data)
        report_data["id"] = str(result.inserted_id)
        return report_data

    async def get_report_by_id(self, report_id: str) -> Optional[dict]:
        """Get report by Mongo id or logical report_id."""
        try:
            db = get_database()
            collection = db[self.collection_name]

            # First try Mongo ObjectId lookup used by legacy route callers.
            report = None
            try:
                report = await collection.find_one({"_id": ObjectId(report_id)})
            except Exception:
                report = None

            # Fallback to logical report_id (UUID-style) for newer callers.
            if not report:
                report = await collection.find_one({"report_id": report_id})

            if report:
                return self._serialize_report(report)
            return report
        except Exception:
            return None

    async def list_assignment_reports(self, assignment_id: str) -> list[dict]:
        """List all reports for an assignment."""
        db = get_database()
        collection = db[self.collection_name]

        reports = []
        async for doc in collection.find({"assignment_id": assignment_id}).sort(
            "generated_at", -1
        ):
            reports.append(self._serialize_report(doc))
        return reports

    async def list_all_reports(self) -> list[dict]:
        """List all reports across assignments (latest first)."""
        db = get_database()
        collection = db[self.collection_name]

        reports = []
        async for doc in collection.find({}).sort("generated_at", -1):
            reports.append(self._serialize_report(doc))
        return reports

    async def get_latest_report(self, assignment_id: str) -> Optional[dict]:
        """Get the latest report for an assignment."""
        db = get_database()
        collection = db[self.collection_name]
        report = await collection.find_one(
            {"assignment_id": assignment_id}, sort=[("generated_at", -1)]
        )
        if report:
            return self._serialize_report(report)
        return report

    async def get_latest_report_meta(self, assignment_id: str) -> Optional[dict]:
        """Get metadata of the latest report for an assignment (excluding results)."""
        db = get_database()
        collection = db[self.collection_name]
        doc = await collection.find_one(
            {"assignment_id": assignment_id},
            projection={"results": 0},
            sort=[("generated_at", -1)],
        )
        return self._serialize_report(doc) if doc else None

    async def list_report_summaries(self, assignment_id: str) -> list[dict]:
        """List report summaries for an assignment without results (latest first)."""
        db = get_database()
        collection = db[self.collection_name]

        reports = []
        async for doc in collection.find(
            {"assignment_id": assignment_id}, {"results": 0}
        ).sort("generated_at", -1):
            reports.append(self._serialize_report(doc))
        return reports

    async def publish_latest_report(self, assignment_id: str) -> Optional[dict]:
        """Publish latest report for an assignment and return updated document."""
        db = get_database()
        collection = db[self.collection_name]

        latest = await collection.find_one(
            {"assignment_id": assignment_id}, sort=[("generated_at", -1)]
        )
        if not latest:
            return None

        await collection.update_one(
            {"_id": latest["_id"]},
            {
                "$set": {
                    "is_published": True,
                    "published_at": datetime.utcnow(),
                }
            },
        )

        updated = await collection.find_one({"_id": latest["_id"]})
        if updated:
            return self._serialize_report(updated)
        return None
