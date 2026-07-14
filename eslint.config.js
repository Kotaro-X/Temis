const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      ".expo/**",
      "dist/**",
      "web-build/**",
      "ios/**",
      "android/**",
      "_misplaced_root_backup_*/**",
      "firestore-debug.log",
    ],
  },
  ...expoConfig,
  {
    rules: {
      // React Compiler diagnostics are being introduced separately from this
      // CI baseline. Keep the established app behavior unchanged here while
      // retaining the standard Hooks dependency and TypeScript lint rules.
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
