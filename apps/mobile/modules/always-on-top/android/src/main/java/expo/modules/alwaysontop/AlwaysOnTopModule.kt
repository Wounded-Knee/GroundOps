package expo.modules.alwaysontop

import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Rational
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.CompletableFuture
import kotlin.math.roundToInt

class FadeStopRecord : Record {
  @Field
  var r: Double = 0.0

  @Field
  var g: Double = 0.0

  @Field
  var b: Double = 0.0

  @Field
  var a: Double = 0.0

  @Field
  var position: Double = 0.0

  internal fun toFadeStop(): FadeStop {
    return FadeStop(
      r = r.roundToInt(),
      g = g.roundToInt(),
      b = b.roundToInt(),
      a = a.toFloat(),
      position = position.toFloat(),
    )
  }
}

class AlertFrame : Record {
  @Field
  var enabled: Boolean = false

  @Field
  var intensity: Double = 0.0

  @Field
  var stops: List<FadeStopRecord> = emptyList()
}

class ThrobFrame : Record {
  @Field
  var count: Double = 0.0

  @Field
  var intensity: Double = 0.0

  @Field
  var top: Boolean = true

  @Field
  var bottom: Boolean = true

  @Field
  var left: Boolean = true

  @Field
  var right: Boolean = true

  @Field
  var stops: List<FadeStopRecord> = emptyList()
}

object AlwaysOnTopEvents {
  var listener: ((Boolean) -> Unit)? = null

  fun onModeChanged(active: Boolean) {
    listener?.invoke(active)
  }
}

class AlwaysOnTopModule : Module() {
  private var eligible = false
  private var pipActive = false
  private var overlay: AlertOverlay? = null
  private var steadyEnabled = false
  private var steadyIntensity = 0f
  private var steadyStops: List<FadeStop> = emptyList()
  private val steadyEdges = AlertEdges(top = true, bottom = true, left = true, right = true)

  override fun definition() = ModuleDefinition {
    Name("AlwaysOnTop")
    Events("change")

    OnCreate {
      AlwaysOnTopEvents.listener = { active -> emit(active) }
    }

    OnActivityEntersForeground {
      applyPipParams()
      emitCurrent()
    }

    OnActivityEntersBackground {
      val activity = appContext.currentActivity ?: return@OnActivityEntersBackground
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.isInPictureInPictureMode) {
        emit(true)
      }
    }

    OnUserLeavesActivity {
      if (!eligible || Build.VERSION.SDK_INT !in Build.VERSION_CODES.O until Build.VERSION_CODES.S) {
        return@OnUserLeavesActivity
      }
      val activity = appContext.currentActivity ?: return@OnUserLeavesActivity
      try {
        if (activity.enterPictureInPictureMode(buildParams())) {
          emit(true)
        }
      } catch (_: IllegalStateException) {
      }
    }

    OnDestroy {
      AlwaysOnTopEvents.listener = null
      onMainSync {
        overlay?.remove()
      }
    }

    Function("setEligible") { next: Boolean ->
      onMainSync {
        eligible = next && supportsPip()
        applyPipParams()
      }
    }

    Function("dismiss") {
      onMainSync {
        eligible = false
        applyPipParams()
        val activity = appContext.currentActivity
        val inPip = activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.isInPictureInPictureMode
        if (pipActive || inPip) {
          emit(false)
        }
        if (inPip) {
          activity?.moveTaskToBack(true)
        }
      }
    }

    Function("isActive") {
      val activity = appContext.currentActivity ?: return@Function false
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.isInPictureInPictureMode
    }

    Function("canDrawOverlays") {
      val context = applicationContext() ?: return@Function false
      Settings.canDrawOverlays(context)
    }

