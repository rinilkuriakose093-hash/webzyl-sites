# Feature Configuration Guide

## Overview

This template includes a **Feature Toggle System** that allows you to enable or disable specific features dynamically. **All features are enabled by default** to provide a fully operational website out of the box.

## Default Features (All Enabled)

The template comes with all these features enabled by default:

- ✅ **About** - About section describing the resort
- ✅ **Amenities** - Showcase facility amenities
- ✅ **Rooms** - Display room types and pricing
- ✅ **Gallery** - Image gallery showcase
- ✅ **Contact** - Contact information and phone link

## How to Disable Features

You have two ways to disable features:

### Method 1: Via JSON Data File (Recommended)

Edit your `data/mountview.json` and add/modify the `features` object:

```json
{
  "name": "Mount View Luxury Resort",
  "features": {
    "about": true,
    "amenities": true,
    "rooms": true,
    "gallery": false,
    "contact": true
  }
}
```

Set any feature to `false` to hide it. Features not specified will use the default (true).

### Method 2: Via JavaScript Global

Before the page loads, set:

```javascript
window.RESORT_FEATURES = {
  "amenities": false,
  "rooms": false
};
```

This will disable the amenities and rooms sections while keeping others enabled.

## What Gets Affected When Features Are Disabled

### About
- Hides the "About Us" section
- Removes "About" from navigation menu

### Amenities
- Hides the "Amenities" section
- Removes "Amenities" from navigation menu
- Removes amenities grid display

### Rooms
- Hides the "Rooms" section
- Removes "Rooms" from navigation menu
- Hides "Explore Rooms" button from hero
- Removes room booking options

### Gallery
- Hides the "Gallery" section
- Removes "Gallery" from navigation menu
- Removes image gallery display

### Contact
- Hides the "Contact" section
- Removes "Contact" from navigation menu
- Hides "Get In Touch" button from hero
- Removes phone contact information

## Navigation Auto-Updates

The navigation menu automatically updates to show only enabled features. Disabled features will:
- Not appear in the main navigation
- Not be accessible via scroll links
- Have their sections completely hidden

## Data Structure Examples

### Full Featured (All Enabled)
```json
{
  "features": {
    "about": true,
    "amenities": true,
    "rooms": true,
    "gallery": true,
    "contact": true
  }
}
```

### Minimal Configuration (Only About & Contact)
```json
{
  "features": {
    "about": true,
    "amenities": false,
    "rooms": false,
    "gallery": false,
    "contact": true
  }
}
```

### Default (If Not Specified)
If you omit the `features` object entirely, all features default to `true`:
```json
{
  "name": "Resort Name"
  // No features object = all enabled
}
```

## Checking Active Features

Open your browser's Developer Console (F12) and type:
```javascript
// See all enabled features
state.config.features

// See debug output
// (if page loaded with ?debug in URL)
```

## Technical Implementation

### Default Feature Constants
Located in the JavaScript section of `template4.html`:

```javascript
const DEFAULT_FEATURES = {
  about: true,
  amenities: true,
  rooms: true,
  gallery: true,
  contact: true
};
```

### Feature Check Function
```javascript
function isFeatureEnabled(featureName, data) {
  // Uses defaults if not specified in data
  // Allows data to override defaults
  // Logs configuration on page load
}
```

## Premium Design Features

The template includes:

✨ **Hero Section**
- Animated gradient background
- Premium logo showcase with drop shadow
- Responsive typography with glowing text effects
- Smooth animations on all elements

✨ **Color Consistency**
- Unified teal/cyan color scheme (#06b6d4)
- Turquoise accents (#14b8a6)
- Consistent across all pages
- Branding color customization support

✨ **Interactive Elements**
- Glassmorphism effects on cards and buttons
- Premium shadows and depth effects
- Smooth hover transitions
- Responsive button states

## FAQ

**Q: Can I have both feature configurations (JSON and JavaScript)?**
A: Yes! JavaScript configuration will override JSON configuration.

**Q: What if I only want to show certain features?**
A: Set unwanted features to `false` in the `features` object. Only explicitly enabled features will be shown.

**Q: Are features completely removed or just hidden?**
A: Disabled features are completely removed from the DOM - they don't load data or render elements, keeping your site lightweight.

**Q: Can I enable/disable features dynamically after page load?**
A: The current implementation determines features at page load. For dynamic changes, you'd need to customize the `isFeatureEnabled` function.

**Q: What about SEO with disabled features?**
A: Disabled features don't appear in the DOM, which is semantically correct. Your meta tags and schema will still reflect your site structure.

## Support

For issues or questions about feature configuration, check:
1. Browser console for debug output (add `?debug` to URL)
2. Verify JSON syntax in `data/mountview.json`
3. Ensure `features` object uses lowercase keys
4. Check that values are boolean (`true`/`false`), not strings
