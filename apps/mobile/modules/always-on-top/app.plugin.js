const { withAndroidManifest, withMainActivity, AndroidConfig } = require("expo/config-plugins");

const legacyPipMethod =
  /\n  override fun onPictureInPictureModeChanged\(isInPictureInPictureMode: Boolean, newConfig: Configuration\) \{\n    super\.onPictureInPictureModeChanged\(isInPictureInPictureMode, newConfig\)\n    expo\.modules\.alwaysontop\.AlwaysOnTopEvents\.onModeChanged\(isInPictureInPictureMode\)\n  \}\n/;

const guidanceLifecycle = `
  private var guidanceKeptAlive = false

  override fun onPause() {
    super.onPause()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode) {
      keepGuidanceRunning()
    }
  }

  override fun onResume() {
    guidanceKeptAlive = false
    super.onResume()
  }

  override fun onStop() {
    if (guidanceKeptAlive) {
      dispatchMapViews(window.decorView, false)
      reactHost?.onHostPause(this)
      guidanceKeptAlive = false
    }
    super.onStop()
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    if (isInPictureInPictureMode) {
      keepGuidanceRunning()
    } else {
      restoreWindowAfterPip()
    }
    expo.modules.alwaysontop.AlwaysOnTopEvents.onModeChanged(isInPictureInPictureMode)
  }

  private fun keepGuidanceRunning() {
    guidanceKeptAlive = true
    reactHost?.onHostResume(this, this)
    dispatchMapViews(window.decorView, true)
  }

  private fun dispatchMapViews(view: View, resume: Boolean) {
    if (isMapView(view)) {
      val method = if (resume) "onResume" else "onPause"
      try {
        view.javaClass.getMethod(method).invoke(view)
      } catch (_: ReflectiveOperationException) {
      } catch (_: RuntimeException) {
      }
      return
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        dispatchMapViews(view.getChildAt(index), resume)
      }
    }
  }

  private var windowRestoreListener: android.view.ViewTreeObserver.OnGlobalLayoutListener? = null

  private fun restoreWindowAfterPip() {
    val decor = window.decorView
    windowRestoreListener?.let { existing ->
      if (decor.viewTreeObserver.isAlive) {
        decor.viewTreeObserver.removeOnGlobalLayoutListener(existing)
      }
    }
    val listener = object : android.view.ViewTreeObserver.OnGlobalLayoutListener {
      override fun onGlobalLayout() {
        if (!publishExpandedWindow()) {
          return
        }
        if (decor.viewTreeObserver.isAlive) {
          decor.viewTreeObserver.removeOnGlobalLayoutListener(this)
        }
        if (windowRestoreListener === this) {
          windowRestoreListener = null
        }
      }
    }
    windowRestoreListener = listener
    decor.viewTreeObserver.addOnGlobalLayoutListener(listener)
    decor.requestLayout()
  }

  private fun publishExpandedWindow(): Boolean {
    val decor = window.decorView
    var width = decor.width
    var height = decor.height
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = windowManager.currentWindowMetrics.bounds
      if (bounds.height() > height) {
        width = bounds.width()
        height = bounds.height()
      }
    }
    val metricsWidth = resources.displayMetrics.widthPixels
    val metricsHeight = resources.displayMetrics.heightPixels
    if (height <= metricsHeight + 8 && width <= metricsWidth + 8) {
      return false
    }
    val windowMetrics = android.util.DisplayMetrics()
    windowMetrics.setTo(resources.displayMetrics)
    windowMetrics.widthPixels = width
    windowMetrics.heightPixels = height
    if (!com.facebook.react.views.view.isEdgeToEdgeFeatureFlagOn) {
      androidx.core.view.ViewCompat.getRootWindowInsets(decor)?.let { insets ->
        val bars = insets.getInsets(
          androidx.core.view.WindowInsetsCompat.Type.systemBars() or
            androidx.core.view.WindowInsetsCompat.Type.displayCutout(),
        )
        windowMetrics.widthPixels -= bars.left + bars.right
        windowMetrics.heightPixels -= bars.top + bars.bottom
      }
    }
    if (windowMetrics.heightPixels <= metricsHeight) {
      return false
    }
    com.facebook.react.uimanager.DisplayMetricsHolder.setWindowDisplayMetrics(windowMetrics)
    val context = reactHost?.currentReactContext ?: return false
    val windowMap = com.facebook.react.bridge.Arguments.createMap()
    windowMap.putInt("width", windowMetrics.widthPixels)
    windowMap.putInt("height", windowMetrics.heightPixels)
    windowMap.putDouble("scale", windowMetrics.density.toDouble())
    windowMap.putDouble("fontScale", resources.configuration.fontScale.toDouble())
    windowMap.putDouble("densityDpi", windowMetrics.densityDpi.toDouble())
    val screen = com.facebook.react.uimanager.DisplayMetricsHolder.getScreenDisplayMetrics()
    val screenMap = com.facebook.react.bridge.Arguments.createMap()
    screenMap.putInt("width", screen.widthPixels)
    screenMap.putInt("height", screen.heightPixels)
    screenMap.putDouble("scale", screen.density.toDouble())
    screenMap.putDouble("fontScale", resources.configuration.fontScale.toDouble())
    screenMap.putDouble("densityDpi", screen.densityDpi.toDouble())
    val payload = com.facebook.react.bridge.Arguments.createMap()
    payload.putMap("windowPhysicalPixels", windowMap)
    payload.putMap("screenPhysicalPixels", screenMap)
    context.emitDeviceEvent("didUpdateDimensions", payload)
    return true
  }

  private fun isMapView(view: View): Boolean {
    var type: Class<*>? = view.javaClass
    while (type != null) {
      if (type.name == "com.google.android.gms.maps.MapView") {
        return true
      }
      type = type.superclass
    }
    return false
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
    contents = ensureImport(contents, "import android.content.res.Configuration");
    contents = ensureImport(contents, "import android.view.View");
    contents = ensureImport(contents, "import android.view.ViewGroup");
    if (!contents.includes("guidanceKeptAlive")) {
      contents = contents.replace(legacyPipMethod, "\n");
      const end = contents.lastIndexOf("}");
      contents = `${contents.slice(0, end)}${guidanceLifecycle}${contents.slice(end)}`;
    }
    config.modResults.contents = contents;
    return config;
  });
}

function ensureImport(contents, statement) {
  if (contents.includes(statement)) {
    return contents;
  }
  return contents.replace(/package [^\n]+\n/, (match) => `${match}\n${statement}\n`);
}

module.exports = withAlwaysOnTop;
