package android.content;
import java.io.File;
public final class Context {
 private final File root;
 public Context(File root){this.root=root;}
 public Context getApplicationContext(){return this;}
 public String getPackageName(){return "ai.phone11.mobile.lab";}
 public File getExternalFilesDir(String type){return root;}
}
