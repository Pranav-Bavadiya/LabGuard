import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Course, Assignment } from "@/lib/api";

export type { Assignment } from "@/lib/api";
export type { Course } from "@/lib/api";

type ApiEnvelope<T> = {
  message?: string;
  data: T;
};

type AssignmentReport = {
  report_id?: string;
  assignment_id?: string;
  generated_at?: string | null;
  average_similarity?: number;
  max_similarity?: number;
  documents?: unknown[];
  matrix?: unknown[];
  is_published?: boolean;
  [key: string]: unknown;
};

export type DetectionJob = {
  job_id: string;
  assignment_id?: string;
  status: "starting" | "processing" | "completed" | "failed" | string;
  report_id?: string | null;
  reused?: boolean;
  generated_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DetectionJobStatusResponse = ApiEnvelope<DetectionJob>;

export type Cluster = {
  cluster_id: string;
  members: string[];
  size: number;
};

export type ClusterResponse = {
  assignment_id: string;
  clusters: Cluster[];
  report_id: string;
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

type BackendClass = {
  class_id: string;
  name: string;
  section?: string | null;
  class_code?: string;
  join_code?: string;
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
  // Stored in repo but not in schema
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
export interface CourseStudent {
  id: string;
  fullName: string;
  email: string;
}

// Add this type for the backend response
type BackendStudent = {
  id: string;
  full_name: string;
  email: string;
};
export interface Submission {
  id?: string | null;
  assignmentId: string;
  studentId: string;
  studentName: string;
  status: "submitted" | "processing" | "failed" | "not_submitted";
  submittedAt?: string | null;
  documentId?: string | null;
}

function mapCourse(course: BackendClass): Course {
  return {
    id: course.class_id,
    title: course.name,
    subtitle: [course.class_code, course.section].filter(Boolean).join(" • ") || "Class",
    joinCode: course.join_code,
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

function mapSubmission(submission: BackendSubmission): Submission {
  return {
    id: submission.id,
    assignmentId: submission.assignment_id,
    studentId: submission.student_id,
    studentName: submission.student_name,
    status: submission.status as Submission["status"],
    submittedAt: submission.submitted_at,
    documentId: submission.document_id,
  };
}

// API Functions
export const fetchCourses = async (): Promise<Course[]> => {
  const res = await apiClient.get<ApiEnvelope<BackendClass[]>>("/classes");
  return res.data.data.map(mapCourse);
};

export const fetchCourseById = async (courseId: string): Promise<Course | undefined> => {
  const res = await apiClient.get<ApiEnvelope<BackendClass>>(`/classes/${courseId}`);
  return mapCourse(res.data.data);
};

export const fetchAssignments = async (courseId: string): Promise<Assignment[]> => {
  const res = await apiClient.get<ApiEnvelope<BackendAssignment[]>>(
    `/classes/${courseId}/assignments`
  );
  return (res.data.data ?? []).map(mapAssignment);
};

export const fetchAssignmentById = async (assignmentId: string): Promise<Assignment | undefined> => {
  const res = await apiClient.get<ApiEnvelope<BackendAssignment>>(
    `/assignments/${assignmentId}`
  );
  return mapAssignment(res.data.data);
};

export const fetchSubmissions = async (assignmentId: string): Promise<Submission[]> => {
  const res = await apiClient.get<ApiEnvelope<BackendSubmission[]>>(
    `/assignments/${assignmentId}/submissions`
  );
  return (res.data.data ?? []).map(mapSubmission);
};

export const runPlagiarismCheck = async (
  assignmentId: string,
  force = false
): Promise<DetectionJob> => {
  const res = await apiClient.post<ApiEnvelope<DetectionJob>>(`/detection/run`, {
    assignment_id: assignmentId,
    force,
  });
  return res.data.data;
};

export const getDetectionJob = async (jobId: string): Promise<DetectionJob> => {
  if (!jobId || !jobId.trim()) {
    throw new Error("A valid detection job ID is required");
  }

  try {
    const res = await apiClient.get<DetectionJobStatusResponse>(`/detection/jobs/${jobId}`, { timeout: 30000 });
    const job = res.data.data;

    if (!job?.job_id) {
      throw new Error("Detection job response did not include a job_id");
    }

    return job;
  } catch (error) {
    console.error("[plagiarism] Failed to fetch detection job status", { jobId, error });
    throw error instanceof Error
      ? error
      : new Error("Failed to fetch plagiarism detection job status");
  }
};

export const getStoredJobId = (assignmentId: string): string | null => {
  if (typeof window === "undefined" || !assignmentId) return null;
  try {
    return sessionStorage.getItem(`labguard:detectionJob:${assignmentId}`);
  } catch {
    return null;
  }
};

export const setStoredJobId = (assignmentId: string, jobId: string): void => {
  if (typeof window === "undefined" || !assignmentId || !jobId) return;
  try {
    sessionStorage.setItem(`labguard:detectionJob:${assignmentId}`, jobId);
  } catch {}
};

export const clearStoredJobId = (assignmentId: string): void => {
  if (typeof window === "undefined" || !assignmentId) return;
  try {
    sessionStorage.removeItem(`labguard:detectionJob:${assignmentId}`);
  } catch {}
};

export const useDetectionJob = (jobId: string | null) =>
  useQuery({
    queryKey: ["detectionJob", jobId],
    queryFn: () => getDetectionJob(jobId as string),
    enabled: Boolean(jobId),
    retry: (failureCount, error) => failureCount < 3 && !/not found/i.test(error.message),
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const status = String(query.state.data?.status ?? "").toLowerCase();
      if (status === "completed" || status === "failed") return false;
      return 3000;
    },
    refetchIntervalInBackground: true,
  });

export const fetchAssignmentReports = async (assignmentId: string): Promise<AssignmentReport[]> => {
  const res = await apiClient.get<ApiEnvelope<AssignmentReport[]>>(
    `/assignments/${assignmentId}/reports`
  );
  return Array.isArray(res.data.data) ? res.data.data : [];
};

export const fetchAssignmentClusters = async (assignmentId: string): Promise<ClusterResponse> => {
  const res = await apiClient.get<ApiEnvelope<ClusterResponse>>(
    `/assignments/${assignmentId}/clusters`
  );
  return res.data.data;
};

export const publishAssignmentReports = async (assignmentId: string): Promise<unknown> => {
  const res = await apiClient.post<ApiEnvelope<unknown>>(
    `/assignments/${assignmentId}/reports/publish`
  );
  return res.data.data;
};

export const fetchStudentReport = async (studentReportId: string): Promise<StudentReportEntry> => {
  const res = await apiClient.get<ApiEnvelope<StudentReportEntry>>(
    `/reports/student/${studentReportId}`
  );
  return res.data.data;
};

export const getLatestReport = <T extends { generated_at?: string | null }>(reports: T[]): T | undefined => {
  const sorted = [...(reports ?? [])].sort((a, b) => {
    const aParsed = a?.generated_at ? Date.parse(a.generated_at) : 0;
    const bParsed = b?.generated_at ? Date.parse(b.generated_at) : 0;
    const aTime = Number.isFinite(aParsed) ? aParsed : 0;
    const bTime = Number.isFinite(bParsed) ? bParsed : 0;
    return bTime - aTime;
  });
  return sorted[0];
};

export const parseServerDate = (v?: string | null): Date | null => {
  if (!v) return null;
  const hasTz = /(Z|[+-]\d{2}:\d{2})$/.test(v);
  const d = new Date(hasTz ? v : `${v}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const isReportUpToDate = (
  report: { generated_at?: string | null; documents?: unknown[] } | undefined,
  submissions: Submission[]
): boolean => {
  if (!report) return false;
  const generatedAt = parseServerDate(report.generated_at ?? null);
  if (!generatedAt) return false;
  const current = submissions.filter(
    (s) => (s.status === "submitted" || s.status === "processing") && s.documentId
  );
  // anything submitted after the report was generated (unknown time counts as changed)
  if (current.some((s) => { const t = parseServerDate(s.submittedAt ?? null); return !t || t > generatedAt; })) return false;
  // a document that was compared in the report has since been removed
  const currentIds = new Set(current.map((s) => String(s.documentId)));
  if ((report.documents ?? []).map(String).some((id) => !currentIds.has(id))) return false;
  return true;
};

export interface CourseStudent {
  id: string;
  fullName: string;
  email: string;
}

export const fetchCourseStudents = async (courseId: string): Promise<CourseStudent[]> => {
  const res = await apiClient.get<ApiEnvelope<{ class_id: string; students: BackendStudent[] }>>(
    `/classes/${courseId}/students`
  );
  const students = res.data.data.students ?? [];
  
  // Debug: check if student names are populated
  if (students.length > 0 && !students[0].full_name) {
    console.warn("Backend returned empty full_name for students:", students[0]);
  }
  
  return students.map((s: BackendStudent) => ({
    id: s.id,
    fullName: s.full_name || s.email?.split("@")[0] || "Unknown",
    email: s.email,
  }));
};

export interface CreateAssignmentInput {
  courseId: string;
  title: string;
  description: string;
  dueDate?: string;
  file: File;
}

export const createAssignment = async (data: CreateAssignmentInput): Promise<Assignment> => {
  const formData = new FormData();
  formData.append("file", data.file);
  if (data.description) formData.append("description", data.description);
  if (data.dueDate) formData.append("due_date", data.dueDate);

  const res = await apiClient.post<ApiEnvelope<{ assignment_id: string }>>(
    `/classes/${data.courseId}/assignments`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );

  // After creating, fetch the full assignment object
  const assignmentId = res.data.data.assignment_id;
  const assignment = await fetchAssignmentById(assignmentId);
  if (!assignment) throw new Error("Failed to fetch created assignment");
  return assignment;
};

export const deleteAssignment = async (assignmentId: string): Promise<void> => {
  await apiClient.delete(`/assignments/${assignmentId}`);
};

// React Query Hooks
export const useCourses = () => {
  return useQuery({
    queryKey: ["courses"],
    queryFn: fetchCourses,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export const useCourse = (courseId: string) => {
    return useQuery({
      queryKey: ["course", courseId],
      queryFn: () => fetchCourseById(courseId),
      staleTime: 10 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    });
};

export const useAssignments = (courseId: string) => {
  return useQuery({
    queryKey: ["assignments", courseId],
    queryFn: () => fetchAssignments(courseId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export const useAssignment = (assignmentId: string) => {
    return useQuery({
      queryKey: ["assignment", assignmentId],
      queryFn: () => fetchAssignmentById(assignmentId),
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    });
};

export const useSubmissions = (assignmentId: string) => {
  return useQuery({
    queryKey: ["submissions", assignmentId],
    queryFn: () => fetchSubmissions(assignmentId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export const useCourseStudents = (courseId: string) => {
  return useQuery({
    queryKey: ["course-students", courseId],
    queryFn: () => fetchCourseStudents(courseId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};
export const useCreateAssignment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAssignment,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["assignments", variables.courseId] });
    },
    onError: (error) => {
      console.error("Failed to create assignment:", error);
    },
  });
};

export const useDeleteAssignment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (error) => {
      console.error("Failed to delete assignment:", error);
    },
  });
};

export const useRunPlagiarism = () => {
  return useMutation({
    mutationFn: ({
      assignmentId,
      force,
    }: {
      assignmentId: string;
      force?: boolean;
    }) => runPlagiarismCheck(assignmentId, force),
    onError: (error) => {
      console.error("Failed to run plagiarism check:", error);
    },
  });
};

export const usePublishReports = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => publishAssignmentReports(assignmentId),
    onSuccess: (_, assignmentId) => {
      queryClient.invalidateQueries({ queryKey: ["assignmentReports", assignmentId] });
    },
    onError: (error) => {
      console.error("Failed to publish reports:", error);
    },
  });
};

export const useStudentReport = (studentReportId: string | null | undefined) => {
  return useQuery({
    queryKey: ["student-report", studentReportId],
    queryFn: () => fetchStudentReport(studentReportId as string),
    enabled: Boolean(studentReportId),
  });
};

export const useAssignmentClusters = (assignmentId: string) => {
  return useQuery({
    queryKey: ["clusters", assignmentId],
    queryFn: () => fetchAssignmentClusters(assignmentId),
    enabled: false,
  });
};

/* ------------------------------------------------------------------ */
/*  Create Course (Class)                                             */
/* ------------------------------------------------------------------ */

  export interface CreateCoursePayload {
    name: string;
    class_code: string;
    description: string;
    section?: string;
  }

  export interface CreateCourseResult {
    classId: string;
    joinCode: string;
  }

export const createCourse = async (
  data: CreateCoursePayload
): Promise<CreateCourseResult> => {
  // First create the class
  const res = await apiClient.post<ApiEnvelope<{ class_id: string }>>(
    "/classes/",
    {
      name: data.name,
      class_code: data.class_code,
      description: data.description,
      section: data.section || null,
    }
  );

  const classId = res.data.data.class_id;

  // Fetch the created class to get the join_code
  const detail = await apiClient.get<ApiEnvelope<BackendClass & { join_code?: string }>>(
    `/classes/${classId}`
  );

  return {
    classId,
    joinCode: detail.data.data.join_code ?? "",
  };
};

export const useCreateCourse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCourse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });
};
