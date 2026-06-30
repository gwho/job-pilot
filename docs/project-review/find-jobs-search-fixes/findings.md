# Findings — Find Jobs Search Fixes

## Finding 1: API response rows must match UI intent

The route originally treated inserted rows as display rows. That failed after dedupe.

The correct pattern is to keep these concepts separate:

- Persistence result: what changed in the database.
- Display result: what the user should see for this search.

This is especially important for idempotent actions. A repeat search can be successful even when it inserts nothing.

## Finding 2: Client copy should not reconstruct API semantics

The API already returned `successMessage`, but the client reconstructed its own banner using `jobsFound` and `strongMatches`.

That broke because the all-already-saved response did not include `strongMatches`, and because "strong matches" was no longer the right message for JobsDB dedupe.

The correct pattern is for the route to own operation semantics and for the presentation component to render the provided human-readable message.

## Finding 3: Scraper success requires semantic validation

The actor was structurally successful while semantically wrong.

Structural success:

- Page loaded.
- Cards found.
- Details scraped.
- Dataset written.

Semantic failure:

- Titles did not match the typed query.

The correct pattern is to add at least one semantic canary when a scraper backs a user-facing search feature.

## Finding 4: External actor changes require deploy verification

The Next.js app calls a deployed actor by ID. Local code changes under `apify/jobsdb-hk-actor/` are inert until the actor is pushed and rebuilt.

The correct pattern after actor changes is:

1. Run local tests for helper contracts.
2. Deploy actor.
3. Run a live actor canary.
4. Only then consider the app behavior fixed.
