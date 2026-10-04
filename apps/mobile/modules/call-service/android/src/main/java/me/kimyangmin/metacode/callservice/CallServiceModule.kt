package me.kimyangmin.metacode.callservice

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS에서 통화 유지 서비스를 켜고 끈다 (start: 알림 제목·내용, stop) */
class CallServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("CallService")

    Function("start") { title: String, text: String ->
      val intent = Intent(context, CallService::class.java)
        .putExtra(CallService.EXTRA_TITLE, title)
        .putExtra(CallService.EXTRA_TEXT, text)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    Function("stop") {
      val intent = Intent(context, CallService::class.java).setAction(CallService.ACTION_STOP)
      // 이미 멈췄으면 다시 켜지 않는다 (startService가 아니라 stopService로 끝낸다)
      context.stopService(intent)
    }
  }
}
