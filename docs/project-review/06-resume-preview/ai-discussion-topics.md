# AI Discussion Topics — Resume Preview Fix

## Private Storage & Signed URLs

1. "What's the difference between a public and private storage bucket? When should each be used?"
2. "How do signed URLs work? What information is encoded in the token?"
3. "Why do signed URLs need an expiry? What's the security risk of a non-expiring signed URL?"
4. "If a user shares their signed URL with someone, can that person access the file? What are the implications?"

## State vs Database

5. "Why is React component state not a reliable place to store things like uploaded filenames? When should something live in state vs the database?"
6. "What's the difference between local state, server state, and database state? Give me a mental model for deciding which to use."
7. "We use `profile?.resume_pdf_filename ?? (profile?.resume_pdf_key ? 'resume.pdf' : null)` — explain the two fallback levels and why each is needed."

## Server Actions for External Resources

8. "Why is generating a signed URL a Server Action rather than a client-side fetch? What would break if it ran on the client?"
9. "The signed URL expires in 1 hour. What happens if the user keeps the tab open for 2 hours and then clicks 'View current resume'? How would you handle that edge case?"
10. "What's the difference between calling `createSignedUrl` on every click vs caching the result? When would caching be appropriate?"
