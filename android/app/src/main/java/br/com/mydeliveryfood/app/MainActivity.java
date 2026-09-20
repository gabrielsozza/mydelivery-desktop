package br.com.mydeliveryfood.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.Bitmap;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * MyDelivery Android — app nativo que abre o painel (mydeliveryfood.com.br)
 * numa WebView em tela cheia, sem barra de navegador. Mesma ideia do app
 * desktop: o app é real (ícone próprio, aparece na gaveta), o conteúdo vem
 * do site — então toda novidade do sistema entra sozinha.
 */
public class MainActivity extends Activity {

    private static final String APP_URL = PageLoadRecovery.LOGIN_URL;
    private WebView web;
    private LinearLayout connectionPanel;
    private TextView connectionMessage;
    private boolean loadFailed, paused;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final PageLoadRecovery recovery = new PageLoadRecovery();
    private Runnable retryTask;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        createConnectionPanel(root);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Fetch cross-origin da API HTTPS a partir de páginas HTTPS estava
        // sendo bloqueado silenciosamente em alguns WebViews (garçom via "Erro
        // de conexão"). Liberar mixed content permite o request fluir em
        // dispositivos com WebView antigo/estrito.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        // Debug remoto no Chrome (chrome://inspect) — ajuda a diagnosticar
        // "Erro de conexão" reportado por garçom sem acesso ao aparelho.
        WebView.setWebContentsDebuggingEnabled(true);

        // WebViewClient que repassa esquemas NÃO-http pro sistema: rawbt:
        // (impressão Bluetooth via RawBT), tel:, mailto:, whatsapp:, intent:...
        // Sem isso, a WebView tenta abrir "rawbt:..." como página e o cupom não
        // sai. http/https continuam na WebView (o próprio site).
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                cancelRetry();
                loadFailed = false;
                // Keep the native panel until the replacement page actually loads.
            }
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                if (!loadFailed) {
                    connectionPanel.setVisibility(View.GONE);
                    recovery.reset();
                }
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                loadFailed = true;
                long delay = recovery.nextDelay(true, request.getUrl().toString(), request.getMethod(), error.getErrorCode());
                showConnectionFailure(error.getErrorCode(), delay);
            }
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (!request.isForMainFrame()) return;
                loadFailed = true;
                showConnectionFailure(response.getStatusCode(), -1);
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return abrirExterno(request.getUrl().toString());
            }
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return abrirExterno(url);
            }
            private boolean abrirExterno(String url) {
                if (url == null) return false;
                if (url.startsWith("http://") || url.startsWith("https://")) return false;
                try {
                    Intent intent = url.startsWith("intent:")
                            ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                            : new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    MainActivity.this.startActivity(intent);
                } catch (Exception e) {
                    // Sem app pra abrir o esquema (ex.: RawBT não instalado) —
                    // ignora sem travar a WebView.
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void createConnectionPanel(FrameLayout root) {
        connectionPanel = new LinearLayout(this);
        connectionPanel.setOrientation(LinearLayout.VERTICAL);
        connectionPanel.setGravity(Gravity.CENTER);
        connectionPanel.setPadding(dp(28), dp(24), dp(28), dp(24));
        connectionPanel.setBackgroundColor(Color.WHITE);
        TextView brand = new TextView(this);
        brand.setText("MyDelivery");
        brand.setTextColor(Color.rgb(255, 106, 0));
        brand.setTextSize(26);
        brand.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        connectionPanel.addView(brand);
        TextView title = new TextView(this);
        title.setText("Vamos reconectar");
        title.setTextSize(21);
        title.setTextColor(Color.rgb(35, 35, 35));
        title.setPadding(0, dp(22), 0, dp(10));
        connectionPanel.addView(title);
        connectionMessage = new TextView(this);
        connectionMessage.setTextSize(16);
        connectionMessage.setGravity(Gravity.CENTER);
        connectionMessage.setTextColor(Color.rgb(85, 85, 85));
        connectionPanel.addView(connectionMessage);
        Button retry = new Button(this);
        retry.setText("Tentar novamente");
        retry.setAllCaps(false);
        retry.setTextColor(Color.WHITE);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(255, 106, 0));
        background.setCornerRadius(dp(12));
        retry.setBackground(background);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, dp(52));
        buttonParams.topMargin = dp(24);
        connectionPanel.addView(retry, buttonParams);
        retry.setOnClickListener(v -> retryLogin());
        Button browser = new Button(this);
        browser.setText("Abrir no navegador");
        browser.setAllCaps(false);
        browser.setTextColor(Color.rgb(210, 80, 0));
        browser.setBackgroundColor(Color.TRANSPARENT);
        connectionPanel.addView(browser, new LinearLayout.LayoutParams(-1, dp(52)));
        browser.setOnClickListener(v -> {
            cancelRetry();
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL))); }
            catch (Exception error) { Toast.makeText(this, "Nenhum navegador disponível neste aparelho.", Toast.LENGTH_LONG).show(); }
        });
        connectionPanel.setVisibility(View.GONE);
        root.addView(connectionPanel, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showConnectionFailure(int code, long delay) {
        cancelRetry();
        connectionPanel.setVisibility(View.VISIBLE);
        String message = code == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE
                ? "Não foi possível estabelecer uma conexão segura. Confira a data e a hora do tablet e atualize o Chrome e o Android System WebView."
                : "A conexão foi interrompida ao abrir o MyDelivery. Confira o Wi-Fi ou tente outra rede.";
        connectionMessage.setText(message + (delay >= 0 ? "\n\nTentando reconectar…" : "\n\nToque abaixo para tentar novamente.") + "\nCódigo: " + code);
        if (delay >= 0 && !paused) {
            retryTask = () -> {
                retryTask = null;
                if (!paused && loadFailed) web.loadUrl(APP_URL);
            };
            handler.postDelayed(retryTask, delay);
        }
    }

    private void cancelRetry() {
        if (retryTask != null) handler.removeCallbacks(retryTask);
        retryTask = null;
    }

    private void retryLogin() {
        cancelRetry();
        recovery.reset();
        connectionMessage.setText("Conectando ao MyDelivery…");
        web.loadUrl(APP_URL);
    }

    @Override protected void onPause() {
        paused = true;
        cancelRetry();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        paused = false;
        if (loadFailed) connectionMessage.setText("Confira sua conexão e toque em Tentar novamente.");
    }

    @Override protected void onDestroy() {
        cancelRetry();
        web.destroy();
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
