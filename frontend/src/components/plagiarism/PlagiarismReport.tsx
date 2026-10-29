"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useStudentReport } from "@/features/teacher/api";
import { StudentReportDetails } from "@/components/plagiarism/StudentReportDetails";

interface SubmissionData {
  documentId?: string | null;
  studentName: string;
  studentId: string;
}

interface StudentData {
  id: string;
  fullName: string;
}

interface UpdatedPlagiarismReportProps {
  report: unknown;
  submissions?: SubmissionData[];
  students?: StudentData[];
}

type Comparison = {
  document_id: string;
  similarity: number;
  matched_passages: number;
};

type MatrixRow = {
  student_report_id: string;
  document_id: string;
  plagiarism_score: number;
  comparisons: Comparison[];
};

type ParsedReport = {
  average_similarity: number;
  max_similarity: number;
  documents: string[];
  matrix: MatrixRow[];
};

type RiskTone = "green" | "yellow" | "red";

const toneClasses: Record<RiskTone, { badge: string; text: string; filled: string }> = {
  green: {
    badge:
      "bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
    text: "text-emerald-600 dark:text-emerald-300",
    filled: "bg-emerald-500",
  },
  yellow: {
    badge:
      "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
    text: "text-amber-600 dark:text-amber-300",
    filled: "bg-amber-500",
  },
  red: {
    badge:
      "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
    text: "text-rose-600 dark:text-rose-300",
    filled: "bg-rose-500",
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export const normalizePercent = (value: unknown): number => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  const percent = num <= 1 ? num * 100 : num;
  return Math.max(0, Math.min(100, percent));
};

const getTone = (score: number): RiskTone => {
  if (score < 40) return "green";
  if (score <= 70) return "yellow";
  return "red";
};

const parseReport = (rawReport: unknown): ParsedReport => {
  if (!isRecord(rawReport)) {
    return {
      average_similarity: 0,
      max_similarity: 0,
      documents: [],
      matrix: [],
    };
  }

  const rawMatrix = Array.isArray(rawReport.matrix) ? rawReport.matrix : [];
  const matrix: MatrixRow[] = rawMatrix
    .map((entry, index) => {
      if (!isRecord(entry)) return null;

      const comparisonsRaw = Array.isArray(entry.comparisons) ? entry.comparisons : [];
      const comparisons: Comparison[] = comparisonsRaw
        .map((cmp) => {
          if (!isRecord(cmp)) return null;
          return {
            document_id: String(cmp.document_id ?? "Unknown"),
            similarity: normalizePercent(cmp.similarity),
            matched_passages: Number(cmp.matched_passages ?? 0),
          };
        })
        .filter((cmp): cmp is Comparison => cmp !== null)
        .sort((a, b) => b.similarity - a.similarity);

      return {
        student_report_id: String(entry.student_report_id ?? `student-${index}`),
        document_id: String(entry.document_id ?? `Unknown-${index}`),
        plagiarism_score: normalizePercent(entry.plagiarism_score),
        comparisons,
      };
    })
    .filter((row): row is MatrixRow => row !== null)
    .sort((a, b) => b.plagiarism_score - a.plagiarism_score);

  const documents = Array.isArray(rawReport.documents)
    ? rawReport.documents.map((doc) => String(doc))
    : matrix.map((row) => row.document_id);

  return {
    average_similarity: normalizePercent(rawReport.average_similarity),
    max_similarity: normalizePercent(rawReport.max_similarity),
    documents,
    matrix,
  };
};

function SegmentedBar({ score }: { score: number }) {
  const tone = getTone(score);
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          key={index}
          className={`h-2 flex-1 rounded-full ${
            index < filled ? toneClasses[tone].filled : "bg-slate-200 dark:bg-slate-700"
          }`}
        />
      ))}
    </div>
  );
}

