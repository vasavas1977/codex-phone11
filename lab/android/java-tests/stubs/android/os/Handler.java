package android.os;
import java.util.ArrayList;
import java.util.Comparator;
public final class Handler {
 private static final class Task {final Runnable run;final long at;Task(Runnable r,long t){run=r;at=t;}}
 private final ArrayList<Task> tasks=new ArrayList<>();
 public Looper getLooper(){return Looper.getMainLooper();}
 public boolean postDelayed(Runnable r,long delay){tasks.add(new Task(r,SystemClock.now+delay));return true;}
 public void removeCallbacks(Runnable r){tasks.removeIf(t->t.run==r);}
 public void advance(long ms){long end=SystemClock.now+ms;while(true){tasks.sort(Comparator.comparingLong(t->t.at));if(tasks.isEmpty()||tasks.get(0).at>end)break;Task t=tasks.remove(0);SystemClock.now=t.at;t.run.run();}SystemClock.now=end;}
 public int pending(){return tasks.size();}
}
