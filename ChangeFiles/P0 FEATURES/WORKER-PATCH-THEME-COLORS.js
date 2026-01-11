// ADD THIS TO WORKER.JS
// Place this BEFORE the renderSmartTemplate function

const THEME_COLORS = {
  'ocean-breeze': {
    primary: '#14b8a6',
    primaryDark: '#0d9488',
    primaryLight: '#5eead4'
  },
  'royal-purple': {
    primary: '#8b5cf6',
    primaryDark: '#7c3aed',
    primaryLight: '#a78bfa'
  },
  'sky-blue': {
    primary: '#3b82f6',
    primaryDark: '#2563eb',
    primaryLight: '#60a5fa'
  },
  'fresh-mint': {
    primary: '#10b981',
    primaryDark: '#059669',
    primaryLight: '#34d399'
  },
  'sunset-orange': {
    primary: '#f97316',
    primaryDark: '#ea580c',
    primaryLight: '#fb923c'
  },
  'fiery-red': {
    primary: '#ef4444',
    primaryDark: '#dc2626',
    primaryLight: '#f87171'
  },
  'modern-gray': {
    primary: '#6b7280',
    primaryDark: '#4b5563',
    primaryLight: '#9ca3af'
  },
  'cherry-blossom': {
    primary: '#ec4899',
    primaryDark: '#db2777',
    primaryLight: '#f472b6'
  }
};

// UPDATE the renderSmartTemplate function to include theme colors:

function renderSmartTemplate(config, templateHTML) {
  const intent = deriveBusinessIntent(config.category);
  const labels = getIntentLabels(intent);
  
  // Get theme colors
  const themeId = config.templateId || 'ocean-breeze';
  const colors = THEME_COLORS[themeId] || THEME_COLORS['ocean-breeze'];
  
  // ... rest of existing code, but ADD these replacements:
  
  html = html
    .replace(/{{PRIMARY_COLOR}}/g, colors.primary)
    .replace(/{{PRIMARY_DARK}}/g, colors.primaryDark)
    .replace(/{{PRIMARY_LIGHT}}/g, colors.primaryLight)
    // ... rest of existing replacements
  
  // Also add MAP_EMBED conditional:
  html = handleConditional(html, 'MAP_EMBED', config.embeds?.map);
  if (config.embeds?.map) {
    html = html.replace(/{{MAP_EMBED}}/g, config.embeds.map);
  }
  
  // ... rest of existing code
}
