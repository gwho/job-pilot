# Diagnosis — Resume Extraction Truncation Fix

The repeated failure was Failure Mode 1: a specific thing was broken.

The original JSON parse crash had already been contained, but clicking "Extract from Resume" still failed for the user's real resume. The new server log was:

```text
[agent/extractor] Nemotron response was truncated at max_tokens
POST /api/profile/extract 200 in 60s
```

That means the route no longer crashed, but the feature still did not extract useful profile data. The symptom moved from an uncaught `SyntaxError` to a controlled UI error.

Root cause: the first corrective pass treated truncation as a terminal failure. For this feature, truncation is recoverable because the model can be asked for a smaller JSON object with bounded arrays and shorter role summaries.
