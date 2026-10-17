import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

const background = '#6EB8F2';

// icon.svg is full-bleed on the app background with all content inside the central 80%,
// so no icon needs extra padding.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0,
      resizeOptions: { background, fit: 'contain' },
    },
    apple: {
      ...minimal2023Preset.apple,
      padding: 0,
      resizeOptions: { background, fit: 'contain' },
    },
  },
  images: ['frontend/public/icon.svg'],
});
