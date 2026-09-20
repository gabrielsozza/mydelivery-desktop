package br.com.mydeliveryfood.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class PageLoadRecoveryTest {
    @Test public void connectionAbortRetriesAreBounded() {
        PageLoadRecovery r = new PageLoadRecovery();
        for (int i=0;i<3;i++) assertTrue(r.nextDelay(true, PageLoadRecovery.LOGIN_URL, "GET", -6)>0);
        assertEquals(-1,r.nextDelay(true,PageLoadRecovery.LOGIN_URL,"GET",-6));
        r.reset();assertTrue(r.nextDelay(true,PageLoadRecovery.LOGIN_URL,"GET",-6)>0);
    }
    @Test public void neverRetriesPostSubresourcesOrAnotherPage() {
        PageLoadRecovery r = new PageLoadRecovery();
        assertEquals(-1,r.nextDelay(true,PageLoadRecovery.LOGIN_URL,"POST",-6));
        assertEquals(-1,r.nextDelay(false,PageLoadRecovery.LOGIN_URL,"GET",-6));
        assertEquals(-1,r.nextDelay(true,"https://mydeliveryfood.com.br/pedido.html","GET",-6));
        assertEquals(-1,r.nextDelay(true,"https://another.example/login.html","GET",-6));
        assertTrue(r.nextDelay(true,PageLoadRecovery.LOGIN_URL,"GET",-6)>0);
    }
    @Test public void neverRetriesCertificateOrHttpErrors() {
        PageLoadRecovery r = new PageLoadRecovery();
        for(int code:new int[]{-11,-4,-12,401,403,404,500}) assertEquals(-1,r.nextDelay(true,PageLoadRecovery.LOGIN_URL,"GET",code));
    }
}
