# Experiments Governance v1

**(Design System Extension - Controlled Testing)**

## Purpose

Experiments allow **controlled A/B testing** using existing design variants without:
- Creating per-site CSS
- Modifying templates
- Introducing randomness
- Breaking determinism

**Experiments are not features** — they are temporary mechanisms to validate design decisions using existing variant infrastructure.

---

## Core Principles

### 1. Experiments Use Variants Only

- Experiments **must** map to existing design variants
- No new design tokens can be created for experiments
- No new CSS can be introduced
- Experiments test **variant combinations**, not new designs

### 2. No Template Changes Allowed

- Templates remain 100% unchanged during experiments
- All visual changes come from design token values
- Template structure is **not** an experiment variable

### 3. No Per-User Randomness

- Assignment is **slug-based**, not user-based
- Same slug → same experiment variant (always)
- No cookies, no session storage, no client-side randomization
- Server-side deterministic assignment only

### 4. Assignment Must Be Deterministic

- Hash-based assignment using site slug
- Same input → same output (reproducible)
- No time-based logic
- No external API calls for assignment

### 5. Experiments Must Be Reversible

- Turning off an experiment restores base behavior
- No migration required
- No data loss
- Instant rollback capability

---

## Experiment Lifecycle

### Starting an Experiment

**Config Addition:**
```json
{
  "experiment": {
    "id": "hero-spacing-test-v1",
    "variant": "auto"
  }
}
```

- `id`: Unique experiment identifier
- `variant`: "auto" (deterministic assignment) or explicit "A"/"B"

### Running an Experiment

- Sites are assigned variant A or B deterministically
- Assignment is **stable** — same slug always gets same variant
- Logs track which variant was assigned

### Ending an Experiment

**Option 1: Apply winning variant**
```json
{
  "branding": {
    "designVariant": "calm"  // Winner from experiment
  },
  "experiment": null  // Remove experiment
}
```

**Option 2: Revert to base**
```json
{
  "experiment": null  // Remove experiment
}
```

---

## Technical Rules

### Experiment → Variant Mapping

Experiments map to **existing design variants only**:

```
hero-spacing-test-v1:
  A → luxury-heritage-v1--calm
  B → luxury-heritage-v1--bold
```

**No new variants can be created for experiments.**

### Assignment Algorithm

```javascript
// Deterministic hash-based assignment
const slug = siteConfig.slug || '';
let hash = 0;
for (let i = 0; i < slug.length; i++) {
  hash += slug.charCodeAt(i);
}
return hash % 2 === 0 ? 'A' : 'B';
```

**This ensures:**
- Same slug → same variant
- ~50/50 distribution across sites
- Zero randomness

### SSR Integration

1. Load base design profile
2. Check if experiment exists
3. If yes:
   - Resolve experiment variant (A or B)
   - Map to design variant
   - Merge variant overrides
4. Inject final tokens

**No changes to `generateDesignTokens()` or templates.**

---

## Governance Compliance

### ✅ Allowed in Experiments

- Testing existing variant combinations
- Deterministic slug-based assignment
- Mapping experiments to known design variants
- Temporary experiment configuration in site config

### ❌ Forbidden in Experiments

- Creating new design tokens
- Per-user randomization
- Template modifications
- Per-site CSS
- Client-side variant switching
- Time-based or geo-based assignment
- External API calls for assignment

---

## Monitoring & Debugging

### Experiment Logs

During active experiment:
```
[Experiment] mountview → hero-spacing-test-v1 : A
[DesignProfile] mountview → luxury-heritage-v1 + calm
```

### Verification Checklist

Before launching an experiment:

1. ✅ Does it use only existing variants?
2. ✅ Is assignment deterministic?
3. ✅ Same slug = same variant?
4. ✅ Can it be turned off instantly?
5. ✅ Zero template changes?
6. ✅ Zero new CSS?

**If any answer is NO → experiment is rejected.**

---

## One-Line Rule

> **If an experiment requires creating new design assets, it's not an experiment — it's a new profile version.**

---

## Status

**Version:** 1.0  
**Status:** LOCKED  
**Last Updated:** January 1, 2026  
**Compliance:** Follows DESIGN_PROFILE_GOVERNANCE_v1.md
