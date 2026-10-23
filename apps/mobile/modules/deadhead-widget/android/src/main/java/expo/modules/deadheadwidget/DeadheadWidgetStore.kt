package expo.modules.deadheadwidget

import android.content.Context

internal data class DeadheadWidgetPlace(
  val widgetId: Int,
  val entryId: String,
  val title: String,
  val displayTitle: String,
)

internal object DeadheadWidgetStore {
  private const val prefsName = "groundops.deadheadWidget"

  fun read(context: Context, widgetId: Int): DeadheadWidgetPlace? {
    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    if (!prefs.contains(entryKey(widgetId))) {
      return null
    }
    return DeadheadWidgetPlace(
      widgetId = widgetId,
      entryId = prefs.getString(entryKey(widgetId), "") ?: "",
      title = prefs.getString(titleKey(widgetId), "") ?: "",
      displayTitle = prefs.getString(displayKey(widgetId), "") ?: "",
    )
  }

  fun write(context: Context, widgetId: Int, entryId: String, title: String, displayTitle: String) {
    context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit()
      .putString(entryKey(widgetId), entryId)
      .putString(titleKey(widgetId), title)
      .putString(displayKey(widgetId), displayTitle)
      .commit()
  }

  fun clear(context: Context, widgetId: Int) {
    context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit()
      .remove(entryKey(widgetId))
      .remove(titleKey(widgetId))
      .remove(displayKey(widgetId))
      .commit()
  }

  private fun entryKey(widgetId: Int) = "entry.$widgetId"
  private fun titleKey(widgetId: Int) = "title.$widgetId"
  private fun displayKey(widgetId: Int) = "display.$widgetId"
}
