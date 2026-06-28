# 0002 — TDD Red-Green Cycle

**Date:** 2026-06-29
**Tests:** `__tests__/find-jobs/utils.test.ts`

## Key insight

A test is a question with a known answer. The three parts of every test: a name (`it(...)`), a function call, and a check (`expect(...).toBe(...)`).

TDD's rule — write the test before the code — forces you to decide precisely what a function should do before worrying about how to implement it. The failing test is not a problem. It is the goal.

## Non-obvious nuance

Extracting pure functions to their own file (`lib/find-jobs-utils.ts`) is what makes TDD practical. Functions tangled inside React components cannot be tested in isolation. When a function is pure — it takes inputs and returns outputs, no side effects — it can always be extracted and tested.

## Common mistake to avoid

Writing tests after the code to get "coverage." This defeats the point. The value of TDD is that the test shapes the interface of the function. Writing tests after means the interface is already fixed and you are just checking it works — you lose the design benefit.

## What Feature 11 demonstrates

`mergeJobsById` was extracted from `setJobs(...)` specifically so it could be tested. The test at line 154 of utils.test.ts documents the exact bug that previously existed (replacing all jobs with only the latest batch). That test is now a permanent regression guard.
