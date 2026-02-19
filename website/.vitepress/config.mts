import { defineConfig } from "vitepress";

export default defineConfig({
  title: "tentickle",
  description: "Autonomous agents built on agentick.",
  base: "/tentickle/",

  head: [
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "tentickle" }],
    ["meta", { property: "og:description", content: "Autonomous agents built on agentick." }],
    ["meta", { property: "og:image", content: "https://agenticklabs.github.io/tentickle/stubs.png" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: "tentickle" }],
    ["meta", { name: "twitter:description", content: "Autonomous agents built on agentick." }],
  ],

  themeConfig: {
    nav: [
      { text: "Docs", link: "/docs/getting-started" },
      { text: "agentick", link: "https://agenticklabs.github.io/agentick/" },
      { text: "GitHub", link: "https://github.com/agenticklabs/tentickle" },
    ],

    sidebar: {
      "/docs/": [
        {
          text: "Getting Started",
          items: [
            { text: "Introduction", link: "/docs/getting-started" },
            { text: "Configuration", link: "/docs/configuration" },
          ],
        },
        {
          text: "Agents",
          items: [
            { text: "Coding Agent", link: "/docs/coding-agent" },
            { text: "Main Agent", link: "/docs/main-agent" },
          ],
        },
        {
          text: "Concepts",
          items: [
            { text: "Context Engineering", link: "/docs/context-engineering" },
            { text: "Verification Gates", link: "/docs/gates" },
            { text: "The TUI", link: "/docs/tui" },
          ],
        },
        {
          text: "Architecture",
          items: [
            { text: "Package Overview", link: "/docs/packages" },
            { text: "Data Directory", link: "/docs/data-directory" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/agenticklabs/tentickle" }],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2025-present Ryan Lindgren",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/agenticklabs/tentickle/edit/master/website/:path",
    },
  },
});
