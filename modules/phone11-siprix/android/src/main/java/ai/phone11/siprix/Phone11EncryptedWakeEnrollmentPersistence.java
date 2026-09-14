package ai.phone11.siprix;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android Keystore-backed persistence for the server-issued wake grant. */
final class Phone11EncryptedWakeEnrollmentPersistence
    implements Phone11WakeEnrollmentStore.Persistence {
  private static final String KEYSTORE = "AndroidKeyStore";
  private static final String ALIAS = "ai.phone11.android-wake-enrollment.v1";
  private static final String VALUE = "enrollment";
  private final SharedPreferences preferences;

  Phone11EncryptedWakeEnrollmentPersistence(Context context) {
    preferences = context.getSharedPreferences("phone11_android_wake_enrollment_v1",
        Context.MODE_PRIVATE);
  }

  @Override public synchronized String read() {
    String encoded = preferences.getString(VALUE, null);
    if (encoded == null) return null;
    try {
      byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
      if (payload.length < 13) throw new GeneralSecurityException("invalid payload");
      ByteBuffer buffer = ByteBuffer.wrap(payload);
      int ivLength = buffer.get() & 0xff;
      if (ivLength != 12 || buffer.remaining() <= ivLength) {
        throw new GeneralSecurityException("invalid payload");
      }
      byte[] iv = new byte[ivLength]; buffer.get(iv);
      byte[] ciphertext = new byte[buffer.remaining()]; buffer.get(ciphertext);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
      return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    } catch (RuntimeException | GeneralSecurityException unavailable) {
      clear();
      return null;
    }
  }

  @Override public synchronized void write(String value) {
    if (value == null) throw new IllegalArgumentException("value");
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key(true));
      byte[] iv = cipher.getIV();
      byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
      ByteBuffer payload = ByteBuffer.allocate(1 + iv.length + ciphertext.length);
      payload.put((byte) iv.length).put(iv).put(ciphertext);
      if (!preferences.edit().putString(VALUE,
          Base64.encodeToString(payload.array(), Base64.NO_WRAP)).commit()) {
        throw new IllegalStateException("wake enrollment persistence failed");
      }
    } catch (GeneralSecurityException unavailable) {
      throw new IllegalStateException("wake enrollment persistence failed", unavailable);
    }
  }

  @Override public synchronized void clear() {
    if (!preferences.edit().remove(VALUE).commit()) {
      throw new IllegalStateException("wake enrollment persistence failed");
    }
    try {
      KeyStore store = KeyStore.getInstance(KEYSTORE); store.load(null);
      if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS);
    } catch (Exception unavailable) {
      throw new IllegalStateException("wake enrollment persistence failed", unavailable);
    }
  }

  private SecretKey key(boolean create) throws GeneralSecurityException {
    try {
      KeyStore store = KeyStore.getInstance(KEYSTORE); store.load(null);
      java.security.Key existing = store.getKey(ALIAS, null);
      if (existing instanceof SecretKey) return (SecretKey) existing;
      if (!create) throw new GeneralSecurityException("wake enrollment key unavailable");
      KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
      generator.init(new KeyGenParameterSpec.Builder(ALIAS,
          KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setRandomizedEncryptionRequired(true)
          .build());
      return generator.generateKey();
    } catch (GeneralSecurityException error) {
      throw error;
    } catch (Exception unavailable) {
      throw new GeneralSecurityException("wake enrollment key unavailable", unavailable);
    }
  }
}
