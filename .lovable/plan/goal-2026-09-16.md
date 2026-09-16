## Goal

Make every Axon solution easy to copy onto paper without skipped algebra or calculation steps, while keeping DeepSeek fast and resources optional.

## Changes

1. Update both Raspberry Pi answer paths (`ask` and `solve`) to dictate numbered lines in order:
   - Line 1: identify what is given and what must be found.
   - Line 2: state the exact formula, rule, or distribution.
   - Following lines: substitute values, simplify one meaningful transformation at a time, calculate, and preserve units.
   - Final line: clearly state the final answer and, when useful, a short check.
2. Add specific completeness rules for calculus and probability topics, including area under curves, arc length, single/double integrals, continuous random variables, binomial and hypergeometric distributions, combinations, and permutations.
3. Keep each spoken line short enough to write down, but never omit a step whose omission could cause a copied solution to be marked wrong.
4. Keep the current priority unchanged: relevant course resources guide the method; otherwise DeepSeek solves from general knowledge. Resources never block an answer.
5. Keep answers concise by omitting only trivial commentary—not formulas, substitutions, limits, bounds, probability definitions, units, or important transformations.

## Resource and credit behavior

- Resources can be uploaded later through the existing Resources page with course, subject, semester, and document type.
- Axon indexes each resource once, then retrieves only a few relevant passages per question instead of sending the whole document.
- This minimizes resource-search credit use. DeepSeek answer usage remains separate and continues using the paid DeepSeek account.
- Text-based PDFs are preferred. Scanned PDFs should first have readable OCR; otherwise they may contain no indexable text.

## Verification

- Test one calculus question and one probability question through the same public endpoint used by the Pi.
- Confirm responses use ordered spoken lines from formula through final answer.
- Confirm relevant resources remain optional and no-resource questions still receive complete answers.
- Check the current app build after the prompt changes.