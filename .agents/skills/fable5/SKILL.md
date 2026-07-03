---
name: fable5
description: |
  Load this skill when the user asks to create a project skill library, build project documentation for AI agents,
  establish developer runbooks, or transfer project knowledge to junior engineers / smaller models.
  Triggers: "create skill library", "build .claude/skills", "document the project for AI", "skill transfer",
  "onboard junior devs", "project runbook", "fable5", "comprehensive skills", "knowledge transfer framework".
  This is a meta-skill: it teaches HOW to build a complete, verified, maintainable project skill library
  using multi-agent orchestration. It is NOT a single project's skills — it's the factory for building them.
---

# Fable5: The Project Skill Library Framework

You are a distinguished engineer retiring from this project. Your final task: build a complete skill library under `.agents/skills/` (or `.claude/skills/`) so that junior/mid-level engineers and smaller AI models (Sonnet-class) can carry this project forward without you. Cheaper sessions must be able to debug, extend, validate, and eventually advance this project at the standard you hold today. Use multi-agent orchestration (workflows) for authoring and review; token cost is not a constraint, correctness is.

---

## Phase 1 — Discover Before You Write

Investigate the repo like an incoming principal engineer:

### Discovery Checklist
- [ ] README / manifest / contributor docs
- [ ] Build system: how it's actually run (not just documented)
- [ ] Test suite: commands, coverage, what's actually passing
- [ ] CI config: what gates exist, what's skipped
- [ ] Docs directories: what exists, what's stale
- [ ] Git history: what changed, what got reverted, what stalled on dead branches
- [ ] Open TODO/FIXME hotspots (use `code_searcher` for `TODO`, `FIXME`, `HACK`, `XXX`)
- [ ] Issue-shaped artifacts (open issues, stale PRs, design docs)
- [ ] Generated-data or deploy conventions
- [ ] Project memory/notes (`knowledge.md`, `.agents/`, `CONTRIBUTING.md`, etc.)

### Tools to Use for Discovery
| What | Tool |
|------|------|
| Find relevant files | `file_picker` agent (multiple, parallel) |
| Search for patterns | `code_searcher` agent |
| Explore directories | `list_directory`, `glob`, `read_subtree` |
| Read key files | `read_files` |
| Check git history | `basher` agent: `git log --oneline -50`, `git branch -a`, `git stash list` |
| Web research | `researcher_web`, `researcher_docs` |

### The Five Questions
After exhaustive discovery, ask the user AT MOST five questions — only for what the repo CANNOT tell you:

1. **Hardest live problem**: What is the hardest unsolved problem right now?
2. **Unwritten discipline rules**: What are you not allowed to do that no doc states? (e.g., "never bump X dependency past Y", "don't refactor Z module")
3. **Audience gaps**: Who is the audience for this library, and what do they NOT know that they should?
4. **Costly past failures**: What past failures cost the most time/money? (so failure-archaeology can capture them)
5. **Beyond state of the art**: What does "beyond state of the art" mean for this project?

Fold answers into everything below.

---

## Phase 2 — Author the Library

Use parallel agents — one agent per skill. Spawn them simultaneously when independent, sequentially when one depends on another.

### Taxonomy (adapt to project — merge thin categories, split deep ones, add domain-specific categories)

Aim for **10–16 skills** total.

#### CORE Skills (every project needs these)

1. **`<project>-change-control`**
   - How changes are classified, gated, reviewed
   - The project's non-negotiables with the *rationale* and the historical incident behind each
   - PR template, review checklist, merge criteria

2. **`<project>-debugging-playbook`**
   - Symptom → triage table for this project's failure modes
   - The traps that cost real time (each with its story)
   - Discriminating experiments: "If you see X, it's Y; if you see A, it's B"

3. **`<project>-failure-archaeology`**
   - Chronicle of every major investigation, dead end, rejected fix, and revert
   - Format: symptom → root cause → evidence → status
   - Mine git history and docs hard for this

4. **`<project>-architecture-contract`**
   - Load-bearing design decisions and WHY
   - Invariants that must hold
   - Open known-weak points, stated plainly (not sugar-coated)

5. **`<domain>-reference`**
   - Domain-theory knowledge pack a mid-level person lacks
   - The field's math/protocols/standards as they apply HERE, not a textbook
   - Jargon glossary with project-specific meanings

6. **`<project>-config-and-flags`**
   - Catalog of every configuration axis: options, defaults, which are production vs experimental
   - Guards and constraints
   - Checklist for adding a new config option
   - Re-verification commands (flags drift over time)

7. **`<project>-build-and-env`**
   - Recreate the environment from scratch
   - Known traps: OS-specific issues, version pinning, toolchain quirks
   - Copy-pasteable setup commands

8. **`<project>-run-and-operate`**
   - Running/deploying the thing: command anatomy
   - Data or artifact conventions
   - What output lands where

9. **`<project>-diagnostics-and-tooling`**
   - How to MEASURE instead of eyeball
   - Diagnostic tools with interpretation guides
   - Ship actual scripts inside the skill's `scripts/` dir where they exist or can be written

10. **`<project>-validation-and-qa`**
    - What counts as evidence here
    - Acceptance-threshold discipline
    - Certified/golden inventory
    - How to add tests (with the exact commands)

11. **`<project>-docs-and-writing`**
    - Maintaining the docs of record
    - Templates
    - House style (voice, formatting, diagram conventions)

12. **`<project>-external-positioning`**
    - Papers/releases/ecosystem: what's novel vs known
    - What must be proven before claiming
    - Reproducibility standards

