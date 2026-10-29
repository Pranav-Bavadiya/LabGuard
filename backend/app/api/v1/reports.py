from __future__ import annotations

import base64
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ...services.assignment_service import AssignmentService
from ...services.auth_service import AuthService
from ...services.class_service import ClassService
from ...services.report_service import ReportService

router = APIRouter()
report_service = ReportService()
assignment_service = AssignmentService()
class_service = ClassService()
auth_service = AuthService()
bearer_scheme = HTTPBearer(auto_error=False)


def _require_auth_credentials(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> HTTPAuthorizationCredentials:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return credentials


def _require_auth_credentials(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> HTTPAuthorizationCredentials:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return credentials


def _decode_token_payload(credentials: HTTPAuthorizationCredentials) -> dict:
    try:
        payload_segment = credentials.credentials.split(".")[1]
        payload_segment += "=" * (-len(payload_segment) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_segment).decode("utf-8"))
    except (IndexError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


async def _get_requester_context(
    credentials: HTTPAuthorizationCredentials,
) -> tuple[str, str]:
    token_payload = _decode_token_payload(credentials)
    requester_id = token_payload.get("user_id") or token_payload.get("sub")
    role = token_payload.get("role")
    if not requester_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    if not role:
        requester = await auth_service.get_user(requester_id)
        role = requester.get("role") if requester else None
    if not role:
        raise HTTPException(status_code=401, detail="Invalid token")

    return requester_id, role


@router.get("/reports/student/{student_report_id}", status_code=status.HTTP_200_OK)
async def get_student_report_by_id(
    student_report_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(_require_auth_credentials),
) -> dict:
    """Get individual student report using only student_report_id."""
    requester_id, role = await _get_requester_context(credentials)
    include_unpublished = role in {"teacher", "admin"}
    entry = await report_service.get_student_report_entry_by_id(
        student_report_id,
        include_unpublished=include_unpublished,
    )

    # Backward-compatible fallback: students may pass report_id instead of student_report_id.
    if not entry and role == "student":
        entry = await report_service.get_student_report_entry_for_student(
            report_id=student_report_id,
            student_id=requester_id,
            include_unpublished=include_unpublished,
        )

    if not entry:
        detail = "Student report entry not found"
        if not include_unpublished:
            detail = "Student report entry not found or report is not published"
        raise HTTPException(status_code=404, detail=detail)
    return {"message": "Student report entry retrieved", "data": entry}


@router.get("/assignments/{assignment_id}/reports", status_code=status.HTTP_200_OK)
async def list_assignment_reports(assignment_id: str) -> dict:
    reports = await report_service.list_assignment_reports(assignment_id)
    return {"message": "Reports retrieved", "data": reports}


@router.post(
    "/assignments/{assignment_id}/reports/publish", status_code=status.HTTP_200_OK
)
async def publish_assignment_reports(
    assignment_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(_require_auth_credentials),
) -> dict:
    requester_id, role = await _get_requester_context(credentials)
    if role not in {"teacher", "admin"}:
        raise HTTPException(
            status_code=403,
            detail="Only teacher or admin can publish reports",
        )

    assignment = await assignment_service.get_assignment(assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    class_doc = await class_service.get_class(assignment.get("class_id", ""))
    if not class_doc:
        raise HTTPException(status_code=404, detail="Class not found")

    if role == "teacher" and class_doc.get("teacher_id") != requester_id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to publish reports for this assignment",
        )

    publish_result = await report_service.publish_latest_assignment_report(
        assignment_id
    )
    if not publish_result:
        raise HTTPException(
            status_code=404, detail="No report found for this assignment"
        )

    return {
        "message": "Reports published for students",
        "data": publish_result,
    }


async def _require_assignment_teacher(
    assignment_id: str,
    credentials: HTTPAuthorizationCredentials,
) -> tuple[str, str]:
    requester_id, role = await _get_requester_context(credentials)
    if role not in {"teacher", "admin"}:
        raise HTTPException(
            status_code=403,
            detail="Only teacher or admin can access reports",
        )

    assignment = await assignment_service.get_assignment(assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    class_doc = await class_service.get_class(assignment.get("class_id", ""))
    if not class_doc:
        raise HTTPException(status_code=404, detail="Class not found")

    if role == "teacher" and class_doc.get("teacher_id") != requester_id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to access reports for this assignment",
        )

    return requester_id, role


@router.get(
    "/assignments/{assignment_id}/reports/history", status_code=status.HTTP_200_OK
)
async def get_report_history(
    assignment_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(_require_auth_credentials),
) -> dict:
    await _require_assignment_teacher(assignment_id, credentials)
    return {
        "message": "Report history retrieved",
        "data": await report_service.list_report_history(assignment_id),
    }


@router.get(
    "/assignments/{assignment_id}/reports/{report_id}", status_code=status.HTTP_200_OK
)
async def get_single_report(
    assignment_id: str,
    report_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(_require_auth_credentials),
) -> dict:
    await _require_assignment_teacher(assignment_id, credentials)
    formatted = await report_service.get_formatted_report(assignment_id, report_id)
    if not formatted:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"message": "Report retrieved", "data": formatted}


@router.get("/{report_id}/matches", status_code=status.HTTP_200_OK)
async def get_report_matches(report_id: str) -> dict:
    result = await report_service.get_report_matches(report_id)
    if not result:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"message": "Matches retrieved", "data": result}
