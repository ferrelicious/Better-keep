package com.betterkeep.app;

import android.content.ClipData;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private volatile String pendingShareJson = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.addJavascriptInterface(new ShareJsBridge(), "BetterKeepNativeShare");
        }
        handleShareIntent(getIntent(), false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent, true);
    }

    public class ShareJsBridge {
        @JavascriptInterface
        public String consumePendingShare() {
            String payload = pendingShareJson;
            pendingShareJson = null;
            return payload;
        }
    }

    private void handleShareIntent(Intent intent, boolean dispatchToRunningWebView) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        if (!Intent.ACTION_SEND.equals(action) || type == null) return;

        try {
            JSONObject payload = new JSONObject();
            payload.put("shareId", System.currentTimeMillis());

            if (type.startsWith("text/")) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (sharedText == null || sharedText.trim().isEmpty()) return;
                payload.put("type", "text");
                payload.put("text", sharedText);
            } else if (type.startsWith("image/")) {
                Uri imageUri = extractImageUri(intent);
                if (imageUri == null) return;

                String resolvedMime = getContentResolver().getType(imageUri);
                if (resolvedMime == null || !resolvedMime.startsWith("image/")) {
                    resolvedMime = type;
                }

                byte[] rawBytes = readUriBytes(imageUri);
                if (rawBytes == null || rawBytes.length == 0) return;

                // Keep screenshots under ~1.8 MB while preserving sharp OCR readability
                if (rawBytes.length > 1_800_000) {
                    Bitmap bitmap = BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.length);
                    if (bitmap != null) {
                        int maxDim = 1600;
                        int w = bitmap.getWidth();
                        int h = bitmap.getHeight();
                        if (w > maxDim || h > maxDim) {
                            float scale = Math.min((float) maxDim / w, (float) maxDim / h);
                            Bitmap scaled = Bitmap.createScaledBitmap(
                                bitmap,
                                Math.round(w * scale),
                                Math.round(h * scale),
                                true
                            );
                            if (scaled != bitmap) {
                                bitmap.recycle();
                                bitmap = scaled;
                            }
                        }
                        ByteArrayOutputStream compressedOut = new ByteArrayOutputStream();
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 88, compressedOut);
                        bitmap.recycle();
                        rawBytes = compressedOut.toByteArray();
                        resolvedMime = "image/jpeg";
                    }
                }

                String base64 = Base64.encodeToString(rawBytes, Base64.NO_WRAP);
                payload.put("type", "image");
                payload.put("mimeType", resolvedMime);
                payload.put("base64", base64);

                String extraText = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (extraText != null && !extraText.trim().isEmpty()) {
                    payload.put("text", extraText);
                }
            } else {
                return;
            }

            String jsonString = payload.toString();
            pendingShareJson = jsonString;
            intent.setAction(null);

            if (dispatchToRunningWebView && getBridge() != null) {
                final String script =
                    "window.dispatchEvent(new CustomEvent('app-shared-content', { detail: " +
                    jsonString +
                    " }));";
                runOnUiThread(() -> {
                    if (getBridge() != null) {
                        getBridge().eval(script, null);
                    }
                });
            }
        } catch (Exception ignored) {
            // Safely ignore unreadable or revoked external content URIs
        }
    }

    @SuppressWarnings("deprecation")
    private Uri extractImageUri(Intent intent) {
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri != null) return uri;
        ClipData clip = intent.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            return clip.getItemAt(0).getUri();
        }
        return null;
    }

    private byte[] readUriBytes(Uri uri) {
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is == null) return null;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int nRead;
            while ((nRead = is.read(chunk, 0, chunk.length)) != -1) {
                buffer.write(chunk, 0, nRead);
            }
            return buffer.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }
}
