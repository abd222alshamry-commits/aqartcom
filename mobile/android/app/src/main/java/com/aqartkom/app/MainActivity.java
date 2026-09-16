package com.aqartkom.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.*;
import android.widget.*;

public class MainActivity extends Activity {
    private WebView web;
    private TextView status;
    private ValueCallback<Uri[]> fileCallback;
    private final Uri site = Uri.parse(BuildConfig.SITE_URL);
    private boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && site.getHost().equalsIgnoreCase(uri.getHost())
            && (uri.getPort() == -1 ? 443 : uri.getPort()) == (site.getPort() == -1 ? 443 : site.getPort());
    }
    private void external(Uri uri) {
        String scheme = uri.getScheme();
        if (!("https".equals(scheme) || "tel".equals(scheme) || "mailto".equals(scheme))) return;
        try { startActivity(new Intent("tel".equals(scheme) ? Intent.ACTION_DIAL : Intent.ACTION_VIEW, uri)); }
        catch (android.content.ActivityNotFoundException e) { Toast.makeText(this, "لا يوجد تطبيق لفتح هذا الرابط", Toast.LENGTH_LONG).show(); }
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        layout.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets;
        });
        LinearLayout toolbar = new LinearLayout(this);
        String[] labels = {"رجوع", "الرئيسية", "تحديث", "مشاركة"};
        for (int i = 0; i < labels.length; i++) {
            final int action = i; Button button = new Button(this); button.setText(labels[i]);
            button.setOnClickListener(v -> {
                if (action == 0) { if (web.canGoBack()) web.goBack(); }
                if (action == 1) web.loadUrl(site.toString());
                if (action == 2) web.reload();
                if (action == 3 && web.getUrl() != null && trusted(Uri.parse(web.getUrl()))) {
                    Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, web.getUrl());
                    startActivity(Intent.createChooser(share, "مشاركة عقارتكم"));
                }
            });
            toolbar.addView(button, new LinearLayout.LayoutParams(0, -2, 1));
        }
        layout.addView(toolbar); status = new TextView(this); status.setText("جارٍ الاتصال بعقارتكم…"); layout.addView(status);
        web = new WebView(this); layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(layout);
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " AqartkomNative/92");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl())) return false;
                if (request.isForMainFrame() && request.hasGesture()) external(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { status.setVisibility(View.VISIBLE); status.setText("جارٍ التحميل…"); }
            @Override public void onPageFinished(WebView view, String url) { if (status.getText().equals("جارٍ التحميل…")) status.setVisibility(View.GONE); CookieManager.getInstance().flush(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { status.setVisibility(View.VISIBLE); status.setText("تعذر الاتصال. تحقق من الإنترنت واضغط تحديث."); }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) { status.setVisibility(View.VISIBLE); status.setText("الخدمة غير متاحة مؤقتًا. اضغط تحديث للمحاولة."); }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (web.getUrl() == null || !trusted(Uri.parse(web.getUrl()))) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = callback;
                try { startActivityForResult(params.createIntent(), 100); }
                catch (android.content.ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(site.toString());
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 100 && fileCallback != null) { fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); fileCallback = null; }
    }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (fileCallback != null) fileCallback.onReceiveValue(null); web.destroy(); super.onDestroy(); }
}
