from __future__ import annotations

import hashlib
import logging

import anyio.to_thread

from ..repositories.submission_repository import SubmissionRepository
from ..services.document_service import Document
from ..services.document_management_service import DocumentManagementService
from ..services.detection_service import PlagiarismDetector, PlagiarismConfig
from ..repositories.report_repository import ReportRepository
from ..repositories.detection_repository import DetectionRepository

logger = logging.getLogger(__name__)

# Bump this whenever detection logic or settings change so old reports stop being reused
DETECTION_VERSION = "1"


class DetectionOrchestrationService:
    """Orchestrate plagiarism detection pipeline for assignments."""

    def __init__(self) -> None:
        self.submission_repo = SubmissionRepository()
        self.report_repo = ReportRepository()
        self.detection_repo = DetectionRepository()
        self.document_service = DocumentManagementService()
        self.detector = PlagiarismDetector(PlagiarismConfig())

    @staticmethod
    def _fingerprint(submissions: list[dict]) -> str:
        doc_ids = sorted(
            str(s["document_id"]) for s in submissions if s.get("document_id")
        )
        return hashlib.sha256(
            (f"{'|'.join(doc_ids)}||{DETECTION_VERSION}").encode("utf-8")
        ).hexdigest()

    async def start_detection(self, assignment_id: str, force: bool = False) -> dict:
        """Create a detection job that can be processed in the background, or reuse existing report."""
        submissions = await self.submission_repo.list_assignment_submissions(assignment_id)
        if not force and len(submissions) >= 2:
            latest = await self.report_repo.get_latest_report_meta(assignment_id)
            if latest and latest.get("input_fingerprint") == self._fingerprint(submissions):
                job = await self.detection_repo.create_detection_job(assignment_id, "completed")
                await self.detection_repo.update_detection_job(job["id"], "completed", latest["report_id"])
                return {
                    "job_id": job["id"],
                    "assignment_id": assignment_id,
                    "status": "completed",
                    "report_id": latest["report_id"],
                    "reused": True,
                    "generated_at": latest.get("generated_at"),
                }

        job = await self.detection_repo.create_detection_job(assignment_id, "starting")
        return {
            "job_id": job["id"],
            "assignment_id": assignment_id,
            "status": "starting",
            "reused": False,
        }

    async def run_detection_job(self, job_id: str, assignment_id: str) -> None:
        """Run plagiarism detection for an existing background job."""
        try:
            await self.detection_repo.update_detection_job(job_id, "processing")
            await self._process_detection_job(job_id, assignment_id)
        except Exception:
            await self.detection_repo.update_detection_job(job_id, "failed")
            raise

    async def _process_detection_job(self, job_id: str, assignment_id: str) -> dict:
        """Execute detection work and update the existing job record."""
        logger.info(
            "Starting detection for assignment %s (job %s)", assignment_id, job_id
        )

        try:
            # Fetch all submissions for this assignment
            logger.debug("Fetching submissions for assignment %s", assignment_id)
            submissions = await self.submission_repo.list_assignment_submissions(
                assignment_id
            )

            logger.info(
                "Found %d submissions for assignment %s",
                len(submissions),
                assignment_id,
            )

            if len(submissions) < 2:
                # Not enough submissions to compare
                logger.warning(
                    "Assignment %s has only %d submissions (need >= 2). Skipping detection.",
                    assignment_id,
                    len(submissions),
                )
                await self.detection_repo.update_detection_job(job_id, "completed")
                return {
                    "job_id": job_id,
                    "status": "completed",
                    "report_id": None,
                    "message": f"Insufficient submissions ({len(submissions)}). At least 2 required.",
                }

            # Build Document objects from submissions
            logger.debug(
                "Loading document content for %d submissions", len(submissions)
            )
            documents = []
            failed_submissions = 0

            for sub in submissions:
                try:
                    content = await self.document_service.get_document_content(
                        sub["document_id"]
                    )

                    if not content:
                        logger.warning(
                            "No content for submission %s (document %s). Skipping.",
                            sub.get("id"),
                            sub.get("document_id"),
                        )
                        failed_submissions += 1
                        continue

                    doc = Document(
                        id=sub["document_id"],
                        filename=f"submission_{sub.get('student_id', 'unknown')}",
                        content=content,
                    )
                    documents.append(doc)

                except Exception as e:
                    logger.error("Failed to load submission %s: %s", sub.get("id"), e)
                    failed_submissions += 1
                    continue

            logger.info(
                "Successfully loaded %d/%d submissions (%d failed)",
                len(documents),
                len(submissions),
                failed_submissions,
            )

            if len(documents) < 2:
                logger.error(
                    "Not enough valid documents for comparison (%d). Aborting.",
                    len(documents),
                )
                await self.detection_repo.update_detection_job(job_id, "failed")
                return {
                    "job_id": job_id,
                    "status": "failed",
                    "message": f"Could not load sufficient documents ({len(documents)}). "
                    f"{failed_submissions} submissions failed to load.",
                }

            # Run detection pipeline
            logger.info("Running plagiarism detection on %d documents", len(documents))
            detection_results = await anyio.to_thread.run_sync(
            self.detector.detect, documents
            )

            if not detection_results:
                logger.warning("Detection returned empty results")
                detection_results = {doc.id: [doc.id, {}, 0.0] for doc in documents}

            logger.info(
                "Detection completed. Generated results for %d documents",
                len(detection_results),
            )

            # Save report to database
            logger.debug("Saving detection report to database")
            report = await self.report_repo.create_report(
                assignment_id=assignment_id,
                results=detection_results,
                average_similarity=self._calculate_average_similarity(
                    detection_results
                ),
                max_similarity=self._calculate_max_similarity(detection_results),
                input_fingerprint=self._fingerprint(submissions),
                submission_count=len(submissions),
                document_count=len(detection_results),
            )

            logger.info(
                "Report saved: report_id=%s, avg_sim=%.2f, max_sim=%.2f",
                report.get("report_id"),
                report.get("average_similarity", 0.0),
                report.get("max_similarity", 0.0),
            )

            # Update job status
            await self.detection_repo.update_detection_job(
                job_id, "completed", report["report_id"]
            )

            logger.info("Detection job %s completed successfully", job_id)

            return {
                "job_id": job_id,
                "report_id": report["report_id"],
                "status": "completed",
                "message": "Detection completed successfully",
            }

        except Exception as e:
            logger.exception("Detection failed for assignment %s: %s", assignment_id, e)
            await self.detection_repo.update_detection_job(job_id, "failed")
            raise e

    async def get_detection_job_status(self, job_id: str) -> dict | None:
        """Get detection job status and associated report id."""
        job = await self.detection_repo.get_detection_job(job_id)
        if not job:
            return None

        return {
            "job_id": job.get("id"),
            "assignment_id": job.get("assignment_id"),
            "status": job.get("status"),
            "report_id": job.get("report_id"),
            "created_at": job.get("created_at"),
            "updated_at": job.get("updated_at"),
        }

    @staticmethod
    def _calculate_average_similarity(results: dict) -> float:
        """Calculate average similarity from detection results."""
        if not results:
            return 0.0

        total = 0.0
        count = 0
        for doc_id, (_, doc_group, score) in results.items():
            total += score
            count += 1

        return total / count if count > 0 else 0.0

    @staticmethod
    def _calculate_max_similarity(results: dict) -> float:
        """Calculate max similarity from detection results."""
        if not results:
            return 0.0

        max_score = 0.0
        for doc_id, (_, doc_group, score) in results.items():
            max_score = max(max_score, score)

        return max_score
