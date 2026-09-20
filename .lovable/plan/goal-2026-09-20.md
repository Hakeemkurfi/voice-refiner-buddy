## Goal

Make Axon read each visible question once, then use numbering only where written working is needed.

## Changes

- Read the question itself before answering, without calling it “Line one.”
- For derivatives, integrals, equations, calculations, proofs, and similar work, say “Solution,” then dictate numbered lines from the formula through the final answer.
- For objective, true/false, definition, and recall questions, skip numbered working and begin clearly with “Correct answer: Option …” or the direct answer.
- For multiple questions, read and answer each question separately; restart solution line numbering only for worked questions.
- Apply the same behavior to the Raspberry Pi endpoint and the app’s analysis flow.

## Verification

- Check one objective question produces a direct correct option without line numbers.
- Check one calculus question reads the question unnumbered, then provides complete numbered solution lines.
- Confirm the app still builds successfully.
