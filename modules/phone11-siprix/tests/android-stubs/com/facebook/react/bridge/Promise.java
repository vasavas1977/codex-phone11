/** Host declaration only; never Android or React Native runtime proof. */
package com.facebook.react.bridge; public interface Promise {void resolve(Object value);void reject(String code,String message);}
