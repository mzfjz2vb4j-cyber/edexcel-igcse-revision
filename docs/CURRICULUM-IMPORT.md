# Full curriculum import

The importer verifies all four pinned Pearson specification PDFs before parsing. It stops on changed hashes, duplicate/ambiguous references, unexpected extension suffixes or a Double Award scope mismatch.

Expected verified leaves: Biology 182 (134 core, 48 separate-only), Chemistry 188 (130 core, 58 separate-only), Physics 201 (147 core, 54 separate-only). Total 571; Double Award contains the 411 core references. Extension suffixes B/C/P are retained. These are objective-reference counts, not claims that learners have mastered the objectives.

```sh
python -m pip install -r scripts/requirements-curriculum.txt
python scripts/import_curriculum.py
python scripts/import_curriculum.py --sql /tmp/science-ledger-curriculum.sql
```

After applying application migrations to the intended dedicated project, review the generated SQL and apply it through an authenticated PostgreSQL session with `ON_ERROR_STOP=1`. Keep database credentials in a private environment or protected PostgreSQL service configuration, never in chat or Git. The script does not apply SQL itself or call a paid AI provider.

The public catalogue contains references, generic group titles, scope and official source links. Full PDF page context is stored in `objective_sources`, which has RLS and no browser-role read permission. Do not commit or publish generated SQL/raw specification text. Existing objective IDs are preserved; new IDs are deterministic. A source revision requires explicit human review and updated provenance rather than silently relabelling old evidence.
