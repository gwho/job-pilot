// ============================================================
// JobPilot — canonical database types
// Generated against live InsForge schema on 2026-06-17.
// Updated 2026-06-26: added JobProvider union + source_provider to Job (Feature 10b).
// If you change the database schema, update this file to match.
// ============================================================


// ------------------------------------------------------------
// Literal unions for constrained text columns
// ------------------------------------------------------------

export type ExperienceLevel = 'junior' | 'mid' | 'senior' | 'lead'
export type RemotePreference = 'remote' | 'onsite' | 'hybrid' | 'any'
export type CoverLetterTone = 'formal' | 'casual' | 'enthusiastic'
export type WorkAuthorization = 'citizen' | 'permanent_resident' | 'visa_required'
export type JobSource = 'search' | 'url'
export type JobProvider = 'adzuna' | 'jobsdb_hk'
export type JobType = 'fulltime' | 'parttime' | 'contract'
export type AgentRunStatus = 'running' | 'completed' | 'failed'
export type LogLevel = 'info' | 'success' | 'warning' | 'error'

export type MissingField =
  | 'FULL NAME'
  | 'EMAIL'
  | 'PHONE'
  | 'LOCATION'
  | 'CURRENT TITLE'
  | 'EXPERIENCE LEVEL'
  | 'YEARS EXP'
  | 'SKILLS'
  | 'WORK EXPERIENCE'
  | 'EDUCATION'


// ------------------------------------------------------------
// Sub-types for JSONB columns
// ------------------------------------------------------------

export interface WorkExperienceEntry {
  company: string
  title: string
  startDate: string
  endDate: string | null
  current: boolean
  responsibilities: string
}

export interface Education {
  degree: string | null
  fieldOfStudy: string | null
  institution: string | null
  graduationYear: string | null
}

// Shape saved to jobs.company_research by the research agent (Feature 13)
export interface CompanyResearchDossier {
  companyOverview: string
  techStack: string[]
  culture: string[]
  whyThisRole: string
  yourEdge: string[]
  gapsToAddress: string[]
  smartQuestions: string[]
  interviewPrep: string[]
  sources: string[]
}


// ------------------------------------------------------------
// Table row types — what SELECT queries return
// Nullable columns reflect live schema (isNullable: YES).
// ------------------------------------------------------------

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  location: string | null
  current_title: string | null
  experience_level: ExperienceLevel | null
  years_experience: number | null
  skills: string[] | null
  industries: string[] | null
  work_experience: WorkExperienceEntry[] | null
  education: Education | null
  job_titles_seeking: string[] | null
  remote_preference: RemotePreference | null
  preferred_locations: string[] | null
  salary_expectation: string | null
  cover_letter_tone: CoverLetterTone | null
  linkedin_url: string | null
  portfolio_url: string | null
  work_authorization: WorkAuthorization | null
  resume_pdf_url: string | null
  resume_pdf_key: string | null
  resume_pdf_filename: string | null
  linkedin_connected: boolean
  is_tailored: boolean
  is_complete: boolean
  created_at: string
  updated_at: string
}

export interface AgentRun {
  id: string
  user_id: string
  status: AgentRunStatus
  job_title_searched: string | null
  location_searched: string | null
  jobs_found: number | null
  started_at: string
  completed_at: string | null
}

export interface Job {
  id: string
  run_id: string | null
  user_id: string
  source: JobSource
  source_provider: JobProvider | null
  source_url: string | null
  external_apply_url: string | null
  title: string | null
  company: string | null
  location: string | null
  salary: string | null
  job_type: JobType | null
  about_role: string | null
  responsibilities: string[] | null
  requirements: string[] | null
  nice_to_have: string[] | null
  benefits: string[] | null
  about_company: string | null
  match_score: number | null
  match_reason: string | null
  matched_skills: string[] | null
  missing_skills: string[] | null
  company_research: CompanyResearchDossier | null
  found_at: string
}

export interface AgentLog {
  id: string
  run_id: string | null
  user_id: string
  message: string
  level: LogLevel
  job_id: string | null
  created_at: string
}


// ------------------------------------------------------------
// Insert types — required vs optional fields for new rows.
// Columns with DB defaults (id, started_at, etc.) are optional.
// profiles.id must always be provided (= auth user's UUID).
// ------------------------------------------------------------

export type ProfileInsert = Omit<Profile, 'created_at' | 'updated_at' | 'is_complete'> & {
  is_complete?: boolean
}

export type AgentRunInsert = Omit<AgentRun, 'id' | 'started_at' | 'jobs_found' | 'completed_at' | 'status'> & {
  id?: string
  status?: AgentRunStatus
  jobs_found?: number
  completed_at?: string | null
}

export type JobInsert = Omit<Job, 'id' | 'found_at'> & {
  id?: string
  found_at?: string
}

export type AgentLogInsert = Omit<AgentLog, 'id' | 'created_at' | 'level'> & {
  id?: string
  level?: LogLevel
  created_at?: string
}
