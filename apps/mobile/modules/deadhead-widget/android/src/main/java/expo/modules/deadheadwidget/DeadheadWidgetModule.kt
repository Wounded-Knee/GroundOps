package expo.modules.deadheadwidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DeadheadWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeadheadWidget")

    Function("places") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any>>()
      val places = ArrayList<Map<String, Any>>()
      for (widgetId in DeadheadWidgetProvider.widgetIds(context)) {
        val place = DeadheadWidgetStore.read(context, widgetId) ?: continue
        if (place.entryId.isEmpty()) {
          continue
        }
        places.add(
          mapOf(
            "widgetId" to widgetId.toDouble(),
            "entryId" to place.entryId,
            "title" to place.title,
          ),
        )
      }
      places
    }

    Function("setPlace") { widgetId: Double, title: String, entryId: String, displayTitle: String ->
      val context = appContext.reactContext ?: return@Function false
      val id = widgetId.toInt()
      DeadheadWidgetStore.write(context, id, entryId, title, displayTitle)
      DeadheadWidgetProvider.render(context, id)
      true
    }

    Function("clear") { widgetId: Double ->
      val context = appContext.reactContext ?: return@Function false
      val id = widgetId.toInt()
      DeadheadWidgetStore.clear(context, id)
      DeadheadWidgetProvider.render(context, id)
      true
    }

    Function("setShortcuts") { raw: String ->
      val context = appContext.reactContext ?: return@Function false
      DeadheadShortcuts.publish(context, raw)
    }

    Function("pin") { id: String, title: String, entryId: String ->
      val context = appContext.currentActivity ?: appContext.reactContext ?: return@Function false
      DeadheadShortcuts.pin(context, id, title, entryId)
    }
  }
}
