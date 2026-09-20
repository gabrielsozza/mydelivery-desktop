package br.com.mydeliveryfood.app;

/** Only retries the initial, read-only login request; never resubmits a form. */
final class PageLoadRecovery {
    static final String LOGIN_URL = "https://mydeliveryfood.com.br/login.html";
    private int attempts;

    long nextDelay(boolean mainFrame, String url, String method, int errorCode) {
        boolean connectionError = errorCode == -2 || errorCode == -6
                || errorCode == -7 || errorCode == -8;
        if (!mainFrame || !LOGIN_URL.equals(url) || !"GET".equals(method)
                || !connectionError || attempts >= 3) return -1;
        return new long[]{1500, 3500, 8000}[attempts++];
    }
    void reset() { attempts = 0; }
}
