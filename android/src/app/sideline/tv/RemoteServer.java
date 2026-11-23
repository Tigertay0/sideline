package app.sideline.tv;

import android.content.Context;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * The TV app's small web server, on the home network. It serves:
 *  - the overlay page and the phone remote (static files from assets/web),
 *  - /api/settings, /api/cmd and /api/info for the phone remote and the TV's own screen,
 *  - /api/fetch, a proxy to the four score and league APIs (the same allowlist as the Chrome extension).
 * Every /api call needs the pairing code shown on the TV (checked before any body is read, in constant time, with a
 * per-device lockout). Requests must name the TV by IP address (no DNS rebinding), and a POST must be JSON from the same
 * origin (no cross-site form posts). Each request has a hard deadline so a slow client can't hold the workers.
 */
final class RemoteServer {
    static final int PORT = 8137;
    private static final String TAG = "SidelineServer";
    private static final int MAX_BODY = 64 * 1024;
    // Sleeper's player list is 12.6 MB today and grows every season. It is streamed through, so the cap costs no memory.
    private static final int MAX_UPSTREAM = 48 * 1024 * 1024;
    private static final int MAX_HEADERS = 50;
    private static final long REQUEST_DEADLINE_MS = 5000;
    private static final int UPSTREAM_TIMEOUT_MS = 10000;
    private static final int MAX_FAILURES = 10;
    private static final long LOCKOUT_MS = 10 * 60 * 1000;
    private static final Pattern STATIC_PATH = Pattern.compile("^/(tv|src)/[A-Za-z0-9_./-]+$");
    private static final Pattern IP_HOST = Pattern.compile("^\\d{1,3}(\\.\\d{1,3}){3}:" + PORT + "$");
    private static final String CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: https://a.espncdn.com; "
            + "style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
    private static final Map<String, String> API = new HashMap<>();
    private static final Map<String, String> TYPES = new HashMap<>();

    static {
        API.put("site.api.espn.com", "/apis/site/v2/sports/football/nfl/");
        API.put("sports.core.api.espn.com", "/v2/sports/football/leagues/nfl/");   // the fast play feed
        API.put("api.sleeper.app", "/v1/");
        API.put("lm-api-reads.fantasy.espn.com", "/apis/v3/games/ffl/");
        TYPES.put("html", "text/html; charset=utf-8");
        TYPES.put("js", "text/javascript; charset=utf-8");
        TYPES.put("css", "text/css; charset=utf-8");
        TYPES.put("json", "application/json");
        TYPES.put("png", "image/png");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("woff2", "font/woff2");
    }

    /** What the server needs from the app. */
    interface Host {
        String settings();
        String saveSettings(String patchJson) throws JSONException;
        String command(String json);
        String configured();
        String token();
    }

    /** A parsed request line and headers. */
    private static final class Request {
        String method;
        String path;
        String rawQuery = "";
        Map<String, String> query = new HashMap<>();
        Map<String, String> headers = new HashMap<>();
        int length;
        long deadline;
    }