export function PlagiarismReport(props: UpdatedPlagiarismReportProps) {
  const { report, submissions = [], students = [] } = props;
  const parsed = useMemo(() => parseReport(report), [report]);

  const documentIdToStudentName = useMemo(() => {
    const studentIdToName = new Map(
      students.map((student) => [student.id, student.fullName])
    );

    const mapping = new Map<string, string>();
    submissions.forEach((submission) => {
      if (submission.documentId) {
        const name =
          studentIdToName.get(submission.studentId) ||
          submission.studentName ||
          "Unknown student";
        mapping.set(submission.documentId, name);
      }
    });
    return mapping;
  }, [submissions, students]);

  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [selectedStudentReportId, setSelectedStudentReportId] = useState<string | null>(null);

  const studentReportQuery = useStudentReport(selectedStudentReportId);

  const selectedStudentName = useMemo(() => {
    if (!selectedStudentReportId) return null;

    const selectedRow = parsed.matrix.find(
      (row) => row.student_report_id === selectedStudentReportId
    );
    if (!selectedRow) return null;

    return documentIdToStudentName.get(selectedRow.document_id) || selectedRow.document_id;
  }, [selectedStudentReportId, parsed.matrix, documentIdToStudentName]);

  const highSimilarityPairs = useMemo(() => {
    const total = parsed.matrix.reduce((acc, row) => {
      return acc + row.comparisons.filter((cmp) => cmp.similarity > 70).length;
    }, 0);

    return Math.ceil(total / 2);
  }, [parsed.matrix]);

  const toggleExpanded = (rowId: string) => {
    setExpandedRows((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }));
  };

  const handleViewDetails = (studentReportId: string) => {
    setSelectedStudentReportId((prev) => (prev === studentReportId ? null : studentReportId));
  };

  if (parsed.matrix.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Plagiarism Report</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          No report data available yet. Run plagiarism check to generate insights.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Plagiarism Overview</h3>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {parsed.documents.length} documents • {highSimilarityPairs} high-risk pairs
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {[{
            label: "Average Similarity",
            value: parsed.average_similarity,
          }, {
            label: "Max Similarity",
            value: parsed.max_similarity,
          }].map((metric) => {
            const tone = getTone(metric.value);
            return (
              <div
                key={metric.label}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{metric.label}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toneClasses[tone].badge}`}>
                    {metric.value.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-3">
                  <SegmentedBar score={metric.value} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Student Similarity</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Sorted by plagiarism score (highest first). Expand a card to inspect comparisons.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {parsed.matrix.map((row) => {
            const expanded = expandedRows[row.student_report_id] ?? false;
            const rowTone = getTone(row.plagiarism_score);

            const isSelected = selectedStudentReportId === row.student_report_id;

            return (
              <div
                key={row.student_report_id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpanded(row.student_report_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpanded(row.student_report_id);
                    }
                  }}
                  className="flex w-full cursor-pointer items-start justify-between gap-4 bg-slate-50/60 p-5 text-left transition-colors hover:bg-slate-100/60 dark:bg-slate-800/30 dark:hover:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Student</p>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {documentIdToStudentName.get(row.document_id) || row.document_id}
                    </p>
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Plagiarism score</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toneClasses[rowTone].badge}`}>
                      {row.plagiarism_score.toFixed(1)}%
                    </span>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleViewDetails(row.student_report_id);
                      }}
                      className={
                        "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      }
                    >
                      {isSelected ? "Hide Details" : "View Details"}
                    </button>

                    <span className="text-slate-500 transition-transform duration-200 dark:text-slate-400">
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </div>
                </div>

                <div
                  className={
                    expanded
                      ? "max-h-[560px] overflow-x-auto border-t border-slate-200 transition-all duration-300 dark:border-slate-800"
                      : "max-h-0 overflow-hidden transition-all duration-300"
                  }
                >
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <th className="px-4 py-3 font-semibold">Compared With</th>
                        <th className="px-4 py-3 font-semibold">Similarity</th>
                        <th className="px-4 py-3 font-semibold">Matches</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.comparisons.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-4 py-5 text-center text-slate-500 dark:text-slate-400">
                            No comparisons available.
                          </td>
                        </tr>
                      ) : (
                        row.comparisons.map((comparison) => {
                          const tone = getTone(comparison.similarity);
                          const highRisk = comparison.similarity > 70;

                          return (
                            <tr
                              key={`${row.student_report_id}-${comparison.document_id}`}
                              className={
                                highRisk
                                  ? "bg-rose-50/80 dark:bg-rose-950/20"
                                  : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                              }
                            >
                              <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                {documentIdToStudentName.get(comparison.document_id) || comparison.document_id}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`font-semibold ${toneClasses[tone].text}`}>
                                  {comparison.similarity.toFixed(1)}%
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                {comparison.matched_passages}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <StudentReportDetails
        open={Boolean(selectedStudentReportId)}
        studentReport={studentReportQuery.data}
        studentReportId={selectedStudentReportId}
        studentName={selectedStudentName}
        isLoading={studentReportQuery.isLoading}
        isError={studentReportQuery.isError}
        onCloseAction={() => setSelectedStudentReportId(null)}
      />
    </div>
  );
}
