# AI Discussion Topics — Find Jobs Repeated-Search Bug

## Group 1: The Feedback Loop

1. Why is a red-capable test the first step in the diagnosing-bugs methodology, even
   before reading the code? What failure mode does skipping it produce?

2. The test was written at the *route handler* seam rather than the frontend or the
   actor layer. What made the route handler the correct seam for this bug?

3. How do you decide whether to test at the unit, integration, or end-to-end level
   when diagnosing a bug? What information helps you make that call?

4. This test runs in ~10ms with everything mocked. What's the trade-off: what does
   the fast mocked test verify that a real integration test wouldn't, and vice versa?

5. The test was written before reading the code to form a hypothesis. Why is this
   ordering important — what cognitive bias does it protect against?

---

## Group 2: The Apify Actor's Pagination Model

6. The Apify actor always starts crawling from page 1, even when called with
   `maxPages=3`. Why is this a constraint that can't easily be changed, given how
   the actor's internal dedup (`seenUrls`) works?

7. When you call the actor with `maxPages=2`, it returns pages 1+2 combined and
   deduplicated. This means the route re-fetches page 1 on every loop iteration.
   Is this wasteful? What would be the alternative design, and what would it cost?

8. The exhaustion signal is `allActorJobs.length < page * 10`. Why is this the
   right heuristic? What edge case does it miss, and does that edge case matter?

9. If JobsDB changes its page size from 10 to 20 results per page, which part of
   the system breaks first? How would you detect this in production?

---

## Group 3: The Fix's Control Flow

10. Why was `existingByUrl` moved before the actor loop rather than being queried
    inside each loop iteration? What is the cost of moving it, and what does it gain?

11. The loop exits when `freshCount >= TARGET_NEW`. But `freshCount` is computed from
    `allActorJobs` (cumulative pages 1..N). Could `freshCount` ever decrease between
    iterations? Why or why not?

12. `TARGET_NEW = 10` and `MAX_PAGES = 5` are now server-side constants. The original
    code accepted `maxPages` from the client. Why is removing client control the right
    move? When would you want the client to control this parameter?

13. The loop uses `break` when an error occurs, then checks `jobsDbError` after. Why
    not re-throw immediately inside the catch block? What does the two-phase error
    handling (catch + check after loop) give you?

---

## Group 4: Mocking Strategies

14. The DB mock uses per-table call counting (`callCounts["jobs"]`) rather than
    absolute call order. Why is this more resilient to code changes between the RED
    and GREEN states of the test?

15. The `createChain` helper adds a `then` property to make the chain directly
    awaitable. What is the JavaScript thenable protocol, and how does `await`
    use it differently from `Promise.resolve(x)`?

16. The test mocks `scoreJobs` to return scores with `matchScore: 50` (below the
    70 threshold). Why does this matter for simplifying the mock? What would break
    if `matchScore: 80` was used instead?

17. The test uses `vi.mocked(discoverJobsDbJobs).mockReset()` in `beforeEach`.
    Why `mockReset()` specifically, rather than `mockClear()` or `mockRestore()`?
    What does each one preserve or discard?

---

## Group 5: Diagnosing-Bugs Methodology

18. This bug's root cause was found by reading the code, not by instrumenting it.
    The diagnosing-bugs skill says not to read code before having a feedback loop.
    Why is that the rule, even in cases where the cause seems obvious?

19. The "all already saved" path (Path A in the route) is a valid success state —
    not an error. How do you distinguish between a legitimate "no new jobs" response
    and the bug? What made the test able to tell the difference?

20. After the fix, `totalFound` in the success message can now be 20 (pages 1+2)
    instead of 10 (page 1 only). Is this a correct change to surface to the user,
    or should it still say "10 jobs found"? What does "found" mean to the user?

21. The fix was described as "minimal change" — only the control flow changed, not
    the scoring, saving, or response shape. Why is minimalism the right principle
    for a bug fix, as opposed to also cleaning up related code while you're in there?
