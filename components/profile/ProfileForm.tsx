"use client";

import { useState, useMemo, useRef, useTransition } from "react";
import { AlertCircle, CheckCircle, Upload, Plus, X } from "lucide-react";

import { saveProfile, uploadResume, getResumeSignedUrl } from "@/actions/profile";
import { calculateCompletion } from "@/lib/profile-utils";
import type { ProfileExtraction } from "@/agent/extractor";
import type {
  Profile,
  WorkExperienceEntry,
  Education,
  ExperienceLevel,
  RemotePreference,
  CoverLetterTone,
  WorkAuthorization,
} from "@/types/index";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
type Props = {
  profile: Profile | null;
  email: string;
};

// ---------------------------------------------------------------------------
// FormState — dropdown fields widen to include '' because a controlled
// <select> needs a string for "no selection", not null.
// ---------------------------------------------------------------------------
type FormState = {
  full_name: string;
  phone: string;
  location: string;
  current_title: string;
  experience_level: ExperienceLevel | "";
  years_experience: string;
  linkedin_url: string;
  portfolio_url: string;
  work_authorization: WorkAuthorization | "";
  remote_preference: RemotePreference | "";
  salary_expectation: string;
  cover_letter_tone: CoverLetterTone | "";
};

const EMPTY_WORK_ENTRY: WorkExperienceEntry = {
  company: "",
  title: "",
  startDate: "",
  endDate: null,
  current: false,
  responsibilities: "",
};

const EMPTY_EDUCATION: Education = {
  degree: null,
  fieldOfStudy: null,
  institution: null,
  graduationYear: null,
};

// Shared input class used throughout this form
const inputCls =
  "w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent";

