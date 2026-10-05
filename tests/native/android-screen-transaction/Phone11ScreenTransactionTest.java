package com.oney.WebRTCModule;
import java.util.*;
import java.util.concurrent.*;

/** Executes the exact patched native custody core, with controllable Android resource boundaries. */
public final class Phone11ScreenTransactionTest {
    static int cases;
    static final class QueueExecutor implements Executor {
        final ArrayDeque<Runnable> tasks = new ArrayDeque<>();
        public void execute(Runnable task) { tasks.add(task); }
        void drain() { int budget=100; while (!tasks.isEmpty()) { if (--budget==0) throw new AssertionError("executor stuck"); tasks.remove().run(); } }
    }
    static final class Resources implements Phone11ScreenTransaction.Resources<String> {
        final CompletableFuture<Void> started = new CompletableFuture<>(), destroyed = new CompletableFuture<>();
        int starts, captures, disposals, stops;
        boolean captureFails, disposeFails, stopFails;
        public CompletableFuture<Void> startForeground() { starts++; return started; }
        public String capture() { captures++; if(captureFails)throw new IllegalStateException("capture failed");return "video-only"; }
        public void disposeCapture() { disposals++;if(disposeFails)throw new IllegalStateException("dispose failed"); }
        public CompletableFuture<Void> stopForeground() { stops++;if(stopFails)return failed("stop failed");return destroyed; }
    }
    static <T> CompletableFuture<T> failed(String message) { CompletableFuture<T> f=new CompletableFuture<>();f.completeExceptionally(new IllegalStateException(message));return f; }
    static void check(boolean value) { if(!value)throw new AssertionError(); }
    static void rejected(CompletableFuture<?> task) { check(task.isCompletedExceptionally()); }
    static void test(String name, Runnable run) { run.run();cases++;System.out.println("PASS "+name); }
    public static void main(String[] args) {
      test("canceled chooser never launches service or capture on late grant", () -> {
        QueueExecutor q=new QueueExecutor();Resources r=new Resources();Phone11ScreenTransaction<String> t=new Phone11ScreenTransaction<>("one","life",q,r);
        t.retire();CompletableFuture<Void> stop=t.stop();t.grantConsent();q.drain();check(r.starts==0&&r.captures==0);rejected(t.result());check(!stop.isDone());r.destroyed.complete(null);q.drain();check(stop.isDone());
      });
      test("foreground readiness is required before video capture", () -> {
        QueueExecutor q=new QueueExecutor();Resources r=new Resources();Phone11ScreenTransaction<String> t=new Phone11ScreenTransaction<>("one","life",q,r);
        t.grantConsent();q.drain();check(r.starts==1&&r.captures==0&&!t.result().isDone());r.started.complete(null);q.drain();check(r.captures==1&&t.result().join().equals("video-only"));
      });
      test("cancel between service request and ACK cannot capture", () -> {
        QueueExecutor q=new QueueExecutor();Resources r=new Resources();Phone11ScreenTransaction<String> t=new Phone11ScreenTransaction<>("one","life",q,r);
        t.grantConsent();q.drain();CompletableFuture<Void> stop=t.stop();q.drain();check(!stop.isDone());r.started.complete(null);q.drain();check(r.captures==0&&r.disposals==1&&!stop.isDone());r.destroyed.complete(null);q.drain();check(stop.isDone());
      });
      test("foreground failure never captures and still owns service teardown", () -> {
        QueueExecutor q=new QueueExecutor();Resources r=new Resources();Phone11ScreenTransaction<String> t=new Phone11ScreenTransaction<>("one","life",q,r);
        t.grantConsent();q.drain();r.started.completeExceptionally(new IllegalStateException("foreground failed"));q.drain();rejected(t.result());CompletableFuture<Void> stop=t.stop();q.drain();check(r.captures==0&&!stop.isDone());r.destroyed.complete(null);q.drain();check(stop.isDone());
      });
      test("partial capture failure still disposes retained resources", () -> {
        QueueExecutor q=new QueueExecutor();Resources r=new Resources();r.captureFails=true;Phone11ScreenTransaction<String> t=new Phone11ScreenTransaction<>("one","life",q,r);
        t.grantConsent();r.started.complete(null);q.drain();rejected(t.result());CompletableFuture<Void> stop=t.stop();q.drain();check(r.captures==1&&r.disposals==1&&!stop.isDone());r.destroyed.complete(null);q.drain();check(stop.isDone());
      });
      test("disposal failure rejects stop and preserves retry custody", () -> {
        QueueExecutor q=new QueueExecutor();Resources r=new Resources();Phone11ScreenTransaction<String> t=new Phone11ScreenTransaction<>("one","life",q,r);
        t.grantConsent();r.started.complete(null);q.drain();r.disposeFails=true;CompletableFuture<Void> first=t.stop();q.drain();rejected(first);check(r.stops==0);r.disposeFails=false;CompletableFuture<Void> retry=t.stop();q.drain();check(r.disposals==2&&!retry.isDone());r.destroyed.complete(null);q.drain();check(retry.isDone());
      });
      test("service stop failure rejects and retries without new capture", () -> {
        QueueExecutor q=new QueueExecutor();Resources r=new Resources();Phone11ScreenTransaction<String> t=new Phone11ScreenTransaction<>("one","life",q,r);
        t.grantConsent();r.started.complete(null);q.drain();r.stopFails=true;CompletableFuture<Void> first=t.stop();q.drain();rejected(first);r.stopFails=false;CompletableFuture<Void> retry=t.stop();q.drain();check(r.captures==1&&r.stops==2&&!retry.isDone());r.destroyed.complete(null);q.drain();check(retry.isDone());
      });
      test("duplicate stop coalesces and requires destruction receipt", () -> {
        QueueExecutor q=new QueueExecutor();Resources r=new Resources();Phone11ScreenTransaction<String> t=new Phone11ScreenTransaction<>("one","life",q,r);
        t.grantConsent();r.started.complete(null);q.drain();CompletableFuture<Void> first=t.stop();check(first==t.stop());q.drain();check(r.disposals==1&&r.stops==1&&!first.isDone());r.destroyed.complete(null);q.drain();check(first.isDone());t.stop().join();check(r.disposals==1&&r.stops==1);
      });
      test("late old service acknowledgment cannot complete a new operation", () -> {
        QueueExecutor q=new QueueExecutor();Resources old=new Resources(),fresh=new Resources();Phone11ScreenTransaction<String> a=new Phone11ScreenTransaction<>("old","life-old",q,old),b=new Phone11ScreenTransaction<>("new","life-new",q,fresh);
        a.grantConsent();old.started.complete(null);q.drain();CompletableFuture<Void> stop=a.stop();q.drain();old.destroyed.complete(null);q.drain();check(stop.isDone()&&!b.result().isDone()&&fresh.captures==0);b.grantConsent();q.drain();check(fresh.starts==1&&fresh.captures==0);
      });
      System.out.println("Phone11 Android screen transaction: "+cases+" native custody scenarios passed; no Android runtime capture proof");
    }
}
