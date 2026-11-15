package app.sideline.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Puts the box back after the TV restarts or Sideline is updated, unless "Sideline on" was switched off. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        if (new Store(context).enabled()) context.startForegroundService(new Intent(context, OverlayService.class));
    }
}
