package br.com.mydeliveryfood.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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

    private static final String APP_URL = "https://mydeliveryfood.com.br/login.html";
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        // WebViewClient que repassa esquemas NÃO-http pro sistema: rawbt:
        // (impressão Bluetooth via RawBT), tel:, mailto:, whatsapp:, intent:...
        // Sem isso, a WebView tenta abrir "rawbt:..." como página e o cupom não
        // sai. http/https continuam na WebView (o próprio site).
        web.setWebViewClient(new WebViewClient() {
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

        if (savedInstanceState == null) {
            web.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        web.restoreState(savedInstanceState);
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