// ---------------------------------------------------------------------------
// TagInput — declared at module level to avoid React re-creating it on render
// ---------------------------------------------------------------------------
function TagInput({
  label,
  items,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  onKeyDown,
  placeholder,
  optional,
}: {
  label: string;
  items: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (item: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-dark mb-1.5">
        {label}
        {optional && (
          <span className="text-text-muted font-normal ml-1">(Optional)</span>
        )}
      </label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {items.map((item) => (
            <span
              key={item}
              className="bg-accent-light text-accent text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                className="hover:text-accent-dark leading-none"
                aria-label={`Remove ${item}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={inputCls}
        />
        <button
          type="button"
          onClick={onAdd}
          className="bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors whitespace-nowrap"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ProfileForm({ profile, email }: Props) {
  // Scalar form state — initialised from real profile or empty defaults
  const [form, setForm] = useState<FormState>({
    full_name: profile?.full_name ?? "",
    phone: profile?.phone ?? "",
    location: profile?.location ?? "",
    current_title: profile?.current_title ?? "",
    experience_level: profile?.experience_level ?? "",
    years_experience: profile?.years_experience != null
      ? String(profile.years_experience)
      : "",
    linkedin_url: profile?.linkedin_url ?? "",
    portfolio_url: profile?.portfolio_url ?? "",
    work_authorization: profile?.work_authorization ?? "",
    remote_preference: profile?.remote_preference ?? "",
    salary_expectation: profile?.salary_expectation ?? "",
    cover_letter_tone: profile?.cover_letter_tone ?? "",
  });

  // Array states
  const [skills, setSkills] = useState<string[]>(profile?.skills ?? []);
  const [industries, setIndustries] = useState<string[]>(
    profile?.industries ?? []
  );
  const [jobTitlesSeeking, setJobTitlesSeeking] = useState<string[]>(
    profile?.job_titles_seeking ?? []
  );
  const [preferredLocations, setPreferredLocations] = useState<string[]>(
    profile?.preferred_locations ?? []
  );

  // Complex object states
  const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>(
    profile?.work_experience ?? []
  );
  const [education, setEducation] = useState<Education>(
    profile?.education ?? EMPTY_EDUCATION
  );

  // Boolean flags from profile
  const [linkedinConnected] = useState(profile?.linkedin_connected ?? false);
  const [isTailored] = useState(profile?.is_tailored ?? false);

  // Tag input cursor states
  const [skillInput, setSkillInput] = useState("");
  const [industryInput, setIndustryInput] = useState("");
  const [jobTitleInput, setJobTitleInput] = useState("");
  const [locationInput, setLocationInput] = useState("");

  // Resume upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(
    profile?.resume_pdf_filename ?? (profile?.resume_pdf_key ? "resume.pdf" : null)
  );
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  // Save state
  const [saveResult, setSaveResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  // Pending states
  const [isSaving, startSave] = useTransition();
  const [isUploading, startUpload] = useTransition();
  const [isViewingResume, startViewResume] = useTransition();
  const [isExtracting, startExtract] = useTransition();
  const [isGenerating, startGenerate] = useTransition();

  // Extraction feedback
  const [extractResult, setExtractResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  // Generation feedback
  const [generateResult, setGenerateResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Derived values — single source of truth via calculateCompletion
  // ---------------------------------------------------------------------------
  const { percentage: completionPercentage, missingFields } = useMemo(
    () =>
      calculateCompletion({
        full_name: form.full_name,
        email,
        phone: form.phone,
        location: form.location,
        current_title: form.current_title,
        experience_level: form.experience_level || null,
        years_experience: form.years_experience,
        skills,
        work_experience: workExperience,
        education,
      }),
    [form, email, skills, workExperience, education]
  );

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Tag input — generic factory used for all four tag arrays
  function makeTagHandlers(
    items: string[],
    setItems: React.Dispatch<React.SetStateAction<string[]>>,
    input: string,
    setInput: React.Dispatch<React.SetStateAction<string>>
  ) {
    const add = () => {
      const trimmed = input.trim();
      if (trimmed && !items.includes(trimmed)) {
        setItems([...items, trimmed]);
        setInput("");
      }
    };
    const remove = (item: string) =>
      setItems(items.filter((i) => i !== item));
    const onKey = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        add();
      }
    };
    return { add, remove, onKey };
  }

  const skillHandlers = makeTagHandlers(
    skills,
    setSkills,
    skillInput,
    setSkillInput
  );
  const industryHandlers = makeTagHandlers(
    industries,
    setIndustries,
    industryInput,
    setIndustryInput
  );
  const jobTitleHandlers = makeTagHandlers(
    jobTitlesSeeking,
    setJobTitlesSeeking,
    jobTitleInput,
    setJobTitleInput
  );
  const locationHandlers = makeTagHandlers(
    preferredLocations,
    setPreferredLocations,
    locationInput,
    setLocationInput
  );

  function addWorkEntry() {
    if (workExperience.length < 3) {
      setWorkExperience([...workExperience, { ...EMPTY_WORK_ENTRY }]);
    }
  }

  function updateWorkEntry(
    index: number,
    updates: Partial<WorkExperienceEntry>
  ) {
    setWorkExperience((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, ...updates } : entry))
    );
  }

  function removeWorkEntry(index: number) {
    setWorkExperience((prev) => prev.filter((_, i) => i !== index));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadResult(null);
    startUpload(async () => {
      const fd = new FormData();
      fd.append("resume", file);
      const result = await uploadResume(fd);
      setUploadResult(result);
      if (result.success) {
        setResumeFileName(result.filename ?? file.name);
      }
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleViewResume() {
    startViewResume(async () => {
      const result = await getResumeSignedUrl();
      if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
    });
  }

  function applyExtraction(data: ProfileExtraction) {
    setForm((prev) => ({
      ...prev,
      ...(data.full_name != null && { full_name: data.full_name }),
      ...(data.phone != null && { phone: data.phone }),
      ...(data.location != null && { location: data.location }),
      ...(data.current_title != null && { current_title: data.current_title }),
      ...(data.experience_level != null && {
        experience_level: data.experience_level,
      }),
      ...(data.years_experience != null && {
        years_experience: String(data.years_experience),
      }),
      ...(data.linkedin_url != null && { linkedin_url: data.linkedin_url }),
      ...(data.portfolio_url != null && { portfolio_url: data.portfolio_url }),
      ...(data.work_authorization != null && {
        work_authorization: data.work_authorization,
      }),
      ...(data.remote_preference != null && {
        remote_preference: data.remote_preference,
      }),
      ...(data.salary_expectation != null && {
        salary_expectation: data.salary_expectation,
      }),
    }));
    if (data.skills?.length) setSkills(data.skills);
    if (data.industries?.length) setIndustries(data.industries);
    if (data.job_titles_seeking?.length)
      setJobTitlesSeeking(data.job_titles_seeking);
    if (data.work_experience?.length) setWorkExperience(data.work_experience);
    if (data.education?.degree) setEducation(data.education);
  }

  function handleExtract() {
    setExtractResult(null);
    startExtract(async () => {
      const res = await fetch("/api/profile/extract", { method: "POST" });
      const result = (await res.json()) as
        | { success: true; data: ProfileExtraction }
        | { success: false; error: string };
      if (!result.success) {
        setExtractResult({ success: false, error: result.error });
        return;
      }
      applyExtraction(result.data);
      setExtractResult({ success: true });
    });
  }

  function handleGenerate() {
    setGenerateResult(null);
    startGenerate(async () => {
      const res = await fetch("/api/resume/generate", { method: "POST" });
      const result = (await res.json()) as
        | { success: true }
        | { success: false; error: string };
      if (!result.success) {
        setGenerateResult({ success: false, error: result.error });
        return;
      }
      setResumeFileName("AI Generated Resume.pdf");
      setGenerateResult({ success: true });
    });
  }

  function handleSave() {
    setSaveResult(null);
    startSave(async () => {
      const result = await saveProfile({
        full_name: form.full_name,
        phone: form.phone,
        location: form.location,
        current_title: form.current_title,
        experience_level: form.experience_level,
        years_experience: form.years_experience,
        linkedin_url: form.linkedin_url,
        portfolio_url: form.portfolio_url,
        work_authorization: form.work_authorization,
        remote_preference: form.remote_preference,
        salary_expectation: form.salary_expectation,
        cover_letter_tone: form.cover_letter_tone,
        skills,
        industries,
        job_titles_seeking: jobTitlesSeeking,
        preferred_locations: preferredLocations,
        work_experience: workExperience,
        education,
        linkedin_connected: linkedinConnected,
        is_tailored: isTailored,
      });
      setSaveResult(result);
    });
  }

  // ---------------------------------------------------------------------------
  // SVG ring values
  // ---------------------------------------------------------------------------
  const ringRadius = 40;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - completionPercentage / 100);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-[800px] mx-auto py-8 px-6 space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* Card 1 — Profile completion banner (always visible)                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            {missingFields.length === 0 ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle
                    size={18}
                    className="text-success flex-shrink-0"
                  />
                  <h2 className="text-base font-semibold text-text-primary">
                    Profile complete
                  </h2>
                </div>
                <p className="text-sm text-text-secondary">
                  Your profile is fully filled out. You&apos;re ready to find
                  great matches.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle
                    size={18}
                    className="text-warning flex-shrink-0"
                  />
                  <h2 className="text-base font-semibold text-text-primary">
                    Profile needs attention
                  </h2>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  Complete the following fields to improve your chances of
                  getting quality resumes.
                </p>
                <div className="flex flex-wrap gap-2">
                  {missingFields.map((field) => (
                    <span
                      key={field}
                      className="bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full"
                    >
                      {field}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* SVG donut ring — always rendered */}
          <div className="relative w-[100px] h-[100px] flex-shrink-0">
            <svg
              width="100"
              height="100"
              viewBox="0 0 100 100"
              aria-label={`Profile ${completionPercentage}% complete`}
            >
              {/* Track */}
              <circle
                cx="50"
                cy="50"
                r={ringRadius}
                fill="none"
                strokeWidth="8"
                style={{ stroke: "var(--color-border)" }}
              />
              {/* Progress arc */}
              <circle
                cx="50"
                cy="50"
                r={ringRadius}
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                style={{
                  stroke: "var(--color-accent)",
                  transform: "rotate(-90deg)",
                  transformOrigin: "center",
                  transition: "stroke-dashoffset 0.4s ease",
                }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-semibold text-text-primary">
                {completionPercentage}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Card 2 — Connected Accounts                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <h2 className="text-base font-semibold text-text-primary mb-1">
          Connected Accounts
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          Connect your LinkedIn to let the agent handle manual apply with
          LinkedIn workflows.
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-linkedin flex items-center justify-center flex-shrink-0">
              <span className="text-linkedin-foreground text-sm font-bold">
                in
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">LinkedIn</p>
              <p className="text-xs text-text-muted">
                {linkedinConnected ? "Connected" : "Not connected"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors"
          >
            {linkedinConnected ? "Disconnect" : "Connect LinkedIn"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Card 3 — Resume                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <h2 className="text-base font-semibold text-text-primary mb-1">
          Resume
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          Upload an existing resume to auto-fill the profile, or generate a new
          tailored one from your details below.
        </p>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          aria-label="Upload resume PDF"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Upload zone */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-2 bg-surface-secondary mb-4 hover:border-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <>
              <Upload size={28} className="text-accent animate-pulse" />
              <p className="text-sm font-medium text-text-dark">Uploading...</p>
            </>
          ) : resumeFileName ? (
            <>
              <CheckCircle size={28} className="text-success" />
              <p className="text-sm font-medium text-text-dark">
                {resumeFileName}
              </p>
              <p className="text-xs text-text-muted">Click to replace</p>
            </>
          ) : (
            <>
              <Upload size={28} className="text-text-muted" />
              <p className="text-sm font-medium text-text-dark">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-text-muted">
                PDF formatting only • Maximum file size 5MB
              </p>
            </>
          )}
        </button>

        {uploadResult && !uploadResult.success && (
          <p className="text-sm text-error mb-4">{uploadResult.error}</p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-60"
            >
              {resumeFileName ? "Replace Resume" : "Select Resume"}
            </button>
            {resumeFileName && (
              <button
                type="button"
                onClick={handleViewResume}
                disabled={isViewingResume}
                className="text-sm text-accent underline-offset-2 hover:underline disabled:opacity-50 transition-opacity"
              >
                {isViewingResume ? "Opening..." : "View current resume"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted">
              Need a fresh document based on the fields below?
            </span>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!profile?.is_complete || isGenerating}
              title={!profile?.is_complete ? "Complete your profile first." : undefined}
              className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? "Generating..." : "Generate Resume from Profile"}
            </button>
          </div>
          {generateResult?.success && (
            <p className="text-sm text-success mt-2">
              Resume generated — click &ldquo;View current resume&rdquo; to open it.
            </p>
          )}
          {generateResult && !generateResult.success && (
            <p className="text-sm text-error mt-2">{generateResult.error}</p>
          )}
        </div>

        {resumeFileName && (
          <div className="mt-4 pt-4 border-t border-border">
            {extractResult?.success && (
              <p className="text-sm text-success mb-3">
                Profile filled in from your resume — review the fields below
                and save when ready.
              </p>
            )}
            {extractResult && !extractResult.success && (
              <p className="text-sm text-error mb-3">{extractResult.error}</p>
            )}
            <button
              type="button"
              onClick={handleExtract}
              disabled={isExtracting}
              className="bg-accent text-white text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors disabled:opacity-60"
            >
              {isExtracting ? "Extracting..." : "Extract from Resume"}
            </button>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Card 4 — Profile Information form                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <h2 className="text-base font-semibold text-text-primary mb-1">
          Profile Information
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          This context is used to accurately represent you in agent interactions.
        </p>

        <div className="space-y-8">
          {/* ---- Personal Info ------------------------------------------ */}
          <section>
            <h3 className="text-sm font-semibold text-text-dark mb-4">
              Personal Info
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={form.full_name}
                    onChange={(e) => setField("full_name", e.target.value)}
                    placeholder="Your full name"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    aria-label="Email address"
                    className="w-full bg-surface-secondary border border-border rounded-md px-3 py-2 text-sm text-text-muted cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                    placeholder="(555) 000-0000"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Location
                  </label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) => setField("location", e.target.value)}
                    placeholder="City, Country"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    LinkedIn URL
                    <span className="text-text-muted font-normal ml-1">
                      (Optional)
                    </span>
                  </label>
                  <input
                    type="url"
                    value={form.linkedin_url}
                    onChange={(e) => setField("linkedin_url", e.target.value)}
                    placeholder="https://linkedin.com/in/yourname"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Portfolio / GitHub
                    <span className="text-text-muted font-normal ml-1">
                      (Optional)
                    </span>
                  </label>
                  <input
                    type="url"
                    value={form.portfolio_url}
                    onChange={(e) => setField("portfolio_url", e.target.value)}
                    placeholder="https://github.com/yourname"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-dark mb-1.5">
                  Work Authorization
                </label>
                <select
                  aria-label="Work Authorization"
                  value={form.work_authorization}
                  onChange={(e) =>
                    setField(
                      "work_authorization",
                      e.target.value as WorkAuthorization | ""
                    )
                  }
                  className={inputCls}
                >
                  <option value="">Select...</option>
                  <option value="citizen">Citizen</option>
                  <option value="permanent_resident">Permanent Resident</option>
                  <option value="visa_required">Visa Required</option>
                </select>
              </div>
            </div>
          </section>

          <hr className="border-border" />

          {/* ---- Professional Info -------------------------------------- */}
          <section>
            <h3 className="text-sm font-semibold text-text-dark mb-4">
              Professional Info
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-dark mb-1.5">
                  Current / Recent Job Title
                </label>
                <input
                  type="text"
                  value={form.current_title}
                  onChange={(e) => setField("current_title", e.target.value)}
                  placeholder="Frontend Engineer"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Experience Level
                  </label>
                  <select
                    aria-label="Experience Level"
                    title="Experience Level"
                    value={form.experience_level}
                    onChange={(e) =>
                      setField(
                        "experience_level",
                        e.target.value as ExperienceLevel | ""
                      )
                    }
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    <option value="junior">Junior</option>
                    <option value="mid">Mid</option>
                    <option value="senior">Senior</option>
                    <option value="lead">Lead</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Years of Experience
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={form.years_experience}
                    onChange={(e) =>
                      setField("years_experience", e.target.value)
                    }
                    placeholder="4"
                    className={inputCls}
                  />
                </div>
              </div>

              <TagInput
                label="Skills"
                items={skills}
                inputValue={skillInput}
                onInputChange={setSkillInput}
                onAdd={skillHandlers.add}
                onRemove={skillHandlers.remove}
                onKeyDown={skillHandlers.onKey}
                placeholder="e.g. React"
              />

              <TagInput
                label="Industries"
                items={industries}
                inputValue={industryInput}
                onInputChange={setIndustryInput}
                onAdd={industryHandlers.add}
                onRemove={industryHandlers.remove}
                onKeyDown={industryHandlers.onKey}
                placeholder="e.g. FinTech, Healthcare"
                optional
              />
            </div>
          </section>

          <hr className="border-border" />

          {/* ---- Work Experience ---------------------------------------- */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-dark">
                Work Experience
              </h3>
            </div>

            <div className="space-y-6">
              {workExperience.map((entry, index) => (
                <div
                  key={index}
                  className="border border-border rounded-xl p-4 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                      Role {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeWorkEntry(index)}
                      className="text-xs text-text-muted hover:text-error transition-colors"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-text-dark mb-1.5">
                        Company Name
                      </label>
                      <input
                        type="text"
                        value={entry.company}
                        onChange={(e) =>
                          updateWorkEntry(index, { company: e.target.value })
                        }
                        placeholder="Company name"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-dark mb-1.5">
                        Job Title
                      </label>
                      <input
                        type="text"
                        value={entry.title}
                        onChange={(e) =>
                          updateWorkEntry(index, { title: e.target.value })
                        }
                        placeholder="Frontend Engineer"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-text-dark mb-1.5">
                        Start Date
                      </label>
                      <input
                        type="text"
                        value={entry.startDate}
                        onChange={(e) =>
                          updateWorkEntry(index, { startDate: e.target.value })
                        }
                        placeholder="January 2022"
                        className={inputCls}
                      />
                    </div>
                    {!entry.current && (
                      <div>
                        <label className="block text-sm font-medium text-text-dark mb-1.5">
                          End Date
                        </label>
                        <input
                          type="text"
                          value={entry.endDate ?? ""}
                          onChange={(e) =>
                            updateWorkEntry(index, {
                              endDate: e.target.value || null,
                            })
                          }
                          placeholder="December 2023"
                          className={inputCls}
                        />
                      </div>
                    )}
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={entry.current}
                      onChange={(e) =>
                        updateWorkEntry(index, {
                          current: e.target.checked,
                          endDate: e.target.checked ? null : entry.endDate,
                        })
                      }
                      className="rounded border-border accent-accent"
                    />
                    <span className="text-sm text-text-secondary">
                      Currently working here
                    </span>
                  </label>

                  <div>
                    <label className="block text-sm font-medium text-text-dark mb-1.5">
                      Key Responsibilities
                    </label>
                    <textarea
                      value={entry.responsibilities}
                      onChange={(e) =>
                        updateWorkEntry(index, {
                          responsibilities: e.target.value,
                        })
                      }
                      placeholder="Describe your key responsibilities and achievements..."
                      rows={3}
                      className={`${inputCls} resize-none`}
                    />
                  </div>
                </div>
              ))}

              {workExperience.length < 3 && (
                <button
                  type="button"
                  onClick={addWorkEntry}
                  className="flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-dark transition-colors"
                >
                  <Plus size={16} />
                  Add role
                </button>
              )}
            </div>
          </section>

          <hr className="border-border" />

          {/* ---- Education ---------------------------------------------- */}
          <section>
            <h3 className="text-sm font-semibold text-text-dark mb-4">
              Education
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Highest Degree
                  </label>
                  <select
                    aria-label="Highest Degree"
                    title="Highest Degree"
                    value={education.degree ?? ""}
                    onChange={(e) =>
                      setEducation((prev) => ({
                        ...prev,
                        degree: e.target.value || null,
                      }))
                    }
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    <option value="High School">High School</option>
                    <option value="Associate's">Associate&apos;s</option>
                    <option value="Bachelor's">Bachelor&apos;s</option>
                    <option value="Master's">Master&apos;s</option>
                    <option value="PhD">PhD</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Field of Study
                  </label>
                  <input
                    type="text"
                    value={education.fieldOfStudy ?? ""}
                    onChange={(e) =>
                      setEducation((prev) => ({
                        ...prev,
                        fieldOfStudy: e.target.value || null,
                      }))
                    }
                    placeholder="Computer Science"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Institution Name
                  </label>
                  <input
                    type="text"
                    value={education.institution ?? ""}
                    onChange={(e) =>
                      setEducation((prev) => ({
                        ...prev,
                        institution: e.target.value || null,
                      }))
                    }
                    placeholder="e.g. State University"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Graduation Year
                  </label>
                  <input
                    type="text"
                    value={education.graduationYear ?? ""}
                    onChange={(e) =>
                      setEducation((prev) => ({
                        ...prev,
                        graduationYear: e.target.value || null,
                      }))
                    }
                    placeholder="YYYY"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          </section>

          <hr className="border-border" />

          {/* ---- Job Preferences ---------------------------------------- */}
          <section>
            <h3 className="text-sm font-semibold text-text-dark mb-4">
              Job Preferences
            </h3>
            <div className="space-y-4">
              <TagInput
                label="Job Titles Seeking"
                items={jobTitlesSeeking}
                inputValue={jobTitleInput}
                onInputChange={setJobTitleInput}
                onAdd={jobTitleHandlers.add}
                onRemove={jobTitleHandlers.remove}
                onKeyDown={jobTitleHandlers.onKey}
                placeholder="Frontend Engineer, React Developer"
              />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Remote Preference
                  </label>
                  <select
                    aria-label="Remote Preference"
                    title="Remote Preference"
                    value={form.remote_preference}
                    onChange={(e) =>
                      setField(
                        "remote_preference",
                        e.target.value as RemotePreference | ""
                      )
                    }
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    <option value="remote">Remote</option>
                    <option value="onsite">On-site</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="any">Any</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-1.5">
                    Salary Expectation
                    <span className="text-text-muted font-normal ml-1">
                      (Optional)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={form.salary_expectation}
                    onChange={(e) =>
                      setField("salary_expectation", e.target.value)
                    }
                    placeholder="e.g. $120k+"
                    className={inputCls}
                  />
                </div>
              </div>

              <TagInput
                label="Preferred Locations"
                items={preferredLocations}
                inputValue={locationInput}
                onInputChange={setLocationInput}
                onAdd={locationHandlers.add}
                onRemove={locationHandlers.remove}
                onKeyDown={locationHandlers.onKey}
                placeholder="e.g. New York, London"
                optional
              />

              <div>
                <label className="block text-sm font-medium text-text-dark mb-1.5">
                  Cover Letter Tone
                </label>
                <select
                  aria-label="Cover Letter Tone"
                  title="Cover Letter Tone"
                  value={form.cover_letter_tone}
                  onChange={(e) =>
                    setField(
                      "cover_letter_tone",
                      e.target.value as CoverLetterTone | ""
                    )
                  }
                  className={inputCls}
                >
                  <option value="">Select...</option>
                  <option value="formal">Formal</option>
                  <option value="casual">Casual</option>
                  <option value="enthusiastic">Enthusiastic</option>
                </select>
              </div>
            </div>
          </section>
        </div>

        {/* Save button */}
        <div className="mt-8 space-y-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="w-full bg-accent text-accent-foreground font-medium rounded-md px-4 py-2.5 text-sm hover:bg-accent-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving..." : "Save Profile"}
          </button>

          {saveResult && (
            <p
              className={`text-sm text-center ${
                saveResult.success ? "text-success" : "text-error"
              }`}
            >
              {saveResult.success
                ? "Profile saved successfully"
                : saveResult.error ?? "Failed to save profile"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
