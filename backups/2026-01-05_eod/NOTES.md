# Webzyl — 2026-01-05 EOD Notes

## What shipped today (high level)

### 1) Explicit Hero Background control (blank/preset/custom)
- New config model: `heroBackground: { type: 'none'|'preset'|'custom', value }`
- Backward compatible behavior:
  - If `heroBackground` missing → treat as preset `platform-default`
  - If legacy `heroImage` exists → treated as `custom`
- Template updated so blank hero renders **no image element** and stays true white.

### 2) Operator + Admin onboarding integrated
- Operator dashboard:
  - Added Hero Background UI (Blank / Preset / Custom)
  - Saves `heroBackground` and only sends legacy `heroImage` when custom (for older worker compatibility)
- Admin onboarding:
  - Added Hero Background choice UI (Blank/Preset/Custom)
  - Sends `heroBackgroundType` + `heroBackgroundValue` to `/api/ceo/property/generate`

### 3) Fixed “white looks grey”
- Root cause: `.hero::before` overlay gradient tinted white to grey.
- Fix: disable overlay for blank heroes via `.hero.hero-bg-none::before { display:none; background:none; }`

### 4) Header Style Profile (auto/light/dark/custom)
- Added config: `headerStyle: { mode: 'auto'|'light'|'dark'|'custom', textColor?, brandFontStyle?, brandFontWeight?, brandFontSizePx? }`
- Logic:
  - `auto` resolves based on hero background
    - blank hero → dark header
    - image hero → light header
  - `custom` allows limited overrides for top-left brand + menu text color.
- Operator UI added:
  - Mode dropdown
  - Custom: color picker + font style dropdown + size/weight dropdowns

## Key logic (snippets)

### A) Hero background resolution (Worker)
```js
function resolveHeroBackground(config) {
  const hb = (config && typeof config === 'object')
    ? (config.heroBackground ?? config.branding?.heroBackground ?? null)
    : null;
  const legacyHeroImage = String(config?.heroImage || config?.branding?.heroImage || '').trim();

  if (hb && typeof hb === 'object') {
    const type = String(hb.type ?? '').trim().toLowerCase();
    const value = (hb.value == null ? '' : String(hb.value)).trim();

    if (type === 'none') return { type: 'none', value: null, hasImage: false, url: '' };
    if (type === 'preset') return { type: 'preset', value: value || 'platform-default', hasImage: true, url: getHeroBackgroundPresetUrl(value || 'platform-default') };
    if (type === 'custom') return value ? { type: 'custom', value, hasImage: true, url: value } : { type: 'none', value: null, hasImage: false, url: '' };
  }

  if (legacyHeroImage) return { type: 'custom', value: legacyHeroImage, hasImage: true, url: legacyHeroImage };
  return { type: 'preset', value: 'platform-default', hasImage: true, url: getHeroBackgroundPresetUrl('platform-default') };
}
```

### B) SSR rendering placeholders (Worker)
- Sets:
  - `{{HERO_IMAGE}}` to empty when `none`
  - `{{HERO_BG_CLASS}}` to `hero-bg-none` when `none`
  - `{{BODY_CLASS}}` to include both hero mode + header style mode

### C) Header Style Profile resolution (Worker)
```js
const headerStyle = (config.headerStyle && typeof config.headerStyle === 'object')
  ? config.headerStyle
  : ((config.branding?.headerStyle && typeof config.branding.headerStyle === 'object') ? config.branding.headerStyle : null);

const headerMode = ['auto','light','dark','custom'].includes(String(headerStyle?.mode ?? '').trim().toLowerCase())
  ? String(headerStyle?.mode).trim().toLowerCase()
  : 'auto';

const headerModeResolved = (headerMode === 'light' || headerMode === 'dark')
  ? headerMode
  : (heroBgMode === 'none' ? 'dark' : 'light');
```

### D) Template (KV) key CSS changes
- Hero white/blank is now true white:
  - `.hero.hero-bg-none { background: var(--white); color: var(--text-dark); }`
  - `.hero.hero-bg-none::before { display:none; background:none; }`
- Header style driven by SSR vars + body classes:
  - `body.header-style-dark .header.transparent { background: rgba(255,255,255,0.98); box-shadow: var(--shadow); }`
  - `body.header-style-dark .header.transparent .logo, ... { color: var(--header-text-color); text-shadow: none; }`

## Files touched (main)
- `worker.js`
- `_tmp_smart-nav.html` (KV template source)
- `_external/webzyl-operator/operator-dashboard.html`
- `webzyl-admin-dist/index.html`

## Deploys done today
- Worker deployed via `npx wrangler deploy`
- KV template updated via `npx wrangler kv:key put template:smart-nav --path _tmp_smart-nav.html`
- Pages deployed:
  - Operator: `npx wrangler pages deploy _external\webzyl-operator --project-name webzyl-operator`
  - Admin: `npx wrangler pages deploy webzyl-admin-dist --project-name webzyl-admin`

## How to verify quickly
- SSR sanity: `https://<slug>.webzyl.com/?__nocache=1`
- For blank hero:
  - Expect `<body class="hero-bg-none header-style-dark ...">`
  - Expect no `.hero-art` element

