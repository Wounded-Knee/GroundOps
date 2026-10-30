package expo.modules.alwaysontop

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Shader
import android.hardware.input.InputManager
import android.os.Build
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.Interpolator
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.AnimatorSet
import android.animation.ValueAnimator
import kotlin.math.min
import kotlin.math.roundToInt

internal data class FadeStop(
  val r: Int,
  val g: Int,
  val b: Int,
  val a: Float,
  val position: Float,
) {
  fun argb(paintAlpha: Float): Int {
    return Color.argb(
      (paintAlpha.coerceIn(0f, 1f) * 255f).roundToInt(),
      r.coerceIn(0, 255),
      g.coerceIn(0, 255),
      b.coerceIn(0, 255),
    )
  }
}

/**
 * Stop alpha that still looks like [stopAlpha] after the window multiplies by [windowAlpha].
 * The result is clamped to 1, so a stop brighter than the pass-through cap cannot exceed it.
 */
internal fun touchSafePaintAlpha(stopAlpha: Float, pulse: Float, windowAlpha: Float): Float {
  if (windowAlpha <= 0f) {
    return 0f
  }
  return (stopAlpha.coerceIn(0f, 1f) * pulse.coerceIn(0f, 1f) / windowAlpha).coerceIn(0f, 1f)
}

internal data class AlertEdges(
  val top: Boolean,
  val bottom: Boolean,
  val left: Boolean,
  val right: Boolean,
)

/** One throb is 375ms, split into the rise and the fall used by VisualAlert. */
private const val THROB_UP_MS = 188L
private const val THROB_DOWN_MS = 187L

private val easeInOutQuad = Interpolator { fraction ->
  val t = fraction.coerceIn(0f, 1f)
  if (t < 0.5f) 2f * t * t else -1f + (4f - 2f * t) * t
}

internal class AlertOverlay(context: Context) {
  private val windowManager = context.getSystemService(WindowManager::class.java)
  private val view = AlertOverlayView(context)
  private var attached = false
  var attachFailed = false
    private set
  private var throbAnimator: Animator? = null

  fun isThrobbing(): Boolean = throbAnimator != null

  /** Drops a failed or picture-in-picture-sized window so the next show uses the full display. */
  fun reattach() {
    attachFailed = false
    remove()
  }

  fun showSteady(intensity: Float, stops: List<FadeStop>, edges: AlertEdges) {
    if (throbAnimator != null) {
      return
    }
    if (!ensureAttached()) {
      return
    }
    view.alpha = 1f
    view.setPulse(1f)
    view.render(intensity, stops, edges)
  }

  fun playThrob(
    count: Int,
    intensity: Float,
    stops: List<FadeStop>,
    edges: AlertEdges,
    onEnd: () -> Unit,
  ): Boolean {
    if (count <= 0 || stops.size < 2 || !ensureAttached()) {
      return false
    }
    cancelThrob()
    view.alpha = 1f
    view.setPulse(0f)
    view.render(intensity, stops, edges)
    val pulses = ArrayList<Animator>(count)
    repeat(count) {
      pulses.add(pulse())
    }
    val set = AnimatorSet()
    set.playSequentially(pulses)
    set.addListener(
      object : AnimatorListenerAdapter() {
        private var cancelled = false

        override fun onAnimationCancel(animation: Animator) {
          cancelled = true
        }

        override fun onAnimationEnd(animation: Animator) {
          if (cancelled || throbAnimator !== set) {
            return
          }
          throbAnimator = null
          onEnd()
        }
      },
    )
    throbAnimator = set
    set.start()
    return true
  }

  fun cancelThrob() {
    val previous = throbAnimator
    throbAnimator = null
    previous?.cancel()
  }

  fun remove() {
    cancelThrob()
    if (!attached) {
      return
    }
    try {
      windowManager.removeView(view)
    } catch (_: IllegalArgumentException) {
    }
    attached = false
  }

