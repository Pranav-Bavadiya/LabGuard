import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Course, Assignment } from "@/lib/api";

export type { Course, Assignment } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Backend response shapes                                           */
/* ------------------------------------------------------------------ */

type ApiEnvelope<T> = {
  message?: string;
  data: T;
};

type BackendClass = {
  class_id: string;
  name: string;
  section?: string | null;
  class_code?: string;
  description?: string | null;
  teacher_id?: string;
  student_count?: number;
};

// Mirrors AssignmentSummary / AssignmentDetails from assignment_schema.py
type BackendAssignment = {
  assignment_id: string;
  class_id: string;
  filename: string;
  content_type: string;
  file_type: "pdf" | "doc" | "docx" | "txt" | "ppt" | "pptx" | "xls" | "xlsx" | "csv" | "image" | "other";
  size_bytes: number;
  status: "draft" | "published" | "closed";
  submission_count: number;
  created_at: string;
  // AssignmentDetails extras
  description?: string | null;
  storage_path?: string | null;
  // Stored in MongoDB but not in strict schema
  due_date?: string | null;
  title?: string | null;
};

type BackendSubmission = {
  id?: string | null;
  assignment_id: string;
  student_id: string;
  student_name: string;
  document_id?: string | null;
  status: "submitted" | "processing" | "failed" | "not_submitted";
  submitted_at?: string | null;
};

/* ------------------------------------------------------------------ */
/*  Mappers                                                           */
/* ------------------------------------------------------------------ */

function mapCourse(c: BackendClass): Course {
  return {
    id: c.class_id,
    title: c.name,
    subtitle:
      [c.class_code, c.section].filter(Boolean).join(" • ") || "Class",
  };
}

function mapAssignment(a: BackendAssignment): Assignment {
  return {
    id: a.assignment_id,
    courseId: a.class_id,
    title: a.title ?? a.filename,
    description: a.description ?? "",
    dueDate: a.due_date ?? undefined,
  };
}

export type Submission = {
  id?: string | null;
  assignmentId: string;
  studentId: string;
  studentName: string;
  documentId?: string | null;
  status: "submitted" | "processing" | "failed" | "not_submitted";
  submittedAt?: string | null;
};

function mapSubmission(s: BackendSubmission): Submission {
  return {
    id: s.id,
    assignmentId: s.assignment_id,
    studentId: s.student_id,
    studentName: s.student_name,
    documentId: s.document_id ?? null,
    status: s.status,
    submittedAt: s.submitted_at,
  };
}

/* ------------------------------------------------------------------ */
/*  API functions                                                     */
/* ------------------------------------------------------------------ */

export const fetchStudentCourses = async (): Promise<Course[]> => {
  const res = await apiClient.get<ApiEnvelope<BackendClass[]>>("/classes/");
  return res.data.data.map(mapCourse);
};

export const fetchStudentCourseById = async (
  courseId: string
): Promise<Course | undefined> => {
  const res = await apiClient.get<ApiEnvelope<BackendClass>>(
    `/classes/${courseId}`
  );
  return mapCourse(res.data.data);
};

export const fetchStudentAssignments = async (
  courseId: string
): Promise<Assignment[]> => {
  const res = await apiClient.get<ApiEnvelope<BackendAssignment[]>>(
    `/classes/${courseId}/assignments`
  );
  return (res.data.data ?? []).map(mapAssignment);
};

/* ------------------------------------------------------------------ */
/*  React Query hooks                                                 */
/* ------------------------------------------------------------------ */

export const useStudentCourses = () =>
  useQuery({
    queryKey: ["student", "courses"],
    queryFn: fetchStudentCourses,
  });

export const useStudentCourse = (courseId: string) =>
  useQuery({
    queryKey: ["student", "course", courseId],
    queryFn: () => fetchStudentCourseById(courseId),
    enabled: !!courseId,
  });

export const useStudentAssignments = (courseId: string) =>
  useQuery({
    queryKey: ["assignments", courseId],
    queryFn: () => fetchStudentAssignments(courseId),
    enabled: !!courseId,
  });

/* ------------------------------------------------------------------ */
/*  Join class by code                                                */
/* ------------------------------------------------------------------ */

export interface JoinClassResult {
  classId: string;
  name: string;
}

export const joinClassByCode = async (
  joinCode: string
): Promise<JoinClassResult> => {
  const res = await apiClient.post<
    ApiEnvelope<{ class_id: string; name: string }>
  >("/classes/join", { join_code: joinCode });
  return {
    classId: res.data.data.class_id,
    name: res.data.data.name,
  };
};

export const useJoinClass = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: joinClassByCode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student", "courses"] });
    },
  });
};

/* ------------------------------------------------------------------ */
/*  Submit Assignment                                                 */
/* ------------------------------------------------------------------ */

export const deleteSubmission = async (
  submissionId: string
): Promise<void> => {
  await apiClient.delete(`/submissions/${submissionId}`);
};

