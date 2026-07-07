# AI Discussion Topics — Actor Diagnostics Improvements

## Group 1: Outcome type precision

1. **`"suspicious-empty"` and `"blocked-http"` both trigger `Actor.fail()`. If both lead to the same outcome (failed run), why does it matter that they're distinct types?**
   Ask: what would a future engineer see in the Apify console that would be different between a `blocked-http` run and a `suspicious-empty` run? What actions would they take differently for each?

2. **The `SearchOutcome` type is a string union (`"ok" | "login-redirect" | "legit-empty" | "suspicious-empty" | "blocked-http"`). What would you lose if you replaced it with a boolean `isBlocked` flag? What would a future `classifySearchPage` caller lose access to?**
   Ask: give a concrete example of a behaviour you could only implement with the full union, not a boolean.

3. **`"blocked-http"` is only ever assigned in `failedRequestHandler`. `"suspicious-empty"` is only ever returned from `extractCardLinks`. Why is it important that these two failure modes are detected at different layers of the code?**
   Ask: what does it tell you about the failure mode that the page loaded vs. that it never loaded?

4. **The `shouldFailRun` function now returns true for three outcomes: `"suspicious-empty"`, `"login-redirect"`, and `"blocked-http"`. Why does it still return `false` for `"legit-empty"` even though the actor also pushes 0 jobs in that case?**
   Ask: what user action should happen after a "legit empty" result vs. after a "blocked" result?

---

## Group 2: Race-based DOM waiting

5. **The original code waited 15 seconds for a job card, scrolled, waited 800ms, then checked the empty-state selector with no wait. What is the name for the class of bug this creates, and how common is it in browser automation?**
   Ask: how does React hydration cause this bug? When does the empty-state element render relative to the initial page load?

6. **`Promise.race([...]).catch(() => {})` discards the rejection. Why is it safe to discard here? What would go wrong if you removed the `.catch()` and let the rejection propagate?**
   Ask: what is `Promise.race`'s behaviour when one promise rejects? Does it cancel the other promises?

7. **The race includes both `waitForSelector('[data-testid="job-card"]')` and `waitForURL('**/login**')`. Why not use `page.waitForNavigation()` for the login case?**
   Ask: what is the difference between `waitForURL` and `waitForNavigation`? When would a SPA's login redirect NOT trigger a navigation event?

8. **After the race, the code still does a `page.$$('[data-testid="job-card"]')` count check before deciding to scroll. If the race resolved because `waitForSelector('[data-testid="job-card"]')` fired, why isn't that count guaranteed to be > 0?**
   Ask: can a `waitForSelector` resolve just before the element is removed from the DOM? What would cause that?

---

## Group 3: Diagnostics design

9. **The diagnostic log line is structured as key=value pairs: `url=... | title="..." | emptyState=... | login=... | block=...`. Why key=value instead of a JSON object or free-form message?**
   Ask: how would you write a regex or grep pattern to find all `suspicious-empty` runs in a log file? What does structured logging enable that free-form logging doesn't?

10. **The screenshot is saved to `diagnostics/${runId}/suspicious-empty.png`. Why include `runId` in the key? What problem would occur if you just used `diagnostics/suspicious-empty.png`?**
    Ask: how many Apify actor runs share the same key-value store? What happens to a KV store key when you call `setValue` on it twice?

11. **The captcha check uses four selectors: `[data-testid="captcha"], [id*="captcha"], [class*="captcha"], [id*="challenge"]`. Why use four selectors instead of one? What kind of anti-bot system would use `[id*="challenge"]`?**
    Ask: what is the difference between an attribute equality selector (`[id="captcha"]`) and a substring selector (`[id*="captcha"]`) in CSS? When would you prefer one over the other for scraping?

12. **The screenshot is only taken on `"suspicious-empty"`, not on `"login-redirect"` or `"blocked-http"`. Why not capture all three?**
    Ask: what does the page look like when Crawlee reports an HTTP 403? Is there a rendered page to screenshot?

---

## Group 4: Security and logging

13. **The session logging rule is: cookie count + store ID only. No names, values, or domains. Why is a cookie's domain name considered sensitive in this context?**
    Ask: if you knew the domain of a session cookie that authenticated a real user's JobsDB session, what could you do with that information? Why is "just the domain" not safe to log?

14. **The session file is stored in Apify's KV store under the key `JOBSDB_SESSION`. The key name is visible in actor logs and actor configuration. Is that a security concern? What is the difference between a key name and a key value in terms of sensitivity?**
    Ask: what principle of least privilege would you apply to who can read the KV store that contains this session?

15. **The existing warning log when no session is found says: `JOBSDB_SESSION not found in KV store — proceeding without auth.` This reveals the exact KV key name. Is that a security concern? Why or why not?**
    Ask: compare this to how UNIX tools handle missing files — they often print the filename. What is the threat model difference between a UNIX error message and an Apify actor log?

---

## Group 5: TypeScript narrowing edge cases

16. **TypeScript reported `error TS2367: the types '"ok"' and '"blocked-http"' have no overlap` for the comparison `page1Outcome === "blocked-http"` inside `if (shouldFailRun(...))`. The fix was `(page1Outcome as SearchOutcome) === "blocked-http"`. Why does adding `as SearchOutcome` fix it if the variable was already declared as `SearchOutcome`?**
    Ask: what is TypeScript CFA (control flow analysis) narrowing? Under what circumstances does TypeScript narrow a variable's type inside an `if` block?

17. **The `shouldFailRun` function does not have a type predicate (an `is` clause). If it did — e.g., `page1Outcome is "suspicious-empty" | "login-redirect" | "blocked-http"` — would the `as SearchOutcome` cast still be needed? What would happen instead?**
    Ask: write the type predicate signature for `shouldFailRun`. What would TypeScript do with `page1Outcome` inside the `if (shouldFailRun(...))` block?

18. **Why did the pre-existing `scoreJobs` mock type error and the `InsForgeClient` cast error not cause the tests to fail even though `npx tsc --noEmit` reports them?**
    Ask: what is the difference between type checking and test execution? Does Vitest run TypeScript type checking before running tests?