  private fun ensureAttached(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      attachFailed = true
      return false
    }
    val params = displayLayoutParams() ?: return false
    if (attached) {
      return updateAttached(params)
    }
    if (attachFailed) {
      return false
    }
    return try {
      windowManager.addView(view, params)
      attached = true
      attachFailed = false
      true
    } catch (_: RuntimeException) {
      attachFailed = true
      attached = false
      false
    }
  }

  private fun updateAttached(params: WindowManager.LayoutParams): Boolean {
    return try {
      windowManager.updateViewLayout(view, params)
      true
    } catch (_: RuntimeException) {
      attached = false
      try {
        windowManager.removeView(view)
      } catch (_: RuntimeException) {
      }
      try {
        windowManager.addView(view, params)
        attached = true
        attachFailed = false
        true
      } catch (_: RuntimeException) {
        attachFailed = true
        false
      }
    }
  }

  private fun displayLayoutParams(): WindowManager.LayoutParams? {
    val (widthPx, heightPx) = realDisplaySize()
    if (widthPx <= 0 || heightPx <= 0) {
      return null
    }
    val params = WindowManager.LayoutParams(
      widthPx,
      heightPx,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      PixelFormat.TRANSLUCENT,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    params.gravity = Gravity.TOP or Gravity.START
    params.x = 0
    params.y = 0
    val windowAlpha = passThroughAlpha()
    params.alpha = windowAlpha
    view.setWindowAlpha(windowAlpha)
    return params
  }

  /**
   * Android 12 and later drop a pass-through touch when this overlay's window alpha is above
   * the value returned here. The flash is drawn in the paint so this alpha never changes with it.
   */
  private fun passThroughAlpha(): Float {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return 1f
    }
    val input = view.context.getSystemService(InputManager::class.java) ?: return 0.8f
    return input.maximumObscuringOpacityForTouch.coerceIn(0f, 1f)
  }

  private fun realDisplaySize(): Pair<Int, Int> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds: Rect = windowManager.maximumWindowMetrics.bounds
      return bounds.width() to bounds.height()
    }
    val metrics = DisplayMetrics()
    @Suppress("DEPRECATION")
    windowManager.defaultDisplay.getRealMetrics(metrics)
    return metrics.widthPixels to metrics.heightPixels
  }

  private fun pulse(): Animator {
    val up = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = THROB_UP_MS
      interpolator = easeInOutQuad
      addUpdateListener { view.setPulse(it.animatedValue as Float) }
    }
    val down = ValueAnimator.ofFloat(1f, 0f).apply {
      duration = THROB_DOWN_MS
      interpolator = easeInOutQuad
      addUpdateListener { view.setPulse(it.animatedValue as Float) }
    }
    return AnimatorSet().apply { playSequentially(up, down) }
  }
}

internal class AlertOverlayView(context: Context) : View(context) {
  private var intensity = 0f
  private var pulse = 1f
  private var windowAlpha = 1f
  private var stops: List<FadeStop> = emptyList()
  private var edges = AlertEdges(top = true, bottom = true, left = true, right = true)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

  init {
    alpha = 1f
    setWillNotDraw(false)
    setBackgroundColor(Color.TRANSPARENT)
  }

  fun setPulse(value: Float) {
    val next = value.coerceIn(0f, 1f)
    if (pulse == next) {
      return
    }
    pulse = next
    invalidate()
  }

  fun setWindowAlpha(value: Float) {
    val next = value.coerceIn(0f, 1f)
    if (windowAlpha == next) {
      return
    }
    windowAlpha = next
    invalidate()
  }

  fun render(intensity: Float, stops: List<FadeStop>, edges: AlertEdges) {
    this.intensity = intensity
    this.stops = stops
    this.edges = edges
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val depth = intensity * min(width, height) / 2f
    if (depth <= 0f || stops.size < 2) {
      return
    }
    val colors = IntArray(stops.size) {
      stops[it].argb(touchSafePaintAlpha(stops[it].a, pulse, windowAlpha))
    }
    val positions = FloatArray(stops.size) { stops[it].position }
    val widthPx = width.toFloat()
    val heightPx = height.toFloat()
    if (edges.top) {
      drawBand(canvas, colors, positions, 0f, 0f, 0f, depth, 0f, 0f, widthPx, depth)
    }
    if (edges.bottom) {
      drawBand(canvas, colors, positions, 0f, heightPx, 0f, heightPx - depth, 0f, heightPx - depth, widthPx, heightPx)
    }
    if (edges.left) {
      drawBand(canvas, colors, positions, 0f, 0f, depth, 0f, 0f, 0f, depth, heightPx)
    }
    if (edges.right) {
      drawBand(canvas, colors, positions, widthPx, 0f, widthPx - depth, 0f, widthPx - depth, 0f, widthPx, heightPx)
    }
  }

  private fun drawBand(
    canvas: Canvas,
    colors: IntArray,
    positions: FloatArray,
    x0: Float,
    y0: Float,
    x1: Float,
    y1: Float,
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
  ) {
    paint.shader = LinearGradient(x0, y0, x1, y1, colors, positions, Shader.TileMode.CLAMP)
    canvas.drawRect(left, top, right, bottom, paint)
  }
}
