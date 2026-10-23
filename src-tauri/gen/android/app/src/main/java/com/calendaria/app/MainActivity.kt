package com.calendaria.app

import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var multicast: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Keep the app clear of the status bar, the gesture bar and the keyboard;
    // edge-to-edge would otherwise draw the page underneath them.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    // From Android 17, reaching the PCs at home (and finding them) needs the
    // "nearby devices" permission; without it connections just time out.
    if (Build.VERSION.SDK_INT >= 37 && checkSelfPermission(LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(LOCAL_NETWORK), 1)
    }
  }

  private companion object {
    const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"
  }

  // Android drops multicast packets unless an app asks for them, which is how
  // the PCs announce themselves (mDNS). Only held while the app is open.
  override fun onResume() {
    super.onResume()
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicast = wifi.createMulticastLock("calendaria-sync").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onPause() {
    multicast?.release()
    multicast = null
    super.onPause()
  }
}
