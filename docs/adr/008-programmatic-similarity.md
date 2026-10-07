# ADR 008: Measuring duplication in programmatic pages

Date: 2026-10-06 · Status: accepted

## Context

Pages generated from one template share most of their text. Comparing whole pages with shingle/Jaccard similarity flags every page as a near-duplicate of every other page, which makes the signal useless, or forces a threshold so high that real duplicates pass.

## Decision

- Render the template with every variable empty to obtain the **boilerplate**.
- For each page, keep only the 3-word shingles that are not in the boilerplate (**specific content**) and count the words it adds beyond the boilerplate (`uniqueWords`, multiset difference).
- Similarity between pages is the Jaccard index of their specific shingles. The maximum over the site's other pages (and pages created earlier in the same run) is stored with the page that is most similar.
- Gate thresholds: specific similarity > 0.85 blocks, > 0.6 needs review; fewer than 8 row-specific words blocks, fewer than 25 needs review. Total length (< 50 words blocks, < 100 needs review) still applies.
- Exact content hash and a 64-bit SimHash remain available for whole-page checks.

## Consequences

- Distinct rows are not penalized for sharing a template (in the fixture dataset, maximum similarity among accepted pages is below 0.3).
- A row that repeats another row's data under a different key ("Puebla" vs "Puebla Centro") is blocked as a near-duplicate.
- A template that writes almost everything itself and uses data only for a city name is blocked or sent to review, which is the doorway-page pattern the tool is meant to prevent.
- Comparison is O(n²) per run; runs are capped at 500 rows. Larger sites need MinHash/LSH.
