# AI Discussion Topics — Recover

## Failure Mode Recognition

1. Why did the first stale-table bug fit Failure Mode 1, while the later query-mismatch bug started to look like Failure Mode 3?
2. What signs showed that the UI and actor were failing in different ways, even though the user experienced both as "search is wrong"?
3. How could repeated prompting have made this worse if the actor URL contract had not been rechecked?

## Feedback Loops

4. Why was a component/API seam test enough for the stale-table bug but not enough for query relevance?
5. What made the live Apify actor run a better repro than local Playwright for the JobsDB URL problem?
6. Why is "the actor returned 10 jobs" not a sufficient success signal for a scraper?

## Root Cause Boundaries

7. Why should `/api/agent/find` return current display rows even when no new rows are inserted?
8. What breaks when a route response uses newly inserted DB rows as the only UI display contract?
9. Why was the query-parameter URL bug a foundation problem rather than a selector bug?

## Future Prevention

10. What kind of live canary query would catch JobsDB search relevance regressions early?
11. Should scraper output include debug metadata such as the resolved search URL and final page URL?
12. Should JobPilot filter or warn when actor results have low lexical relevance to the typed query?
