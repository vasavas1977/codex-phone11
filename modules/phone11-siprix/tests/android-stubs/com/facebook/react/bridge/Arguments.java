/** Host declaration only; never Android or React Native runtime proof. */
package com.facebook.react.bridge; public class Arguments {public static Object makeNativeArray(java.util.List<?> value){return value;}public static Object createMap(){return new java.util.HashMap<String,Object>();}public static Object makeNativeMap(java.util.Map<String,Object> value){return value;}}
