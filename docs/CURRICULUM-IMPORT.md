# Complete curriculum import

All four official specification PDFs must match the pinned SHA-256 hashes in the versioned catalogue. The importer rejects changed hashes, ambiguous references, wrong extension suffixes, numbering gaps and any Double Award scope mismatch.

Verified unique objective counts: Biology **176** (134 common, 42 separate-only), Chemistry **182** (130 common, 52 separate-only), Physics **195** (147 common, 48 separate-only). Total **553**; all **411** common references match the independent Double Award PDF. Each chapter is also checked against its complete contiguous reference range. Objective-reference counts are not learner mastery claims.

```sh
python -m pip install -r scripts/requirements-curriculum.txt
python scripts/import_curriculum.py
python scripts/import_curriculum.py --sql /tmp/science-ledger-curriculum.sql
```

Apply all application migrations to the intended dedicated Supabase project first. Review the generated SQL and apply it through an authenticated PostgreSQL session with `ON_ERROR_STOP=1`. Keep credentials in a protected environment or PostgreSQL service configuration, never in chat or Git. The script performs no live database writes and no paid AI calls.

Public metadata contains references, generic group titles, scope and source links. Full official PDF page context is service-only in `objective_sources`; browser roles cannot read it. Do not publish generated SQL or raw specification text. New IDs are deterministic and existing matching objective IDs are preserved. A future source revision requires explicit provenance and educational review, not silent relabelling of historical evidence.
