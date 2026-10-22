const { withAndroidManifest, withMainActivity, AndroidConfig } = require("expo/config-plugins");

const pipMethod = `
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    expo.modules.alwaysontop.AlwaysOnTopEvents.onModeChanged(isInPictureInPictureMode)
  }
`;

/** Enables picture-in-picture for the map window and the full-screen alert overlay. */
function withAlwaysOnTop(config) {
  config = withAndroidManifest(config, (config) => {
    AndroidConfig.Permissions.ensurePermissions(config.modResults, [
      "android.permission.SYSTEM_ALERT_WINDOW",
    ]);
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    activity.$["android:supportsPictureInPicture"] = "true";
    activity.$["android:resizeableActivity"] = "true";
    const existing = activity.$["android:configChanges"] ?? "";
    const parts = existing
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.includes("smallestScreenSize")) {
      parts.push("smallestScreenSize");
    }
    activity.$["android:configChanges"] = parts.join("|");
    return config;
  });

  return withMainActivity(config, (config) => {
    if (config.modResults.language !== "kt") {
      throw new Error("Always on top expects the Expo Kotlin MainActivity.");
    }
    let contents = config.modResults.contents;
    if (!contents.includes("import android.content.res.Configuration")) {
      contents = contents.replace(
        /package [^\n]+\n/,
        (match) => `${match}\nimport android.content.res.Configuration\n`,
      );
    }
    if (!contents.includes("AlwaysOnTopEvents.onModeChanged")) {
      const end = contents.lastIndexOf("}");
      contents = `${contents.slice(0, end)}${pipMethod}${contents.slice(end)}`;
    }
    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withAlwaysOnTop;
