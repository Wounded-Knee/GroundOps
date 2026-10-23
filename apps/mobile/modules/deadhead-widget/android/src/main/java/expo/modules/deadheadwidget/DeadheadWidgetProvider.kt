package expo.modules.deadheadwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.widget.RemoteViews

class DeadheadWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (widgetId in appWidgetIds) {
      render(context, widgetId)
    }
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    for (widgetId in appWidgetIds) {
      DeadheadWidgetStore.clear(context, widgetId)
    }
  }

  companion object {
    fun widgetIds(context: Context): IntArray {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, DeadheadWidgetProvider::class.java)
      return manager.getAppWidgetIds(component)
    }

    fun render(context: Context, widgetId: Int) {
      val place = DeadheadWidgetStore.read(context, widgetId)
      val entryId = place?.entryId?.takeIf { it.isNotEmpty() }
      val title = place?.displayTitle?.takeIf { it.isNotEmpty() }
        ?: context.getString(R.string.deadhead_widget_label)
      val uri = if (entryId == null) {
        Uri.parse("groundops://deadhead-widget?widgetId=$widgetId")
      } else {
        Uri.parse("groundops://deadhead?entryId=${Uri.encode(entryId)}")
      }
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
      launch.action = Intent.ACTION_VIEW
      launch.data = uri
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val pending = PendingIntent.getActivity(
        context,
        widgetId,
        launch,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val views = RemoteViews(context.packageName, R.layout.deadhead_widget)
      views.setImageViewBitmap(R.id.widget_icon, appIcon(context))
      views.setContentDescription(R.id.widget_icon, title)
      views.setOnClickPendingIntent(R.id.widget_root, pending)
      views.setOnClickPendingIntent(R.id.widget_icon, pending)
      AppWidgetManager.getInstance(context).updateAppWidget(widgetId, views)
    }

    private fun appIcon(context: Context): Bitmap {
      val drawable = context.packageManager.getApplicationIcon(context.packageName)
      val size = 192
      val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      drawable.setBounds(0, 0, size, size)
      drawable.draw(canvas)
      return bitmap
    }
  }
}
