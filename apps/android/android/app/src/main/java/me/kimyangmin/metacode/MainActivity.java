package me.kimyangmin.metacode;

import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

/**
 * 앱 화면은 운영 웹을 그대로 열고, 로그인은 웹과 같은 쿠키를 쓴다.
 * WebView는 쿠키를 가끔씩만 디스크에 쓰므로, 앱이 가려질 때 바로 써 두어 앱이 종료돼도 로그인이 남게 한다.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
