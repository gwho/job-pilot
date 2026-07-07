# AI Discussion Topics — Blocked Actor Error Fix

## Concepts to explore

1. **Why is "SUCCEEDED with empty dataset" a valid Apify run state, and when should you distinguish it from "SUCCEEDED with zero genuine results"?**
   Ask: What other anti-bot countermeasures besides 403 can cause an actor to silently produce empty results?

2. **What does "monotonic accumulation" mean in a paginated loop, and why does it matter for correctness?**
   Ask: Can you think of other data structures or algorithms that rely on a monotonic invariant for correctness?

3. **The `classifySearchPage` function returns one of four outcomes. Why not return a boolean `isBlocked`?**
   Ask: What would a caller lose if the function returned only `isBlocked: boolean` instead of the four-variant enum?

4. **Why is `Actor.fail(message)` better than `throw new Error()` or `process.exit(1)` for signalling actor failure?**
   Ask: How does Apify's run lifecycle model differ from a typical Node.js process exit?

5. **The partial-block test requires that calls 1–2 produce fewer fresh results than `TARGET_NEW` so the loop continues to call 3. Why is this important for the test to be realistic?**
   Ask: What would happen to the test if call 1 returned 10+ new jobs and `freshCount >= TARGET_NEW` caused the loop to break before call 3?

6. **The UI `catch` block was silent for a long time without being caught by tests. What kind of test seam would have caught this earlier?**
   Ask: How would you write a test that specifically exercises the fetch-rejection path (as opposed to a non-ok HTTP response)?

7. **"Suspicious empty" is the default classification when no positive evidence of a real no-results page exists. Is this too aggressive? When might it produce false positives?**
   Ask: What real-world queries would cause a false positive (genuine empty search treated as suspicious)?
