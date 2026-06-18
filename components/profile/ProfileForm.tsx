"use client";

import { useState, useMemo } from "react";
import { AlertCircle, CheckCircle, Upload, Plus, X } from "lucide-react";

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
// Mock data — typed as Profile so TypeScript catches any shape drift at
// declaration time. All fields present; nullable fields explicitly null.
// Feature 06 replaces this with a real Profile fetched server-side.
// ---------------------------------------------------------------------------
const mockProfile: Profile = {
  id: "mock-user-id",
  full_name: "Taryn Ali",
  email: "taryn@example.com",
  phone: "(555) 300-0000",
  location: "San Francisco, CA",
  current_title: "Frontend Engineer",
  experience_level: "junior",
  years_experience: 4,
  skills: ["React", "TypeScript", "Next.js", "Tailwind CSS"],
  industries: ["FinTech", "Healthcare"],
  work_experience: [
    {
      company: "Vercel",
      title: "Frontend Engineer",
      startDate: "January 2023",
      endDate: null,
      current: true,
      responsibilities:
        "Built Next.js features and optimized web vitals. Led a team of 3 developers.",
    },
  ],
  education: {
    degree: "High School",
    fieldOfStudy: "Computer Science",
    institution: null,
    graduationYear: null,
  },
  job_titles_seeking: ["Frontend Engineer", "React Developer"],
  remote_preference: "any",
  preferred_locations: [],
  salary_expectation: null,
  cover_letter_tone: null,
  linkedin_url: "https://linkedin.com/in/taryan",
  portfolio_url: "https://github.com/taryanali",
  work_authorization: "citizen",
  resume_pdf_url: null,
  is_complete: false,
  created_at: "2026-06-18T00:00:00Z",
  updated_at: "2026-06-18T00:00:00Z",
};

// ---------------------------------------------------------------------------
// FormState — explicit type required for the setField generic helper.
// Dropdown enum fields widen to include '' (empty string) because a controlled
// <select> needs a string value for "no selection" — null cannot be used as
// the value prop on an HTML element.
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
export function ProfileForm() {
  // Scalar form state
  const [form, setForm] = useState<FormState>({
    full_name: mockProfile.full_name ?? "",
    phone: mockProfile.phone ?? "",
    location: mockProfile.location ?? "",
    current_title: mockProfile.current_title ?? "",
    experience_level: mockProfile.experience_level ?? "",
    years_experience: String(mockProfile.years_experience ?? ""),
    linkedin_url: mockProfile.linkedin_url ?? "",
    portfolio_url: mockProfile.portfolio_url ?? "",
    work_authorization: mockProfile.work_authorization ?? "",
    remote_preference: mockProfile.remote_preference ?? "",
    salary_expectation: mockProfile.salary_expectation ?? "",
    cover_letter_tone: mockProfile.cover_letter_tone ?? "",
  });

  // Array states
  const [skills, setSkills] = useState<string[]>(mockProfile.skills ?? []);
  const [industries, setIndustries] = useState<string[]>(
    mockProfile.industries ?? []
  );
  const [jobTitlesSeeking, setJobTitlesSeeking] = useState<string[]>(
    mockProfile.job_titles_seeking ?? []
  );
  const [preferredLocations, setPreferredLocations] = useState<string[]>(
    mockProfile.preferred_locations ?? []
  );

  // Complex object states
  const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>(
    mockProfile.work_experience ?? []
  );
  const [education, setEducation] = useState<Education>(
    mockProfile.education ?? {
      degree: null,
      fieldOfStudy: null,
      institution: null,
      graduationYear: null,
    }
  );

  // Tag input cursor states
  const [skillInput, setSkillInput] = useState("");
  const [industryInput, setIndustryInput] = useState("");
  const [jobTitleInput, setJobTitleInput] = useState("");
  const [locationInput, setLocationInput] = useState("");

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const completionPercentage = useMemo(() => {
    const checks = [
      form.full_name.trim() !== "",
      (mockProfile.email ?? "").trim() !== "",
      form.phone.trim() !== "",
      form.location.trim() !== "",
      form.current_title.trim() !== "",
      form.experience_level !== "",
      form.years_experience !== "" && Number(form.years_experience) > 0,
      skills.length > 0,
      workExperience.length > 0,
      education.degree !== null && education.degree !== "",
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form, skills, workExperience, education]);

  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (!form.full_name.trim()) missing.push("FULL NAME");
    if (!(mockProfile.email ?? "").trim()) missing.push("EMAIL");
    if (!form.phone.trim()) missing.push("PHONE");
    if (!form.location.trim()) missing.push("LOCATION");
    if (!form.current_title.trim()) missing.push("CURRENT TITLE");
    if (!form.experience_level) missing.push("EXPERIENCE LEVEL");
    if (!form.years_experience || Number(form.years_experience) <= 0)
      missing.push("YEARS EXP");
    if (skills.length === 0) missing.push("SKILLS");
    if (workExperience.length === 0) missing.push("WORK EXPERIENCE");
    if (!education.degree) missing.push("EDUCATION");
    return missing;
  }, [form, skills, workExperience, education]);

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
              <p className="text-xs text-text-muted">Not connected</p>
            </div>
          </div>
          <button
            type="button"
            className="bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors"
          >
            Connect LinkedIn
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

        {/* Upload zone */}
        <div className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-2 bg-surface-secondary mb-4">
          <Upload size={28} className="text-text-muted" />
          <p className="text-sm font-medium text-text-dark">
            Click to upload or drag and drop
          </p>
          <p className="text-xs text-text-muted">
            PDF formatting only • Maximum file size 5MB
          </p>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            className="bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors"
          >
            Select Resume
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted">
              Need a fresh document based on the fields below?
            </span>
            <button
              type="button"
              className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Generate Resume from Profile
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Card 3 — Profile Information form                                   */}
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
                    value={mockProfile.email ?? ""}
                    disabled
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

        {/* Save button — inert in Feature 05, wired in Feature 06 */}
        <div className="mt-8">
          <button
            type="button"
            className="w-full bg-accent text-accent-foreground font-medium rounded-md px-4 py-2.5 text-sm hover:bg-accent-dark transition-colors"
          >
            Save Profile
          </button>
        </div>
      </div>
    </div>
  );
}
