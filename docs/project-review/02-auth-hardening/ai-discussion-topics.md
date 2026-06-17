# AI Discussion Topics — Auth Hardening

Use these prompts with an AI to go deeper on the concepts in this review.

---

## 1. Fail-safe vs fail-secure defaults

The proxy fix defaults to redirecting to `/login` when `updateSession()` throws — that's "fail secure" (deny access when uncertain). But `getCtaHref()` defaults to returning `"/login"` when `getCurrentUser()` throws — is that also "fail secure," or is it "fail safe" (preserve page availability at the cost of session awareness)?

**Ask:** "What is the difference between fail-safe and fail-secure in web application security? For a CTA button that resolves to /login or /dashboard, which default is more appropriate when the auth service is unavailable — and why? How does the answer change for a route protection gate vs a UI element?"

---

## 2. The `redirect()` exception pattern in Next.js

`redirect()` throws a `NEXT_REDIRECT` error. This breaks normal try/catch patterns in subtle ways.

**Ask:** "In Next.js 16 Server Actions, `redirect()` works by throwing a special error. What are the practical implications of this for error handling in Server Actions that need to both validate input (returning an error on failure) and redirect on success? How do you write a Server Action that catches real errors but doesn't swallow the redirect?"

---

## 3. `null` vs `undefined` in TypeScript strict mode

The `UpdateSessionResult` type returns `accessToken: string | null`, not `string | undefined`. Both are falsy, but TypeScript treats them differently.

**Ask:** "In TypeScript strict mode, what is the practical difference between a property typed as `string | undefined` versus `string | null`? When should an API use `null` vs `undefined` to signal 'no value,' and what are the consequences of getting it wrong in both the producing and consuming code?"

---

## 4. Error handling in Server Component rendering paths

`getCtaHref()` is called from multiple async Server Components that run on every page render.

**Ask:** "In Next.js App Router, what happens when an async Server Component throws an uncaught error? How does the error bubble up through the component tree, and what does the user see? What is the difference between an error in a root layout component vs a leaf component, and how should error boundaries be positioned to minimise visible failures?"

---

## 5. Why proxy/middleware infrastructure needs defensive coding more than pages

`proxy.ts` runs before any page rendering, on every matched request. This is different from a page or component.

**Ask:** "In a Next.js application using a proxy (equivalent of middleware), why is an uncaught error in the proxy function more severe than an uncaught error in a page component? What is the blast radius of each, and how does this affect how aggressively you should defend against errors in each location?"

---

## 6. The limits of manual testing for finding error-path bugs

The auth flow passed manual testing. The bugs found in this review were invisible to it.

**Ask:** "What categories of bugs are systematically invisible to happy-path manual testing in a web application? What techniques — code review, chaos engineering, error injection, type checking — are most effective at finding error-handling gaps, and what are the trade-offs between them for a small development team?"

---

## 7. Why documentation gaps in AI-generated codebases are especially dangerous

The `code-standards.md` gap (missing carve-out for redirect auth actions) was classified as a Minor issue but could cause a future AI agent to generate broken code.

**Ask:** "When an AI agent builds code across multiple sessions in a project that uses a CLAUDE.md and context documentation system, why are documentation gaps in those context files more dangerous than they would be in a human-maintained codebase? What makes AI agents more likely to follow documented patterns blindly compared to a human developer who might notice the pattern doesn't fit the situation?"