    Function("promptOverlayPermission") {
      onMainSync {
        val context = applicationContext() ?: return@onMainSync
        if (Settings.canDrawOverlays(context)) {
          return@onMainSync
        }
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}"),
        )
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    Function("setFloating") { active: Boolean ->
      onMainSync {
        if (!active) {
          overlay?.cancelThrob()
          overlay?.remove()
          overlayAvailable()
          return@onMainSync
        }
        val activity = appContext.currentActivity
        val inPip = activity != null &&
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          activity.isInPictureInPictureMode
        if (!inPip) {
          overlayAvailable()
          return@onMainSync
        }
        if (!pipActive) {
          pipActive = true
          syncOverlay()
          sendEvent("change", mapOf("active" to true))
        } else {
          syncOverlay()
        }
        overlayAvailable()
      }
    }

    Function("setAlert") { frame: AlertFrame ->
      onMainSync {
        steadyEnabled = frame.enabled
        steadyIntensity = frame.intensity.toFloat()
        steadyStops = frame.stops.map { it.toFadeStop() }
        if (!overlayPermitted()) {
          overlay?.remove()
          false
        } else {
          syncOverlay()
          overlayAvailable()
        }
      }
    }

    Function("throb") { frame: ThrobFrame ->
      onMainSync {
        if (!pipActive || !overlayPermitted()) {
          return@onMainSync false
        }
        val current = overlay() ?: return@onMainSync false
        current.playThrob(
          count = frame.count.toInt(),
          intensity = frame.intensity.toFloat(),
          stops = frame.stops.map { it.toFadeStop() },
          edges = AlertEdges(frame.top, frame.bottom, frame.left, frame.right),
        ) {
          syncOverlay()
        }
      }
    }

    Function("clearAlert") {
      onMainSync {
        steadyEnabled = false
        steadyStops = emptyList()
        overlay?.cancelThrob()
        overlay?.remove()
      }
    }
  }

  private fun emitCurrent() {
    val activity = appContext.currentActivity ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    emit(activity.isInPictureInPictureMode)
  }

  private fun emit(active: Boolean) {
    val changed = pipActive != active
    pipActive = active
    if (changed) {
      if (!active) {
        overlay?.cancelThrob()
        overlay?.remove()
      } else {
        syncOverlay()
      }
    }
    sendEvent("change", mapOf("active" to active))
  }

  private fun syncOverlay() {
    val current = overlay
    if (!pipActive || !overlayPermitted()) {
      current?.cancelThrob()
      current?.remove()
      return
    }
    if (current?.isThrobbing() == true) {
      return
    }
    if (!steadyEnabled || steadyIntensity <= 0f || steadyStops.size < 2) {
      current?.remove()
      return
    }
    overlay()?.showSteady(steadyIntensity, steadyStops, steadyEdges)
  }

  private fun overlayAvailable(): Boolean {
    return overlayPermitted() && overlay?.attachFailed != true
  }

  private fun overlayPermitted(): Boolean {
    val context = applicationContext() ?: return false
    return Settings.canDrawOverlays(context)
  }

  private fun overlay(): AlertOverlay? {
    overlay?.let { return it }
    val context = applicationContext() ?: return null
    val created = AlertOverlay(context)
    overlay = created
    return created
  }

  private fun supportsPip(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return false
    }
    val context = applicationContext() ?: return false
    return context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
  }

  private fun applyPipParams() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !supportsPip()) {
      return
    }
    val activity = appContext.currentActivity ?: return
    try {
      activity.setPictureInPictureParams(buildParams())
    } catch (_: IllegalStateException) {
    }
  }

  private fun buildParams(): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(3, 4))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(eligible)
      builder.setSeamlessResizeEnabled(true)
    }
    return builder.build()
  }

  private fun applicationContext(): Context? {
    return appContext.reactContext?.applicationContext ?: appContext.currentActivity?.applicationContext
  }

  private fun <T> onMainSync(block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return block()
    }
    val result = CompletableFuture<Result<T>>()
    Handler(Looper.getMainLooper()).post {
      result.complete(runCatching(block))
    }
    return result.get().getOrThrow()
  }
}
