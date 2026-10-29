"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAssignmentReports,
  useAssignment,
  parseServerDate,
} from "@/features/teacher/api";
import { normalizePercent } from "@/components/plagiarism/PlagiarismReport";
import { useAuthStore } from "@/store/authStore";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function TeacherAssignmentReportHistoryPage() {
  const { courseId, assignmentId } = useParams() as { courseId: string; assignmentId: string };
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const isTeacher = user?.role === "teacher";

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
    isLoading: loadingReports,
    isError,
  } = useQuery({
    queryKey: ["assignmentReports", assignmentId],
    queryFn: () => fetchAssignmentReports(assignmentId),
    enabled: Boolean(assignmentId) && isTeacher,
    staleTime: 5000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: assignment, isLoading: loadingAssignment } = useAssignment(assignmentId);

  const sortedReports = useMemo(() => {
    return [...(reports ?? [])].sort((a, b) => {
      const bTime = parseServerDate(b.generated_at ?? null)?.getTime() ?? 0;
      const aTime = parseServerDate(a.generated_at ?? null)?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [reports]);

  if (!hydrated) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user || !isTeacher) return null;

  if (loadingReports || loadingAssignment) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Report History</h1>
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load report history.</p>
        <button
          type="button"
          onClick={() => router.push(`/dashboard/course/${courseId}/assignment/${assignmentId}/submissions`)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Back to Submissions
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/dashboard/course/${courseId}/assignment/${assignmentId}/submissions`)}
            className="p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="Back to Submissions"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Report History{assignment?.title ? ` — ${assignment.title}` : ""}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {sortedReports.length} {sortedReports.length === 1 ? "report" : "reports"} generated
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push(`/dashboard/teacher/courses/${courseId}/assignment/${assignmentId}/report`)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          View Latest Report
        </button>
      </div>

      {sortedReports.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-base font-semibold text-slate-900 dark:text-white">No reports generated yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Run a plagiarism check from the submissions page to generate the first report.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/dashboard/course/${courseId}/assignment/${assignmentId}/submissions`)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Go to Submissions
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/30">
                <tr className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Generated</th>
                  <th className="px-4 py-3">Students compared</th>
                  <th className="px-4 py-3">Avg similarity</th>
                  <th className="px-4 py-3">Max similarity</th>
                  <th className="px-4 py-3">Published</th>
                  <th className="px-4 py-3">Report ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedReports.map((report, index) => {
                  const isTop = index === 0;
                  const reportId = report.report_id ?? "";
                  const generatedDate = parseServerDate(report.generated_at ?? null);
                  const comparedCount = Array.isArray(report.documents) ? report.documents.length : "—";
                  const avgSim = `${normalizePercent(report.average_similarity).toFixed(1)}%`;
                  const maxSim = `${normalizePercent(report.max_similarity).toFixed(1)}%`;
                  const isPublished = report.is_published ? "Yes" : "No";
                  const shortId = reportId ? reportId.slice(0, 8) : "—";

                  const handleRowClick = () => {
                    if (reportId) {
                      router.push(
                        `/dashboard/teacher/courses/${courseId}/assignment/${assignmentId}/report?report=${reportId}`
                      );
                    }
                  };

                  return (
                    <tr
                      key={reportId || index}
                      role="link"
                      tabIndex={0}
                      onClick={handleRowClick}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleRowClick();
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-800/50"
                    >
                      <td className="px-4 py-3.5 font-medium text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <span>{index + 1}</span>
                          {isTop && (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              Latest
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        {generatedDate ? generatedDate.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        {comparedCount}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        {avgSim}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        {maxSim}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            report.is_published
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {isPublished}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {shortId}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