export const submitAssignment = async (
  assignmentId: string,
  file: File
): Promise<Submission> => {
  const formData = new FormData();
  formData.append("file", file);

  const res = await apiClient.post<ApiEnvelope<{ submission_id: string }>>(
    `/assignments/${assignmentId}/submit`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );

  // Backend only returns submission_id, so fetch the full submission object
  const submissionId = res.data.data.submission_id;
  const submission = await fetchSubmission(submissionId);
  if (!submission) throw new Error("Failed to fetch created submission");
  return submission;
};

export const fetchSubmission = async (
  submissionId: string
): Promise<Submission | undefined> => {
  const res = await apiClient.get<ApiEnvelope<BackendSubmission>>(
    `/submissions/${submissionId}`
  );
  return mapSubmission(res.data.data);
};

export const useSubmitAssignment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, file }: { assignmentId: string; file: File }) =>
      submitAssignment(assignmentId, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["submission", variables.assignmentId],
      });
    },
  });
};

export const useReplaceSubmission = (defaultStudentId?: string | null) => {
  const queryClient = useQueryClient();

  const invalidate = (variables?: {
    assignmentId: string;
    studentId?: string | null;
  }) => {
    if (!variables) return;
    const sid =
      variables.studentId !== undefined ? variables.studentId : defaultStudentId;
    queryClient.invalidateQueries({
      queryKey: ["submission", variables.assignmentId],
    });
    if (sid !== undefined) {
      queryClient.invalidateQueries({
        queryKey: ["submission", variables.assignmentId, sid],
      });
    }
    queryClient.invalidateQueries({
      queryKey: ["submissions", variables.assignmentId],
    });
  };

  return useMutation({
    mutationFn: async ({
      assignmentId,
      submissionId,
      file,
    }: {
      assignmentId: string;
      submissionId: string;
      file: File;
      studentId?: string | null;
    }) => {
      await deleteSubmission(submissionId);
      return submitAssignment(assignmentId, file);
    },
    onSuccess: (_, variables) => {
      invalidate(variables);
    },
    onError: (_, variables) => {
      invalidate(variables);
    },
  });
};

export const fetchStudentSubmission = async (
  assignmentId: string,
  studentId: string | null
): Promise<Submission | null> => {
  if (!studentId) return null;

  try {
    const res = await apiClient.get<ApiEnvelope<BackendSubmission[]>>(
      `/assignments/${assignmentId}/submissions`
    );

    const submissions = Array.isArray(res.data.data) ? res.data.data : [];
    const submission = submissions.find(
      (item) => item.student_id === studentId
    );
    return submission ? mapSubmission(submission) : null;
  } catch {
    return null;
  }
};

export const fetchAssignmentSubmissions = async (
  assignmentId: string
): Promise<Submission[]> => {
  const res = await apiClient.get<ApiEnvelope<BackendSubmission[]>>(
    `/assignments/${assignmentId}/submissions`
  );

  const submissions = Array.isArray(res.data.data) ? res.data.data : [];
  return submissions.map(mapSubmission);
};

export const useStudentSubmission = (
  assignmentId: string,
  studentId: string | null
) =>
  useQuery({
    queryKey: ["submission", assignmentId, studentId],
    queryFn: () => fetchStudentSubmission(assignmentId, studentId),
    enabled: !!assignmentId && !!studentId,
  });

export const useAssignmentSubmissions = (assignmentId: string) =>
  useQuery({
    queryKey: ["assignment-submissions", assignmentId],
    queryFn: () => fetchAssignmentSubmissions(assignmentId),
    enabled: !!assignmentId,
  });

/* ------------------------------------------------------------------ */
/*  Plagiarism Report Types                                           */
/* ------------------------------------------------------------------ */

type AssignmentReport = {
  report_id?: string;
  assignment_id?: string;
  generated_at?: string | null;
  matrix?: Array<{
    student_id?: string;
    document_id?: string;
    student_report_id?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export type StudentReportEntry = {
  student_report_id: string;
  report_id?: string;
  assignment_id?: string;
  document_id?: string;
  plagiarism_score?: number;
  comparisons?: unknown;
  [key: string]: unknown;
};

/* ------------------------------------------------------------------ */
/*  Plagiarism Report API Functions                                   */
/* ------------------------------------------------------------------ */

export const fetchAssignmentReports = async (assignmentId: string): Promise<AssignmentReport[]> => {
  const res = await apiClient.get<ApiEnvelope<AssignmentReport[]>>(
    `/assignments/${assignmentId}/reports`
  );
  return res.data.data;
};

export const fetchStudentReport = async (studentReportId: string): Promise<StudentReportEntry> => {
  const res = await apiClient.get<ApiEnvelope<StudentReportEntry>>(
    `/reports/student/${studentReportId}`
  );
  return res.data.data;
};

export const useAssignmentReports = (assignmentId: string) =>
  useQuery({
    queryKey: ["assignment-reports", assignmentId],
    queryFn: () => fetchAssignmentReports(assignmentId),
    enabled: !!assignmentId,
  });

export const useStudentReport = (studentReportId: string | null | undefined) =>
  useQuery({
    queryKey: ["student-report", studentReportId],
    queryFn: () => fetchStudentReport(studentReportId as string),
    enabled: Boolean(studentReportId),
  });
