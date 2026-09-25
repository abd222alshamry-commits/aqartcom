package com.aqartkom.nativeapp;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import android.app.AlertDialog;
import android.webkit.JsResult;
import android.webkit.JsPromptResult;
import android.widget.EditText;
import com.aqartkom.nativeapp.data.SiteAccess;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class SiteActivity extends ComponentActivity {
    private static final int FILE_CHOOSER_REQUEST = 100;
    private static final int LOCATION_PERMISSION_REQUEST = 101;

    private WebView web;
    private boolean pageFailed;
    private String entryUrl;
    private FrameLayout root;
    private LinearLayout mainLayout;
    private TextView status;
    private ValueCallback<Uri[]> fileCallback;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private GeolocationPermissions.Callback geolocationCallback;
    private String geolocationOrigin;

    private boolean trusted(Uri uri) {
        return uri != null && SiteAccess.INSTANCE.trusted(uri.toString(), BuildConfig.API_ORIGIN);
    }

    private void external(Uri uri) {
        if (uri == null || uri.getScheme() == null) return;
        String scheme = uri.getScheme().toLowerCase();
        if (!("http".equals(scheme) || "https".equals(scheme) || "tel".equals(scheme) || "mailto".equals(scheme))) return;
        try {
            startActivity(new Intent("tel".equals(scheme) ? Intent.ACTION_DIAL : Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "لا يوجد تطبيق لفتح هذا الرابط", Toast.LENGTH_LONG).show();
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private Button toolbarButton(String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(label);
        button.setTextSize(12);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(4), 0, dp(4), 0);
        button.setOnClickListener(listener);
        return button;
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String path = getIntent().getStringExtra("path");
        entryUrl = SiteAccess.INSTANCE.serviceUrl(path == null ? "/" : path, BuildConfig.API_ORIGIN);
        if (entryUrl == null) { finish(); return; }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { goBack(); }
        });

        root = new FrameLayout(this);
        mainLayout = new LinearLayout(this);
        mainLayout.setOrientation(LinearLayout.VERTICAL);
        mainLayout.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.addView(mainLayout, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER);
        toolbar.setBackgroundColor(Color.rgb(248, 248, 248));
        mainLayout.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(42)));

        toolbar.addView(toolbarButton("رجوع", view -> goBack()), new LinearLayout.LayoutParams(0, -1, 1));
        toolbar.addView(toolbarButton("إغلاق", view -> finish()), new LinearLayout.LayoutParams(0, -1, 1));
        toolbar.addView(toolbarButton("تحديث", view -> web.reload()), new LinearLayout.LayoutParams(0, -1, 1));
        toolbar.addView(toolbarButton("مشاركة", view -> shareCurrentPage()), new LinearLayout.LayoutParams(0, -1, 1));

        status = new TextView(this);
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(8), dp(4), dp(8), dp(4));
        status.setText("جارٍ الاتصال بعقارتكم…");
        mainLayout.addView(status, new LinearLayout.LayoutParams(-1, -2));

        web = new WebView(this);
        mainLayout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        configureWebView();

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(entryUrl);
    }

    private void shareCurrentPage() {
        if (web.getUrl() == null || !trusted(Uri.parse(web.getUrl()))) return;
        Intent send = new Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, web.getUrl());
        startActivity(Intent.createChooser(send, "مشاركة عقارتكم"));
    }

    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Selected document URIs carry explicit read grants.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " AqartkomNative/" + BuildConfig.VERSION_CODE);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                if (trusted(request.getUrl())) return false;
                if (request.isForMainFrame() && request.hasGesture()) external(request.getUrl());
                return true;
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                pageFailed = false;
                status.setVisibility(View.VISIBLE);
                status.setText("جارٍ التحميل…");
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (!pageFailed) status.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    status.setVisibility(View.VISIBLE);
                    status.setText("تعذر الاتصال. تحقق من الإنترنت واضغط تحديث.");
                }
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    status.setVisibility(View.VISIBLE);
                    status.setText("الخدمة غير متاحة مؤقتًا. اضغط تحديث للمحاولة.");
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(SiteActivity.this).setMessage(message).setPositiveButton("حسنًا", (d, w) -> result.confirm()).setOnCancelListener(d -> result.cancel()).show(); return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(SiteActivity.this).setMessage(message).setPositiveButton("تأكيد", (d, w) -> result.confirm()).setNegativeButton("إلغاء", (d, w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show(); return true;
            }
            @Override public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                EditText input = new EditText(SiteActivity.this); input.setText(defaultValue);
                new AlertDialog.Builder(SiteActivity.this).setMessage(message).setView(input).setPositiveButton("حفظ", (d, w) -> result.confirm(input.getText().toString())).setNegativeButton("إلغاء", (d, w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show(); return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (web.getUrl() == null || !trusted(Uri.parse(web.getUrl()))) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(SiteActivity.this, "لا يوجد تطبيق لاختيار الملف", Toast.LENGTH_LONG).show();
                }
                return true;
            }

            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                mainLayout.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                setFullscreenBars(true);
            }

            @Override public void onHideCustomView() {
                exitFullscreen();
            }

            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                Uri originUri = Uri.parse(origin);
                if (!trusted(originUri)) {
                    callback.invoke(origin, false, false);
                    return;
                }
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                geolocationOrigin = origin;
                geolocationCallback = callback;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION_REQUEST);
            }
        });
    }

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        mainLayout.setVisibility(View.VISIBLE);
        setFullscreenBars(false);
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }

    @SuppressWarnings("deprecation")
    private void setFullscreenBars(boolean hide) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) return;
            if (hide) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                controller.show(WindowInsets.Type.systemBars());
            }
            return;
        }
        getWindow().getDecorView().setSystemUiVisibility(hide
            ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            : View.SYSTEM_UI_FLAG_VISIBLE);
    }

    private void goBack() {
        if (fullscreenView != null) exitFullscreen();
        else if (web.canGoBack()) web.goBack();
        else finish();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            java.util.ArrayList<Uri> safe = new java.util.ArrayList<>();
            if (selected != null) for (Uri uri : selected) if ("content".equals(uri.getScheme())) safe.add(uri);
            fileCallback.onReceiveValue(safe.isEmpty() ? null : safe.toArray(new Uri[0]));
            fileCallback = null;
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_PERMISSION_REQUEST && geolocationCallback != null) {
            boolean allowed = false;
            for (int result : grantResults) allowed |= result == PackageManager.PERMISSION_GRANTED;
            geolocationCallback.invoke(geolocationOrigin, allowed, false);
            geolocationCallback = null;
            geolocationOrigin = null;
        }
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override protected void onPause() { if (web != null) { web.onPause(); CookieManager.getInstance().flush(); } super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (geolocationCallback != null) geolocationCallback.invoke(geolocationOrigin, false, false);
        exitFullscreen();
        if (web != null) { web.stopLoading(); ((android.view.ViewGroup) web.getParent()).removeView(web); web.destroy(); }
        super.onDestroy();
    }
}