    private final Context context;
    private final Host host;
    // Small, bounded: the TV has little memory, and a flood is turned away rather than queued forever.
    private final ThreadPoolExecutor pool = new ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16));
    private final Map<String, int[]> failures = new ConcurrentHashMap<>();
    private final Map<String, Long> lockedUntil = new ConcurrentHashMap<>();
    private volatile ServerSocket socket;

    RemoteServer(Context context, Host host) {
        this.context = context.getApplicationContext();
        this.host = host;
    }

    void start() {
        Thread t = new Thread(this::acceptLoop, "sideline-server");
        t.setDaemon(true);
        t.start();
    }

    void stop() {
        try {
            if (socket != null) socket.close();
        } catch (IOException e) {
            Log.w(TAG, "closing server", e);
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        try (ServerSocket ss = new ServerSocket()) {
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(PORT));
            socket = ss;
            while (!ss.isClosed()) {
                Socket s = ss.accept();
                try {
                    pool.execute(() -> handle(s));
                } catch (RejectedExecutionException busy) {
                    closeQuietly(s);                            // full: drop it rather than pile up
                }
            }
        } catch (IOException e) {
            if (socket == null || !socket.isClosed()) Log.e(TAG, "server stopped", e);
        }
    }

    /* ---------- one request ---------- */

    private void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout((int) REQUEST_DEADLINE_MS);
            InputStream in = sock.getInputStream();
            OutputStream out = sock.getOutputStream();
            Request req = readHead(in, System.currentTimeMillis() + REQUEST_DEADLINE_MS);
            if (req == null) return;
            String peer = sock.getInetAddress().getHostAddress();
            String reason = refuse(req, peer);
            if (reason != null) { sendJson(out, reason.startsWith("Wrong") ? 403 : 400, error(reason)); return; }
            byte[] body = readExactly(in, req.length, req.deadline);
            route(req, new String(body, StandardCharsets.UTF_8), out);
        } catch (SocketTimeoutException e) {
            Log.w(TAG, "request too slow, dropped");
        } catch (IOException | NumberFormatException e) {
            Log.w(TAG, "request failed", e);
        }
    }

    private Request readHead(InputStream in, long deadline) throws IOException {
        String requestLine = readLine(in, deadline);
        if (requestLine == null) return null;
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) throw new IOException("bad request line");
        Request r = new Request();
        r.deadline = deadline;
        r.method = parts[0];
        int q = parts[1].indexOf('?');
        r.path = q < 0 ? parts[1] : parts[1].substring(0, q);
        if (q >= 0) { r.rawQuery = parts[1].substring(q); r.query = parseQuery(parts[1].substring(q + 1)); }
        int count = 0;
        for (String line = readLine(in, deadline); line != null && !line.isEmpty(); line = readLine(in, deadline)) {
            if (++count > MAX_HEADERS) throw new IOException("too many headers");
            int colon = line.indexOf(':');
            if (colon > 0) r.headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
        }
        String len = r.headers.get("content-length");
        r.length = len == null ? 0 : Integer.parseInt(len);
        return r;
    }

    /** Why this request is turned away before its body is read, or null to serve it. */
    private String refuse(Request r, String peer) {
        String hostHeader = r.headers.getOrDefault("host", "");
        // Only an IP address: a web page that rebinds its own name to the TV's address is not let in.
        if (!IP_HOST.matcher(hostHeader).matches()) return "Open the TV by its address, like the QR code does";
        String origin = r.headers.get("origin");
        // The score cards are public scores, read by another app's home page (Couch TV), so any origin may GET them.
        boolean publicGet = r.method.equals("GET") && (r.path.equals("/cards.json") || r.path.equals("/cards/match.png"));
        if (origin != null && !publicGet && !origin.equals("http://" + hostHeader)) return "Cross-site request";
        if (r.length < 0 || r.length > MAX_BODY) return "Too large";
        // Only Content-Length bodies are read, so say so rather than silently treating a chunked body as empty.
        if (r.headers.containsKey("transfer-encoding")) return "Send a Content-Length";
        if (!r.path.startsWith("/api/")) return null;
        Long until = lockedUntil.get(peer);
        if (until != null && until > System.currentTimeMillis()) return "Wrong code too many times. Wait 10 minutes.";
        if (!codeMatches(r.query.get("k"))) {
            int[] n = failures.computeIfAbsent(peer, k -> new int[1]);
            synchronized (n) {
                if (++n[0] >= MAX_FAILURES) { lockedUntil.put(peer, System.currentTimeMillis() + LOCKOUT_MS); n[0] = 0; }
            }
            return "Wrong or old code. Scan the QR code on the TV again.";
        }
        failures.remove(peer);
        if (r.method.equals("POST") && !String.valueOf(r.headers.get("content-type")).startsWith("application/json")) return "Send JSON";
        return null;
    }

    private void route(Request r, String body, OutputStream out) throws IOException {
        if (r.path.equals("/")) { redirect(out, "/tv/remote.html" + r.rawQuery); return; }
        if (r.path.equals("/cards.json") && r.method.equals("GET")) {
            // the live games row for Couch TV's home; images point back at whichever address the home used
            send(out, 200, "application/json", bytes(ScoreCards.json("http://" + r.headers.get("host"))),
                    "Access-Control-Allow-Origin: *\r\n");
            return;
        }
        if (r.path.equals("/cards/match.png") && r.method.equals("GET")) {
            String a = r.query.getOrDefault("a", ""), h = r.query.getOrDefault("h", ""), s = r.query.getOrDefault("s", "");
            if (!ScoreCards.TEAM.matcher(a).matches() || !ScoreCards.TEAM.matcher(h).matches() || !(s.isEmpty() || ScoreCards.SCORE.matcher(s).matches())) {
                send(out, 404, "text/plain", bytes("Not found"));
                return;
            }
            send(out, 200, "image/png", ScoreCards.picture(a, h, s), "Access-Control-Allow-Origin: *\r\n");
            return;
        }
        if (!r.path.startsWith("/api/")) { serveStatic(r.path, out); return; }
        try {
            if (r.path.equals("/api/info") && r.method.equals("GET")) {
                JSONObject info = new JSONObject();
                String lan = lanUrl();
                info.put("lanUrl", lan == null ? JSONObject.NULL : lan + "/?k=" + host.token());
                info.put("configured", host.configured());
                sendJson(out, 200, info.toString());
            } else if (r.path.equals("/api/settings") && r.method.equals("GET")) {
                sendJson(out, 200, host.settings());
            } else if (r.path.equals("/api/settings") && r.method.equals("POST")) {
                sendJson(out, 200, host.saveSettings(body));
            } else if (r.path.equals("/api/cmd") && r.method.equals("POST")) {
                sendJson(out, 200, host.command(new JSONObject(body).toString()));   // re-serialized: only valid JSON reaches the page
            } else if (r.path.equals("/api/fetch") && r.method.equals("GET")) {
                proxy(r.query.get("url"), out);
            } else {
                sendJson(out, 404, error("Not found"));
            }
        } catch (JSONException e) {
            sendJson(out, 400, error("That was not valid JSON"));
        }
    }

    private boolean codeMatches(String given) {
        if (given == null) return false;
        return MessageDigest.isEqual(given.getBytes(StandardCharsets.UTF_8), host.token().getBytes(StandardCharsets.UTF_8));
    }

    private void serveStatic(String path, OutputStream out) throws IOException {
        if (!STATIC_PATH.matcher(path).matches() || path.contains("..")) { send(out, 404, "text/plain", bytes("Not found")); return; }
        String ext = path.substring(path.lastIndexOf('.') + 1);
        String type = TYPES.get(ext);
        if (type == null) { send(out, 404, "text/plain", bytes("Not found")); return; }
        byte[] data;
        try (InputStream asset = context.getAssets().open("web" + path)) {
            data = readAll(asset, MAX_UPSTREAM);
        } catch (IOException e) {
            send(out, 404, "text/plain", bytes("Not found"));
            return;
        }
        send(out, 200, type, data, ext.equals("html") ? "Content-Security-Policy: " + CSP + "\r\n" : "");
    }

    /** GET one of the allowed APIs for the page, streamed through. Same allowlist and path prefixes as the extension. */
    private void proxy(String target, OutputStream out) throws IOException {
        URL url;
        try {
            url = new URL(target == null ? "" : target);
        } catch (IOException e) {
            sendJson(out, 400, error("Bad address"));
            return;
        }
        String prefix = API.get(url.getHost());
        String path = url.getPath();
        boolean dotted = path.contains("..") || path.toLowerCase(Locale.ROOT).contains("%2e");
        if (!"https".equals(url.getProtocol()) || url.getPort() != -1 || prefix == null || dotted || !path.startsWith(prefix)) {
            sendJson(out, 400, error(url.getHost() + " is not something Sideline asks for"));
            return;
        }
        boolean answered = false;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(UPSTREAM_TIMEOUT_MS);
            c.setReadTimeout(UPSTREAM_TIMEOUT_MS);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "Sideline/0.1 (Google TV)");   // ESPN answers 403 to Java's default "Java/21" agent
            int code = c.getResponseCode();
            if (code != 200) { sendJson(out, 502, error(url.getHost() + " answered " + code)); return; }
            String date = c.getHeaderField("Date");
            String head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
                    + (date == null ? "" : "X-Upstream-Date: " + date.replaceAll("[\r\n]", "") + "\r\n") + "Connection: close\r\n\r\n";
            out.write(bytes(head));
            answered = true;
            long sent = 0;
            byte[] buf = new byte[16384];
            try (InputStream in = c.getInputStream()) {
                for (int n = in.read(buf); n != -1; n = in.read(buf)) {
                    sent += n;
                    if (sent > MAX_UPSTREAM) throw new IOException("upstream response too large");
                    out.write(buf, 0, n);                         // streamed: never the whole response in memory
                }
            }
            out.flush();
        } catch (IOException e) {
            Log.w(TAG, "proxy failed for " + url.getHost(), e);
            // Nothing sent yet (DNS, refused, TLS, timeout before headers): answer like the non-200 path instead of dropping the socket.
            if (!answered) sendJson(out, 502, error(url.getHost() + " did not answer"));
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /* ---------- helpers ---------- */

    /** The address a phone on the same network should open, e.g. http://192.168.1.23:8137. */
    static String lanUrl() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return "http://" + a.getHostAddress() + ":" + PORT;
                }
            }
        } catch (IOException e) {
            Log.w(TAG, "no network address", e);
        }
        return null;
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("ok", false).put("error", message).toString();
        } catch (JSONException e) {
            return "{\"ok\":false}";
        }
    }

    private static Map<String, String> parseQuery(String q) {
        Map<String, String> m = new HashMap<>();
        for (String pair : q.split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            try {
                m.put(URLDecoder.decode(pair.substring(0, eq), "UTF-8"), URLDecoder.decode(pair.substring(eq + 1), "UTF-8"));
            } catch (IllegalArgumentException | IOException e) {
                Log.w(TAG, "bad query part", e);
            }
        }
        return m;
    }

    private static void checkDeadline(long deadline) throws SocketTimeoutException {
        if (System.currentTimeMillis() > deadline) throw new SocketTimeoutException("request deadline passed");
    }

    private static String readLine(InputStream in, long deadline) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        for (int c = in.read(); c != -1; c = in.read()) {
            checkDeadline(deadline);                              // a byte every few seconds does not buy more time
            if (c == '\n') return b.toString("UTF-8").replace("\r", "");
            if (b.size() > 8192) throw new IOException("header line too long");
            b.write(c);
        }
        return b.size() == 0 ? null : b.toString("UTF-8");
    }

    private static byte[] readExactly(InputStream in, int n, long deadline) throws IOException {
        byte[] buf = new byte[n];
        int off = 0;
        while (off < n) {
            checkDeadline(deadline);
            int r = in.read(buf, off, n - off);
            if (r < 0) throw new IOException("body ended early");
            off += r;
        }
        return buf;
    }

    private static byte[] readAll(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int r = in.read(buf); r != -1; r = in.read(buf)) {
            b.write(buf, 0, r);
            if (b.size() > limit) throw new IOException("asset too large");
        }
        return b.toByteArray();
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static void closeQuietly(Socket s) {
        try {
            s.close();
        } catch (IOException e) {
            Log.w(TAG, "closing a refused connection", e);
        }
    }

    private static void redirect(OutputStream out, String location) throws IOException {
        out.write(bytes("HTTP/1.1 302 Found\r\nLocation: " + location.replaceAll("[\r\n]", "") + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
        out.flush();
    }

    private static void sendJson(OutputStream out, int code, String json) throws IOException {
        send(out, code, "application/json", bytes(json));
    }

    private static void send(OutputStream out, int code, String type, byte[] body) throws IOException {
        send(out, code, type, body, "");
    }

    private static void send(OutputStream out, int code, String type, byte[] body, String extraHeaders) throws IOException {
        String head = "HTTP/1.1 " + code + " " + (code == 200 ? "OK" : "Error") + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "X-Content-Type-Options: nosniff\r\n"
                + "Referrer-Policy: no-referrer\r\n"               // the pairing code is in the page address
                + "Connection: close\r\n"
                + extraHeaders + "\r\n";
        out.write(bytes(head));
        out.write(body);
        out.flush();
    }
}
