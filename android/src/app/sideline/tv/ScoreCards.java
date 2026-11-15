package app.sideline.tv;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Today's NFL games as cards for another app's home screen (Couch TV's "custom cards"): live games first with their score
 * and clock, then the next kickoffs, then the latest finals. OK on a card opens YouTube TV. Each card carries a matchup
 * picture (both logos and the score) drawn here. Public scores only; nothing about the viewer's leagues is in it.
 */
final class ScoreCards {
    private static final String TAG = "SidelineCards";
    private static final String SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
    private static final String LOGO = "https://a.espncdn.com/i/teamlogos/nfl/500/%s.png";
    private static final String YOUTUBE_TV = "com.google.android.youtube.tvunplugged";
    private static final long CACHE_MS = 30_000;
    private static final int MAX_CARDS = 8;                    // Couch TV shows at most 8
    private static final long FINAL_FOR_MS = 24L * 3600_000;    // a final stays on the row for a day
    static final Pattern TEAM = Pattern.compile("^[a-z]{2,4}$");
    static final Pattern SCORE = Pattern.compile("^\\d{1,3}-\\d{1,3}$");

    private static String cached;
    private static long cachedAt;
    private static final Map<String, Bitmap> logos = new ConcurrentHashMap<>();
    private static final Map<String, byte[]> pictures = new ConcurrentHashMap<>();

    private ScoreCards() {}

    /** The cards as Couch TV's JSON, at most 30 seconds old. The base is how the home reaches this server. */
    static synchronized String json(String base) {
        long now = System.currentTimeMillis();
        if (cached != null && now - cachedAt < CACHE_MS) return cached;
        try {
            cached = build(new JSONObject(new String(get(SCOREBOARD, 4 * 1024 * 1024), StandardCharsets.UTF_8)), base, now);
            cachedAt = now;
        } catch (IOException | JSONException e) {
            Log.w(TAG, "scoreboard failed", e);
            if (cached == null) return "{\"cards\":[]}";      // keep the last good cards when ESPN does not answer
        }
        return cached;
    }

    static String build(JSONObject board, String base, long now) throws JSONException {
        JSONArray events = board.optJSONArray("events");
        List<JSONObject> live = new ArrayList<>(), next = new ArrayList<>(), done = new ArrayList<>();
        for (int i = 0; events != null && i < events.length(); i++) {
            JSONObject card = card(events.getJSONObject(i), base, now);
            if (card == null) continue;
            String state = card.optString("_state");
            if (state.equals("in")) live.add(card); else if (state.equals("pre")) next.add(card); else done.add(card);
        }
        next.sort((a, b) -> Long.compare(a.optLong("_t"), b.optLong("_t")));
        done.sort((a, b) -> Long.compare(b.optLong("_t"), a.optLong("_t")));
        JSONArray out = new JSONArray();
        for (List<JSONObject> group : Arrays.asList(live, next, done)) {   // not List.of: the app runs on Android 8
            for (JSONObject c : group) {
                if (out.length() >= MAX_CARDS) break;
                c.remove("_state");
                c.remove("_t");
                out.put(c);
            }
        }
        return new JSONObject().put("cards", out).toString();
    }

    private static JSONObject card(JSONObject ev, String base, long now) throws JSONException {
        JSONObject comp = ev.getJSONArray("competitions").getJSONObject(0);
        JSONObject status = ev.optJSONObject("status");
        JSONObject type = status == null ? null : status.optJSONObject("type");
        String state = type == null ? "pre" : type.optString("state", "pre");
        JSONObject home = null, away = null;
        JSONArray teams = comp.getJSONArray("competitors");
        for (int i = 0; i < teams.length(); i++) {
            JSONObject c = teams.getJSONObject(i);
            if ("home".equals(c.optString("homeAway"))) home = c; else away = c;
        }
        if (home == null || away == null) return null;
        long kickoff = parseTime(ev.optString("date"));
        if (state.equals("post") && kickoff > 0 && now - kickoff > FINAL_FOR_MS) return null;
        String h = abbr(home), a = abbr(away);
        if (!TEAM.matcher(h).matches() || !TEAM.matcher(a).matches()) return null;
        String hs = home.optString("score", "0"), as = away.optString("score", "0");
        String network = network(comp);
        JSONObject card = new JSONObject();
        card.put("title", cut(name(away) + " at " + name(home), 40));
        if (state.equals("pre")) {
            card.put("value", cut(kickoffText(kickoff), 24));
            card.put("subtitle", cut(network.isEmpty() ? "Kickoff" : "On " + network, 60));
        } else {
            card.put("value", cut(as + " – " + hs, 24));
            String clock = type == null ? "" : type.optString("shortDetail");
            card.put("subtitle", cut(state.equals("in") ? (network.isEmpty() ? clock : clock + " · " + network) : "Final", 60));
        }
        String score = state.equals("pre") ? "" : "&s=" + as + "-" + hs;
        card.put("image", base + "/cards/match.png?a=" + a + "&h=" + h + score);
        card.put("app", YOUTUBE_TV);
        card.put("_state", state);
        card.put("_t", kickoff);
        return card;
    }

    /** A 480 x 270 picture: the away logo, the score (or "at"), the home logo. Cached per matchup and score. */
    static byte[] picture(String away, String home, String score) throws IOException {
        String key = away + "|" + home + "|" + score;
        byte[] hit = pictures.get(key);
        if (hit != null) return hit;
        Bitmap bmp = Bitmap.createBitmap(480, 270, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        c.drawColor(Color.rgb(0x1b, 0x1f, 0x2a));
        drawLogo(c, logo(away), 20);
        drawLogo(c, logo(home), 330);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.rgb(0xf4, 0xf5, 0xf8));
        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setTextAlign(Paint.Align.CENTER);
        String text = score.isEmpty() ? "at" : score.replace("-", "–");
        p.setTextSize(score.isEmpty() ? 34 : (text.length() > 5 ? 36 : 44));
        c.drawText(text, 240, 135 - (p.descent() + p.ascent()) / 2, p);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, png);
        bmp.recycle();
        if (pictures.size() > 64) pictures.clear();             // a weekend's worth; scores change, so old ones go
        byte[] out = png.toByteArray();
        pictures.put(key, out);
        return out;
    }

    private static void drawLogo(Canvas c, Bitmap logo, int left) {
        if (logo == null) return;
        c.drawBitmap(logo, null, new Rect(left, 70, left + 130, 200), new Paint(Paint.FILTER_BITMAP_FLAG));
    }

    private static Bitmap logo(String team) {
        Bitmap b = logos.get(team);
        if (b != null) return b;
        try {
            byte[] png = get(String.format(Locale.ROOT, LOGO, team), 512 * 1024);
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inSampleSize = 2;                                     // 500 px logos, drawn at 160
            b = BitmapFactory.decodeByteArray(png, 0, png.length, o);
            if (b != null) logos.put(team, b);
        } catch (IOException e) {
            Log.w(TAG, "logo failed for " + team, e);
        }
        return b;
    }

    private static byte[] get(String address, int limit) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setRequestProperty("User-Agent", "Sideline/0.1 (Google TV)");   // ESPN answers 403 to Java's default agent
            if (c.getResponseCode() != 200) throw new IOException(address + " answered " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                for (int n = in.read(buf); n != -1; n = in.read(buf)) {
                    if (out.size() + n > limit) throw new IOException("too large");
                    out.write(buf, 0, n);
                }
                return out.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    private static String abbr(JSONObject competitor) {
        JSONObject t = competitor.optJSONObject("team");
        return t == null ? "" : t.optString("abbreviation").toLowerCase(Locale.ROOT);
    }

    private static String name(JSONObject competitor) {
        JSONObject t = competitor.optJSONObject("team");
        if (t == null) return "";
        String n = t.optString("shortDisplayName");
        return n.isEmpty() ? t.optString("abbreviation") : n;
    }

    private static String network(JSONObject comp) {
        JSONArray b = comp.optJSONArray("broadcasts");
        if (b == null || b.length() == 0) return "";
        JSONArray names = b.optJSONObject(0) == null ? null : b.optJSONObject(0).optJSONArray("names");
        return names == null || names.length() == 0 ? "" : names.optString(0);
    }

    private static long parseTime(String iso) {
        for (String f : new String[] {"yyyy-MM-dd'T'HH:mm'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"}) {
            try {
                SimpleDateFormat p = new SimpleDateFormat(f, Locale.US);
                p.setTimeZone(TimeZone.getTimeZone("UTC"));
                return p.parse(iso).getTime();
            } catch (ParseException | NullPointerException ignored) {
                // try the next shape
            }
        }
        return 0;
    }

    private static String kickoffText(long t) {
        return t <= 0 ? "Soon" : new SimpleDateFormat("EEE h:mm a", Locale.US).format(new Date(t));
    }

    private static String cut(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }
}