#### ADVANCED Skills (makes juniors dangerous, in the good way)

13. **`<project>-<hardest-problem>-campaign`**
    - EXECUTABLE, decision-gated campaign for the hardest live problem from Phase 1
    - Numbered phases with exact commands
    - EXPECTED observations/numbers at every gate ("if you see X instead → branch to Y")
    - Solution menu ranked with theory/derivation obligations for each
    - Known wrong paths explicitly fenced off
    - Validation-and-promotion protocol routing through the project's change control
    - Success must be measurable, never judged by eye

14. **`<project>-proof-and-analysis-toolkit`**
    - First-principles analysis methods of this domain
    - Whatever "prove it, don't just install it" means here
    - Each method as a recipe with a worked example from this repo's history

15. **`<project>-research-frontier`**
    - Open problems where this project could advance the state of the art
    - For each: why current SOTA fails, this project's specific asset
    - First three concrete steps IN THIS REPO
    - Falsifiable "you have a result when…" milestone

16. **`<project>-research-methodology`**
    - The discipline that turns a hunch into an accepted result
    - Evidence bar: one mechanism must explain ALL observations including negatives, and survive assigned adversarial refutation
    - Hypothesis-predicts-numbers-before-running
    - Idea lifecycle: from experiment flag to adopted change or documented retirement
    - Where good ideas historically came from in this project

---

### Authoring Rules (bake into EVERY agent's prompt)

- **Audience**: Zero-context mid-level engineer or Sonnet-class model.
- **Voice**: Imperative runbook voice. Copy-pasteable commands.
- **Jargon**: Every jargon term defined once.
- **Structure**: Tables, checklists, decision trees.
- **Self-awareness**: Each skill says when NOT to use it and which sibling to use instead.
- **Format**: `.agents/skills/<name>/SKILL.md` (or `.claude/skills/<name>/SKILL.md`)
  - YAML frontmatter with `name` and a trigger-rich `description` (exactly when a model should load it).
- **GROUND TRUTH ONLY**: Verify every command, flag, path, and claim against the repo before stating it. Wrong runbooks are worse than none.
- **Embed knowledge, not references**: Don't reference private/user-specific paths as load-bearing sources.
- **Date-stamp volatile facts**: End each skill with a "Provenance and maintenance" section containing one-line re-verification commands for anything that may drift.
- **No oversell**: Unproven things stay labeled open/candidate. Nothing may contradict the project's own manifest/rules. No skill may route around its change-control.
- **Write ONLY inside the skills directory**: The rest of the repo is read-only. No mutating git commands.

### Prompt Template for Each Skill-Authoring Agent

```
You are authoring the skill `<skill-name>` for the <project-name> project.
Your output goes to `.agents/skills/<skill-name>/SKILL.md`.

CONTEXT:
<results from Phase 1 discovery>

INSTRUCTIONS:
1. Study the relevant parts of the repo for this skill's domain.
2. Write the SKILL.md with YAML frontmatter (name + trigger-rich description).
3. Every command must be verified against the repo. Every claim must be grounded.
4. Include: when NOT to use this skill, cross-references to sibling skills.
5. End with "Provenance and maintenance" section.

Do NOT modify files outside `.agents/skills/<skill-name>/`.
```

---

## Phase 3 — Review and Fix

After ALL skills exist, run three parallel reviewers over the complete set, then one fixer:

### Reviewer 1: FACTUAL
- Re-verify flags, paths, commands, citations against the repo
- Flag anything invented or stale
- Severity test: "Would this send an engineer down a wrong path?"
- Use `code_searcher`, `glob`, `read_files` to verify every claim

### Reviewer 2: DOCTRINE
- Contradictions with the project's rules or between skills
- Overstated claims
- Missing gating on anything that changes behavior
- Check: every "must" and "never" has a rationale

### Reviewer 3: USABILITY
- Trigger quality of descriptions (would a model know WHEN to load this?)
- Duplication (one home per fact, cross-references elsewhere)
- Self-containedness (can a zero-context engineer use this?)
- Scannability (can you find the answer in 30 seconds?)

### Fixer
- Apply all blocking + important fixes from the three reviews
- Re-verify after fixing
- Report: what was fixed, what was deferred, what remains uncertain

### Final Output
After the fixer completes, produce:
- **Skill inventory**: one-line descriptions of each skill
- **Verification report**: what you verified by spot-check
- **Uncertainty register**: what remains uncertain and why

---

## Execution Strategy

### Spawning Strategy
1. **Phase 1**: Spawn 4-6 file-pickers + 2-3 code-searchers in parallel for broad discovery. Read key files. Run git log. Then ask the 5 questions.
2. **Phase 2**: Spawn all independent skill authors in parallel (typically 10-16 agents). Chain dependent ones.
3. **Phase 3**: Spawn 3 reviewers in parallel, then 1 fixer.

### When to Use thinker-with-files-gemini
- Before authoring skills that require deep architectural understanding
- When deciding how to adapt the taxonomy to the project
- When resolving contradictions found during review

### Skills Directory Convention
- Use `.agents/skills/` for Codebuff projects (the `skill` tool loads from here)
- Each skill is a subdirectory: `.agents/skills/<skill-name>/SKILL.md`
- Supporting files (scripts, templates) go alongside SKILL.md

---

## Provenance and Maintenance

- **Created**: 2026-07-03
- **Framework version**: 1.0
- **Re-verification commands**:
  - `ls .agents/skills/` — verify skills exist
  - `find .agents/skills -name "SKILL.md" | wc -l` — count skills
  - `head -5 .agents/skills/*/SKILL.md` — spot-check frontmatter
