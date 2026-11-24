package com.arsalan.expenses;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Thin shell: shows the hosted web app full screen. All features live in the web app,
 * so pushing to GitHub Pages updates the app without reinstalling this APK.
 */
public class MainActivity extends Activity {
    private WebView webView;
    private final String appUrl = BuildConfig.APP_URL;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                Uri app = Uri.parse(appUrl);
                if (app.getHost() != null && app.getHost().equals(uri.getHost())) return false;
                // Anything else (e.g. links to the Sheet) opens in the browser.
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadData(
                        "<html><body style='font-family:sans-serif;text-align:center;padding:40px'>"
                        + "<h3>Can't reach the app</h3><p>Check your connection.</p>"
                        + "<button style='padding:12px 20px;font-size:16px' onclick=\"location.href='" + appUrl + "'\">Retry</button>"
                        + "</body></html>", "text/html", "UTF-8");
                }
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(appUrl);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // Let the web app close its edit dialog first, then fall back to normal back.
        webView.evaluateJavascript(
            "(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return true;}"
            + "if(location.hash&&location.hash!=='#add'){document.querySelector('.tabbar button[data-view=add]').click();return true;}"
            + "return false;})()",
            handled -> {
                if (!"true".equals(handled)) MainActivity.super.onBackPressed();
            });
    }
}
