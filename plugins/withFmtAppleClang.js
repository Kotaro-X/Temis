const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

// fmt 11.0.2 bundled by RN 0.81 fails to compile with Apple Clang 21.
// https://github.com/fmtlib/fmt/issues/4740
const marker = "    # Temis: fmt 11 Apple Clang 21 compatibility";

module.exports = (config) =>
  withDangerousMod(config, [
    "ios",
    async (config) => {
      const file = path.join(config.modRequest.platformProjectRoot, "Podfile");
      const contents = await fs.promises.readFile(file, "utf8");
      if (!contents.includes(marker)) {
        const hook = "  post_install do |installer|";
        if (!contents.includes(hook)) {
          throw new Error("Podfile post_install hook not found");
        }
        const patch = `${marker}
    fmt_header = File.join(installer.sandbox.root, 'fmt/include/fmt/base.h')
    if File.exist?(fmt_header)
      original = File.read(fmt_header)
      updated = original.sub(
        '#elif defined(__apple_build_version__) && __apple_build_version__ < 14000029L',
        '#elif defined(__apple_build_version__) && (__apple_build_version__ < 14000029L || __clang_major__ >= 21)'
      )
      if updated != original
        mode = File.stat(fmt_header).mode
        begin
          File.chmod(mode | 0200, fmt_header)
          File.write(fmt_header, updated)
        ensure
          File.chmod(mode, fmt_header)
        end
      end
    end`;
        await fs.promises.writeFile(
          file,
          contents.replace(hook, `${hook}\n${patch}`),
        );
      }
      return config;
    },
  ]);
