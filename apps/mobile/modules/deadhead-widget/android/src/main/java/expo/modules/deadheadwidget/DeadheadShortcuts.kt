package expo.modules.deadheadwidget

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.util.Log
import org.json.JSONArray

internal object DeadheadShortcuts {
  private const val tag = "DeadheadShortcuts"

  fun publish(context: Context, raw: String): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) {
      return false
    }
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
    val activity = launch.component ?: return false
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return false
    val specs = parse(raw)
    val cap = manager.maxShortcutCountPerActivity.coerceAtLeast(0)
    val shortcuts = ArrayList<ShortcutInfo>()
    for (spec in specs) {
      if (shortcuts.size >= cap) {
        break
      }
      shortcuts.add(info(context, activity, spec, shortcuts.size))
    }
    return try {
      manager.dynamicShortcuts = shortcuts
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val ids = shortcuts.map { it.id }.toSet()
        val pinned = manager.pinnedShortcuts
        val updates = shortcuts.filter { item -> pinned.any { it.id == item.id } }
        if (updates.isNotEmpty()) {
          manager.enableShortcuts(updates.map { it.id })
          manager.updateShortcuts(updates)
        }
        val stale = pinned.filter { it.isEnabled && it.id !in ids }.map { it.id }
        if (stale.isNotEmpty()) {
          manager.disableShortcuts(stale, "That place is no longer saved.")
        }
      }
      true
    } catch (error: RuntimeException) {
      Log.w(tag, "Shortcuts were not published", error)
      false
    }
  }

  fun pin(context: Context, id: String, title: String, entryId: String): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return false
    }
    val trimmed = title.trim()
    if (id.isEmpty() || trimmed.isEmpty() || entryId.isEmpty()) {
      return false
    }
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
    val activity = launch.component ?: return false
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return false
    val info = info(context, activity, Spec(id, trimmed, entryId), 0)
    val pinned = manager.pinnedShortcuts.find { it.id == id }
    return try {
      if (pinned != null) {
        if (!pinned.isEnabled) {
          manager.enableShortcuts(listOf(id))
        }
        manager.updateShortcuts(listOf(info))
        true
      } else if (manager.isRequestPinShortcutSupported) {
        manager.requestPinShortcut(info, null)
      } else {
        false
      }
    } catch (error: RuntimeException) {
      Log.w(tag, "Shortcut was not pinned", error)
      false
    }
  }

  private fun info(context: Context, activity: android.content.ComponentName, spec: Spec, rank: Int): ShortcutInfo {
    val intent = Intent(Intent.ACTION_VIEW)
    intent.component = activity
    intent.data = Uri.parse("groundops://deadhead?entryId=${Uri.encode(spec.entryId)}")
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val builder = ShortcutInfo.Builder(context, spec.id)
      .setActivity(activity)
      .setShortLabel(spec.title)
      .setLongLabel(spec.title)
      .setIntent(intent)
      .setRank(rank)
    val iconId = context.applicationInfo.icon
    if (iconId != 0) {
      builder.setIcon(Icon.createWithResource(context, iconId))
    }
    return builder.build()
  }

  private fun parse(raw: String): List<Spec> {
    val array = try {
      JSONArray(raw)
    } catch (error: Exception) {
      Log.w(tag, "Shortcut list was not readable", error)
      return emptyList()
    }
    val specs = ArrayList<Spec>()
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index) ?: continue
      val id = item.optString("id")
      val title = item.optString("title").trim()
      val entryId = item.optString("entryId")
      if (id.isEmpty() || title.isEmpty() || entryId.isEmpty()) {
        continue
      }
      specs.add(Spec(id, title, entryId))
    }
    return specs
  }

  private data class Spec(val id: String, val title: String, val entryId: String)
}
