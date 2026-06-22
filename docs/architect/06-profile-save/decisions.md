# Design Decisions — Feature 06: Profile Save Logic

| Decision | Choice | Reason |
|---|---|---|
| Completion logic location | `lib/profile-utils.ts` shared utility | Prevents client/server divergence — same function used by form display and Server Action |
| Resume upload timing | Separate `uploadResume` action, fires on file pick | Immediate feedback; Save button stays fast and scoped to text fields |
| Resume overwrite strategy | `remove(oldKey)` → `upload()` → save new key | SDK `upload()` has no upsert — auto-renames on conflict, causing file accumulation |
| Email source | Auth session in Server Action | Not form input — prevents spoofing; email is auth-owned |
| `MissingField` type | Named union type in `types/index.ts` | Explicit contract between form, utils, and Server Action |
| DB API | `insforge.database.from(...)` | Verified from actual SDK types — `insforge.from()` doesn't exist |
| `ProfileAttentionBanner` extraction | Deferred | Not blocking Feature 06; inline completion banner already works |
| Server Action parameter | Typed object for `saveProfile`; FormData for `uploadResume` | File upload requires FormData; text fields are cleaner as typed args |
