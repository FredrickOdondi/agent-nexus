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
  files: ["dist/**", "package.json", "!**/node_modules/**/*"],
  extraResources: [
    { from: "../server/dist", to: "server", filter: ["**/*.js", "**/*.mjs", "**/*.map", "package.json"] },
    { from: "../web/dist", to: "web" },
    { from: "resources/screen", to: "screen", filter: ["**/*", "!**/*.swift", "!**/*.c", "!**/*.m", "!nimbus-input", "!nimbus-input-*", "!nimbus-see", "!nimbus-see-*"] },
  ],
  publish: {
    provider: "github",
    owner: "FredrickOdondi",
    repo: "agent-nexus",
    releaseType: "release",
  },
  mac: {
    category: "public.app-category.productivity",
    target: [
      { target: "dmg", arch: ["universal"] },
      { target: "zip", arch: ["universal"] },
    ],
    x64ArchFiles: "**/node_modules/**/*",
    signIgnore: [
      "Electron Framework\\.framework/Versions/Current",
      "Electron Framework\\.framework/Helpers",
      "Electron Framework\\.framework/Libraries",
    ],
    hardenedRuntime: signed,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize,
    extendInfo: {
      NSScreenCaptureUsageDescription: "Nimbus takes a screenshot so the agent can see this screen and click what you ask.",
    },
    extraResources: [
      { from: "resources/screen/nimbus-input", to: "screen/nimbus-input" },
      { from: "resources/screen/nimbus-see", to: "screen/nimbus-see" },
    ],
  },
  dmg: {
    title: "Nimbus",
    writeUpdateInfo: false,
  },
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
