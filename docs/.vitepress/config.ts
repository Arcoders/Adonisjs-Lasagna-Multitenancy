import { defineConfig } from 'vitepress'

const PKG = '@adonisjs-lasagna/multitenancy'
const REPO = 'https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy'

export default defineConfig({
  title: 'Lasagna Multitenancy',
  description:
    'Schema-based multi-tenancy for AdonisJS 7. Connection routing, circuit breaker, queues, contextual logging, plans/quotas, backups, replicas, audit logs, webhooks, SSO.',
  cleanUrls: true,
  lastUpdated: true,

  // Several pages link into source/deploy folders that live outside the
  // docs/ tree (e.g. `../src/admin/`, `../deploy/charts/...`). Those
  // resolve correctly when the markdown is read on GitHub but VitePress
  // builds standalone pages, so we tell it to skip those specific patterns
  // rather than rewriting every occurrence to an absolute github.com URL.
  ignoreDeadLinks: [/\/src\//, /\/deploy\//],

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#5a45ff' }],
    ['meta', { name: 'og:title', content: 'Lasagna Multitenancy for AdonisJS 7' }],
    [
      'meta',
      {
        name: 'og:description',
        content:
          'Schema-based PostgreSQL multi-tenancy for AdonisJS 7 — production SaaS plumbing in one package.',
      },
    ],
    ['meta', { name: 'og:type', content: 'website' }],
  ],

  themeConfig: {
    siteTitle: 'Lasagna',
    logo: { light: '/logo.svg', dark: '/logo-dark.svg' },

    nav: [
      { text: 'Guide', link: '/quickstart' },
      { text: 'Compare vs stancl', link: '/comparison' },
      { text: 'Migrate v1 → v2', link: '/migrating-v1-to-v2' },
      {
        text: 'v2.0.0-beta.2',
        items: [
          { text: 'Changelog', link: `${REPO}/blob/master/CHANGELOG.md` },
          { text: 'Release notes', link: `${REPO}/releases` },
          { text: 'npm', link: `https://www.npmjs.com/package/${PKG}` },
        ],
      },
    ],

    sidebar: {
      '/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Why Lasagna', link: '/' },
            { text: 'Quickstart', link: '/quickstart' },
          ],
        },
        {
          text: 'Operate',
          items: [
            { text: 'Deployment', link: '/deployment' },
            { text: 'Security', link: '/security' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Comparison vs stancl', link: '/comparison' },
            { text: 'Migrating v1 → v2', link: '/migrating-v1-to-v2' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: REPO },
      { icon: 'npm', link: `https://www.npmjs.com/package/${PKG}` },
    ],

    editLink: {
      pattern: `${REPO}/edit/master/docs/:path`,
      text: 'Edit this page on GitHub',
    },

    search: { provider: 'local' },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025-present Ismael Haytam Tanane',
    },

    outline: { level: [2, 3] },
  },
})
