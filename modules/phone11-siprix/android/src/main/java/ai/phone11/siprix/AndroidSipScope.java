package ai.phone11.siprix;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Pattern;

/** Immutable build-supplied boundary for the isolated Android Siprix adapter. */
public final class AndroidSipScope {
 private static final Pattern PACKAGE = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+");
 private static final Pattern HOST = Pattern.compile("(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?");
 private static final Pattern USER = Pattern.compile("[A-Za-z0-9_+*#.-]{1,64}");
 private final String host;
 private final int port;
 private final Set<String> accounts;
 private final Set<String> destinations;

 public AndroidSipScope(String runtimePackage, String configuredPackage, String configuredHost,
                        String configuredPort, String configuredAccounts, String configuredDestinations) {
  String expectedPackage = required(configuredPackage);
  if (!PACKAGE.matcher(expectedPackage).matches() || !expectedPackage.equals(runtimePackage)) throw new SecurityException();
  host = required(configuredHost).toLowerCase(java.util.Locale.ROOT);
  if (!HOST.matcher(host).matches() || host.contains("..")) throw new SecurityException();
  try { port = Integer.parseInt(required(configuredPort)); } catch (NumberFormatException e) { throw new SecurityException(); }
  if (port < 1 || port > 65535) throw new SecurityException();
  accounts = values(configuredAccounts);
  destinations = values(configuredDestinations);
 }

 public String host() { return host; }
 public int port() { return port; }
 public String account(String value) { return allowed(value, accounts); }
 public Set<String> destinations() { return destinations; }

 public String destination(String value) {
  if (value == null) throw new SecurityException();
  String target = value;
  if (value.startsWith("sip:")) {
   String authority = value.substring(4);
   int at = authority.indexOf('@');
   if (at < 1 || at != authority.lastIndexOf('@')) throw new SecurityException();
   target = authority.substring(0, at);
   String endpoint = authority.substring(at + 1);
   if (!endpoint.equalsIgnoreCase(host) && !endpoint.equalsIgnoreCase(host + ":" + port)) throw new SecurityException();
  }
  return allowed(target, destinations);
 }

 private static String required(String value) {
  if (value == null || !value.equals(value.trim()) || value.isEmpty()) throw new SecurityException();
  return value;
 }

 private static Set<String> values(String csv) {
  required(csv);
  LinkedHashSet<String> result = new LinkedHashSet<>();
  for (String value : Arrays.asList(csv.split(",", -1))) {
   String item = required(value);
   if (!USER.matcher(item).matches() || !result.add(item)) throw new SecurityException();
  }
  return Collections.unmodifiableSet(result);
 }

 private static String allowed(String value, Set<String> allowlist) {
  String item = required(value);
  if (!USER.matcher(item).matches() || !allowlist.contains(item)) throw new SecurityException();
  return item;
 }
}
