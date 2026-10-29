"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import {
  fetchAssignmentById,
  fetchAssignmentReports,
  fetchSubmissions,
  useCourseStudents,
  usePublishReports,
  parseServerDate,
  isReportUpToDate,
} from "@/features/teacher/api";
import { PlagiarismReport } from "@/components/plagiarism/PlagiarismReport";
import { useAuthStore } from "@/store/authStore";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type ReportLike = {
  documents?: unknown;
  matrix?: unknown;
  [key: string]: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getDocLabel = (documentId: unknown, labels: Map<string, string>): string => {
  const id = String(documentId ?? "");
  return labels.get(id) ?? id;
};

const withStudentNames = (rawReport: unknown, labels: Map<string, string>): unknown => {
  if (!isRecord(rawReport)) return rawReport;

  const report = rawReport as ReportLike;

  const documents = Array.isArray(report.documents)
    ? (report.documents as unknown[]).map((docId) => getDocLabel(docId, labels))
    : report.documents;

  const matrix = Array.isArray(report.matrix)
    ? (report.matrix as Array<Record<string, unknown>>).map((row) => {
        const comparisons = Array.isArray(row.comparisons)
          ? (row.comparisons as Array<Record<string, unknown>>).map((cmp) => ({
              ...cmp,
              document_id: getDocLabel(cmp.document_id, labels),
            }))
          : row.comparisons;

        return {
          ...row,
          document_id: getDocLabel(row.document_id, labels),
          comparisons,
        };
      })
    : report.matrix;

  return {
    ...report,
    documents,
    matrix,
  };
};

function ReportContent() {
  const { courseId, assignmentId } = useParams() as { courseId: string; assignmentId: string };
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const isTeacher = user?.role === "teacher";
  const [published, setPublished] = useState(false);
  const publishReportsMutation = usePublishReports();

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    if (user.role !== "teacher") {
      router.replace("/dashboard/student");
    }
  }, [hydrated, user, router]);

  const {
    data: reports,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["assignmentReports", assignmentId],
    queryFn: () => fetchAssignmentReports(assignmentId),
    enabled: Boolean(assignmentId) && isTeacher,
    staleTime: 5000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: assignment, isLoading: loadingAssignment } = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => fetchAssignmentById(assignmentId),
    enabled: Boolean(assignmentId) && isTeacher,
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: submissions, isLoading: loadingSubmissions } = useQuery({
    queryKey: ["submissions", assignmentId],
    queryFn: () => fetchSubmissions(assignmentId),
    enabled: Boolean(assignmentId) && isTeacher,
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: students } = useCourseStudents(courseId);

  const requestedReportId = searchParams.get("report");
  const sortedReports = useMemo(
    () =>
      [...(reports ?? [])].sort(
        (a, b) =>
          (parseServerDate(b.generated_at ?? null)?.getTime() ?? 0) -
          (parseServerDate(a.generated_at ?? null)?.getTime() ?? 0)
      ),
    [reports]
  );
  const activeReport = requestedReportId
    ? sortedReports.find((r) => r.report_id === requestedReportId)
    : sortedReports[0];
  const isLatest = Boolean(activeReport) && activeReport?.report_id === sortedReports[0]?.report_id;

  const submissionsOutdated = useMemo(() => {
    if (loadingSubmissions || !isLatest || !activeReport) return false;
    return !isReportUpToDate(activeReport, submissions ?? []);
  }, [loadingSubmissions, isLatest, activeReport, submissions]);

  const documentLabels = useMemo(() => {
    const map = new Map<string, string>();
    (submissions ?? []).forEach((s) => {
      if (s.documentId) {
        map.set(s.documentId, s.studentName);
      }
    });
    return map;
  }, [submissions]);

  const displayReport = useMemo(() => {
    return withStudentNames(activeReport ?? null, documentLabels);
  }, [activeReport, documentLabels]);

  if (!hydrated) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user || !isTeacher) return null;

  if (isLoading || loadingAssignment || loadingSubmissions) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Plagiarism Report</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Failed to load reports.</p>
      </div>
    );
  }

  if (requestedReportId && !activeReport) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Report not found</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The requested plagiarism report does not exist or has been removed.
        </p>
        <div className="flex items-center gap-4 pt-2">
          <button
            type="button"
            onClick={() => router.push(`/dashboard/course/${courseId}/assignment/${assignmentId}/submissions`)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Go to Submissions
          </button>
          <Link
            href={`/dashboard/teacher/courses/${courseId}/assignment/${assignmentId}/history`}
            className="text-sm font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            View Report History
          </Link>
        </div>
      </div>
    );
  }

  if (sortedReports.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Plagiarism Report</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No report yet. Run a plagiarism check from the submissions page.
        </p>
        <button
          type="button"
          onClick={() => router.push(`/dashboard/course/${courseId}/assignment/${assignmentId}/submissions`)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Go to Submissions
        </button>
      </div>
    );
  }

  const handlePublishReports = async () => {
    try {
      await publishReportsMutation.mutateAsync(assignmentId);
      setPublished(true);
      toast.success("Reports are now visible to students");
    } catch (error) {
      console.error("Failed to publish reports:", error);
      toast.error(error instanceof Error ? error.message : "Failed to publish reports");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Plagiarism Report{assignment?.title ? ` — ${assignment.title}` : ""}
          </h1>
          {activeReport?.generated_at && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Generated on {parseServerDate(activeReport.generated_at)?.toLocaleString()}
              {sortedReports.length > 1 && (
                <>
                  {" · "}
                  <Link
                    href={`/dashboard/teacher/courses/${courseId}/assignment/${assignmentId}/history`}
                    className="font-medium text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-400"
                  >
                    {sortedReports.length - 1} earlier run(s)
                  </Link>
                </>
              )}
            </p>
          )}
        </div>

        {isLatest && (
          <button
            type="button"
            onClick={handlePublishReports}
            disabled={published || publishReportsMutation.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {publishReportsMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Publishing...
              </>
            ) : published ? (
              "Published"
            ) : (
              "Publish Reports to Students"
            )}
          </button>
        )}
      </div>

      {!isLatest && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="text-sm">
            You are viewing an older report from {parseServerDate(activeReport?.generated_at ?? null)?.toLocaleString() ?? "an earlier run"}.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/dashboard/teacher/courses/${courseId}/assignment/${assignmentId}/report`)}
            className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
          >
            View latest report
          </button>
        </div>
      )}

      {submissionsOutdated && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="text-sm">
            Submissions have changed since this report was generated. Run the plagiarism check again to include them.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/dashboard/course/${courseId}/assignment/${assignmentId}/submissions`)}
            className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
          >
            Go to submissions
          </button>
        </div>
      )}

      <PlagiarismReport
        report={displayReport ?? null}
        submissions={submissions}
        students={students}
      />
    </div>
  );
}

export default function TeacherAssignmentReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      }
    >
      <ReportContent />
    </Suspense>
  );
}
