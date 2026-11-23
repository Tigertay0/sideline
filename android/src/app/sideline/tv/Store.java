package app.sideline.tv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.security.SecureRandom;

/** Settings (the same JSON the Chrome extension keeps in chrome.storage.sync) and the phone-pairing code. */
final class Store {
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O or 1/I to misread
    private static final int CODE_LENGTH = 12;                           // 60 bits, with a lockout on wrong guesses
    private static final java.util.Set<String> KEYS = new java.util.HashSet<>(java.util.Arrays.asList(
            "enabled", "sleeperUser", "espnLeagues", "stream", "nudge", "corner", "mvCorner", "size", "view", "photos", "moments", "mv"));

    // The app makes a new Store wherever it needs one (service, activity, boot receiver) over the same preferences file, so the
    // read-modify-write in merge() and the check-then-generate in token() have to lock on something all of them share.
    private static final Object LOCK = new Object();

    private final SharedPreferences prefs;

    Store(Context context) {
        prefs = context.getSharedPreferences("sideline", Context.MODE_PRIVATE);
    }

    String settings() {
        synchronized (LOCK) {
            return prefs.getString("settings", "{}");
        }
    }

    /** Shallow-merges a patch from the phone into the saved settings and returns the result, re-serialized (so it is valid JSON). */
    String merge(String patchJson) throws JSONException {
        synchronized (LOCK) {
            JSONObject current = new JSONObject(settings());
            JSONObject patch = new JSONObject(patchJson);
            for (java.util.Iterator<String> it = patch.keys(); it.hasNext(); ) {
                String key = it.next();
                if (KEYS.contains(key)) current.put(key, patch.get(key));      // unknown keys are dropped, so settings cannot grow without bound
            }
            String merged = current.toString();
            prefs.edit().putString("settings", merged).apply();
            return merged;
        }
    }

    boolean enabled() {
        try {
            return new JSONObject(settings()).optBoolean("enabled", true);
        } catch (JSONException e) {
            return true;
        }
    }

    /** What the TV says it is set up with: the Sleeper name, or how many ESPN leagues. Empty when nothing is set. */
    String configured() {
        try {
            JSONObject s = new JSONObject(settings());
            String sleeper = s.optString("sleeperUser", "");
            int espn = s.optJSONArray("espnLeagues") == null ? 0 : s.optJSONArray("espnLeagues").length();
            if (!sleeper.isEmpty()) return "Sleeper @" + sleeper + (espn > 0 ? " + " + espn + " ESPN" : "");
            return espn > 0 ? espn + " ESPN league" + (espn > 1 ? "s" : "") : "";
        } catch (JSONException e) {
            return "";
        }
    }

    /** A new pairing code: every phone has to scan the QR code again. */
    void rotateToken() {
        synchronized (LOCK) {
            prefs.edit().remove("token").commit();
        }
    }

    String token() {
        synchronized (LOCK) {
            String code = prefs.getString("token", null);
            if (code == null || code.length() != CODE_LENGTH) {
                SecureRandom random = new SecureRandom();
                StringBuilder b = new StringBuilder();
                for (int i = 0; i < CODE_LENGTH; i++) b.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
                code = b.toString();
                prefs.edit().putString("token", code).apply();
            }
            return code;
        }
    }
}
