# Design Profile Governance v1

**(Authoritative, Enforceable)**

## Purpose

Design Profile Governance exists to ensure that:

- **Existing sites never change unexpectedly**
- **Design quality improves centrally**
- **No one (including future-you) introduces shortcuts**
- **The system remains deterministic, debuggable, and premium**

**Governance is not optional.**  
Any change that violates these rules is considered a **platform regression**.

---

## 1. Core Governance Principles (Non-Negotiable)

### Design is platform-owned

- No per-site overrides
- No customer customization
- No "just this one exception"

### Profiles are immutable once published

- A published profile file is **never edited**
- Any change requires a **new version ID**

### Determinism over flexibility

- No runtime guessing
- No AI-driven styling
- No content-based layout decisions

### Tokens are the only interface

- Templates consume tokens
- Templates **never** encode design intent

---

## 2. Profile Lifecycle Rules

### 2.1 Creating a New Profile

Create a new base profile **only if**:

- Typography system changes (font family, scale logic)
- Layout semantics change (hero behavior, section rhythm)
- Visual identity category changes (e.g., editorial → minimal)

**Examples:**

- ✅ `luxury-heritage-v1` → valid base profile
- ✅ `modern-premium-v1` → valid base profile

**❌ Do NOT create new profiles for:**

- color tweaks
- spacing tuning
- motion changes

**Those belong to variants.**

### 2.2 Versioning Rules (Critical)

Profiles are versioned explicitly.

- `luxury-heritage-v1` → **immutable**
- Any breaking change → `luxury-heritage-v2`
- **Never overwrite v1**

**Breaking change includes:**

- font change
- base font size change
- scale ratio change
- layout behavior change

---

## 3. Variant Rules

Variants exist to introduce **controlled diversity**, not freedom.

### Allowed in Variants

- spacing adjustments
- color accent changes
- motion duration/type
- minor mood adjustments

### Forbidden in Variants

- font family changes
- layout role changes
- semantic behavior changes
- new tokens

### Variants must:

- extend **exactly one** base profile
- override only a **subset** of tokens
- remain **deterministic**

---

## 4. Token Governance

### 4.1 Token Stability

Once a token name exists, it must **never change meaning**.

**Example:**

- `--color-bg` must always mean "page background"

**Never repurpose tokens.**

If meaning changes → introduce a **new token** in a **new profile version**.

### 4.2 Token Additions

Adding tokens is allowed **only when**:

- required by **all templates**
- applies to **all sites** using that profile
- documented explicitly

**Ad-hoc tokens are forbidden.**

---

## 5. Template Compliance Rules

Templates must:

- ❌ **Never** reference literal fonts
- ❌ **Never** reference literal colors
- ❌ **Never** reference literal spacing for layout rhythm
- ✅ **Use tokens exclusively**

**Any template violating this is non-compliant.**

Compliance is **binary**, not subjective.

---

## 6. SSR & Runtime Rules

- **Profile resolution happens before render**
- **Variants are resolved deterministically**
- **SSR injects tokens exactly once**
- **No runtime mutation of tokens**

### Workers must:

- fail fast on invalid profiles
- never silently fallback

---

## 7. Change Approval Checklist (Operational)

Any design change must answer **YES** to all:

1. Does this require a new profile or version?
2. Are existing sites unaffected?
3. Is behavior deterministic?
4. Are templates unchanged?
5. Is rollback trivial?

**If any answer is NO → change is rejected.**

---

## 8. Explicit No-Go List (Forever Forbidden)

These are **permanent exclusions**:

- Per-site CSS
- Customer font selection
- Inline style overrides
- "Advanced design settings"
- AI-driven runtime styling
- Content-measured layout changes

**These undermine the platform model.**

---

## 9. One-Line Enforcement Rule

> **If a design decision cannot be applied safely to 10,000 sites at once, it does not belong in Webzyl.**

---

## Status

**Version:** 1.0  
**Status:** LOCKED  
**Last Updated:** January 1, 2026
