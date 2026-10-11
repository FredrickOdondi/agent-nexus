const signed = Boolean(process.env.CSC_LINK);
const notarize = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "app.nimbus.desktop",
  productName: "Nimbus",
  copyright: "Copyright © 2026 Nimbus",
  npmRebuild: false,
  asar: true,
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: ["dist/**", "package.json"],
  extraResources: [
    { from: "../server/dist", to: "server", filter: ["**/*.js", "**/*.map"] },
    { from: "../web/dist", to: "web" },
    { from: "resources/screen", to: "screen", filter: ["**/*", "!**/*.swift", "!**/*.c"] },
  ],
  mac: {
    category: "public.app-category.productivity",
    target: [{ target: "dmg", arch: ["universal"] }],
    hardenedRuntime: signed,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize,
    extendInfo: {
      NSScreenCaptureUsageDescription: "Nimbus takes a screenshot so the agent can see this screen and click what you ask.",
    },
  },
  dmg: { title: "Nimbus" },
  win: {
    target: [{ target: "nsis", arch: ["x64", "arm64"] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: "Nimbus",
  },
};
