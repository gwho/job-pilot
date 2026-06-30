# Fix Plan — Find Jobs Error Feedback

## Problem

When the `/api/agent/find` route returned any failure response (Apify actor timeout, session expiry, CAPTCHA, 500 error), `handleSearch` in `FindJobsClient.tsx` logged to console and returned early — without updating any visible UI state.

```typescript
// Before fix — components/find-jobs/FindJobsClient.tsx
if (!res.ok || !data.success) {
  console.error("[FindJobsClient] search failed:", data?.error);
  return;  // ← no banner, no state update
}
```

From the user's perspective:
- The "Find Jobs" button showed "Finding jobs…" for 30–60 seconds
- The button re-enabled (the `finally` block ran)
- The table was unchanged — same old jobs visible
- No banner appeared

This was indistinguishable from "search found nothing new." Users reasonably concluded "the search showed old results" when the actual cause was a silent failure.

## What was changed

**Three files touched:**

### 1. `components/find-jobs/FindJobsClient.tsx`

`SearchStatus` type gained `isError?: boolean`:

```typescript
type SearchStatus = {
  message: string;
  isError?: boolean;
};
```

Error path now sets the banner instead of silently returning:

```typescript
if (!res.ok || !data.success) {
  console.error("[FindJobsClient] search failed:", data?.error);
  setSearchStatus({
    message: (data?.error as string) ?? "Search failed. Please try again.",
    isError: true,
  });
  return;
}
```

### 2. `components/find-jobs/SearchControls.tsx`

`AlertCircle` icon imported. `SearchStatus` type updated to match. Banner JSX switches between success and error styling based on `isError`:

```tsx
{searchStatus && (
  <div
    className={`mt-4 flex items-center gap-2 text-sm rounded-md px-4 py-2 ${
      searchStatus.isError
        ? "bg-error/10 text-error"
        : "bg-success-lightest text-success-foreground"
    }`}
  >
    {searchStatus.isError ? <AlertCircle size={14} /> : <Sparkles size={14} />}
    {searchStatus.message}
  </div>
)}
```

### 3. `__tests__/find-jobs/seam.test.tsx`

Three new tests added (net: 7 → 10, all passing after fix):

```typescript
// RED before fix, GREEN after
it("shows error feedback when the API returns a failure — must not be silent")

// GREEN both before and after (documents correct existing behaviour)
it("clears the loading state after an API error so the button is re-enabled")
it("second search replaces first search results — keyword B rows replace keyword A rows")
```

## Why this fix

The banner is already the established feedback mechanism for search results. The `searchStatus` state slot is already rendered by `SearchControls` whenever it is non-null. Adding `isError?: boolean` to the existing type and branching the banner's className/icon is the minimal change that makes the existing mechanism handle both outcomes.

The alternative — separate `errorMessage` state and a separate banner element — would create two independent state slots that need to be cleared independently, with edge cases if both are set. One state slot with a discriminating field is simpler and has no edge cases.

## Tokens used

`bg-error/10 text-error` — both derived from `--color-error: #ef4444` defined in `app/globals.css`. The `/10` modifier applies 10% opacity to get a light-red background tint. No raw hex values or Tailwind palette classes used.
