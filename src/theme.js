// Color palettes. CSS variable values live in src/index.css under
// `:root[data-theme="<id>"]` blocks; this file drives the picker UI and
// validates persisted values.

export const THEME_IDS = [
  'emerald-prestige',
  'midnight-indigo',
  'charcoal-ember',
  'noir-gold',
  'cloud-white',
  'ocean-deep',
];

export const DEFAULT_THEME = 'cloud-white';

export const THEMES = [
  {
    id: 'emerald-prestige',
    name: 'Emerald Prestige',
    description: 'Warm cream with deep emerald and gold. Refined and approachable.',
    swatches: ['#F4EFE6', '#FBF7EE', '#0F4D3A', '#C9A24A'],
  },
  {
    id: 'midnight-indigo',
    name: 'Midnight Indigo',
    description: 'Deep navy with electric indigo. Sophisticated tech.',
    swatches: ['#0B0F1E', '#15234F', '#3D2C8D', '#5B5BFF'],
  },
  {
    id: 'charcoal-ember',
    name: 'Charcoal & Ember',
    description: 'Dark charcoal with warm ember accents.',
    swatches: ['#0A0A0A', '#1A1A1A', '#4A4F55', '#E0651F'],
  },
  {
    id: 'noir-gold',
    name: 'Noir & Gold',
    description: 'Black with luxurious gold. High-end editorial.',
    swatches: ['#000000', '#0E0E10', '#B08922', '#E9D8A6'],
  },
  {
    id: 'cloud-white',
    name: 'Cloud White',
    description: 'Airy whites and soft grays with a blue tint.',
    swatches: ['#FFFFFF', '#E6EEF5', '#9AA9B8', '#4FA8E0'],
  },
  {
    id: 'ocean-deep',
    name: 'Ocean Deep',
    description: 'Deep blues and teals. Calm and trustworthy.',
    swatches: ['#0A2540', '#0E4A5C', '#1E829A', '#A8D8D0'],
  },
];

export function isThemeId(v) {
  return typeof v === 'string' && THEME_IDS.includes(v);
}

export function resolveTheme(v) {
  return isThemeId(v) ? v : DEFAULT_THEME;
}
