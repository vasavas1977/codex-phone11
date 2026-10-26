package ai.phone11.siprix;

/** Executes the actual adapter version gate without loading vendor native code. */
final class AndroidSdkVersionTest {
  public static void main(String[] args) {
    String[] accepted={"siprix 1.1.0 from 20260905_1222","1.1.0 from 20260905_1222",
      "Siprix:1.1.0 from 20260905_1222","Siprix: 1.1.0 from 20260905_1222"};
    String[] rejected={null,"","siprix 1.1.1 from 20260905_1222","siprix 1.1.0 from 20260906_1222",
      "siprix1.1.0 from 20260905_1222","siprix 1x1x0 from 20260905_1222",
      "siprix 1.1.0 from 20260905_1222 extra","prefix siprix 1.1.0 from 20260905_1222"};
    for(String version:accepted)if(!SiprixAndroidAdapter.acceptsSdkVersion(version))throw new AssertionError("pinned version rejected");
    for(String version:rejected)if(SiprixAndroidAdapter.acceptsSdkVersion(version))throw new AssertionError("unsupported version accepted");
    System.out.println("PASS 12 actual Android adapter version-gate assertions; no SDK initialization or calls");
  }
}
