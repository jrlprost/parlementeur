// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://parlementeur.fr',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/og/') })],
});
