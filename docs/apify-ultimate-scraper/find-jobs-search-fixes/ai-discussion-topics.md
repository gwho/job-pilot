# AI Discussion Topics — Apify Scraper

## Actor Runtime

1. Why did changing local actor code not immediately change JobPilot behavior?
2. What is the difference between the actor source directory and the deployed actor build?
3. Why did the session use the runtime SDK/live actor instead of only local Playwright?

## Search URL Contracts

4. Why can a URL with query parameters return a valid page but ignore search intent?
5. What makes SEO-path search URLs easier to reason about for JobsDB?
6. What would break if JobsDB changes from SEO paths to a new search API?

## Scraper Verification

7. Why should scraper tests assert semantic relevance, not only item count?
8. How would you design a canary query that is stable enough for CI?
9. What debug metadata should be pushed with each dataset item to make future diagnosis faster?

## Deployment Process

10. Why did the session use `apify push -w 120` instead of the newer skill-recommended CLI flags?
11. What should be recorded after every actor deploy?
12. How can we detect that JobPilot is still calling an old actor build?
