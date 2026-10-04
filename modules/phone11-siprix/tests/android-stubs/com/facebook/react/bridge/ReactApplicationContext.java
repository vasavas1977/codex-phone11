/** Host declaration only; never Android or React Native runtime proof. */
package com.facebook.react.bridge; public class ReactApplicationContext extends android.content.ContextWrapper { public ReactApplicationContext(){super(null);} public boolean hasActiveReactInstance(){return false;} public <T> T getJSModule(Class<T> type){return null;} }
