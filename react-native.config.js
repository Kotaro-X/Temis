const excludeLocalLlama = process.env.BUNDLE_LOCAL_LLM === "false";

module.exports = excludeLocalLlama
  ? {
      dependencies: {
        // Release builds omit the bundled model, so linking this New-Arch-only
        // native module would add an unusable startup dependency.
        "llama.rn": {
          platforms: {
            ios: null,
            android: null,
          },
        },
      },
    }
  : {};
