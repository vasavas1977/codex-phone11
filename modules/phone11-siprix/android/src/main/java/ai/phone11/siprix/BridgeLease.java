package ai.phone11.siprix;

/** Revokes queued commands from a replaced or invalidated React bridge. */
public final class BridgeLease {
 public static final class Ticket { private boolean closed; }
 private Ticket current;
 public synchronized Ticket acquire() { current=new Ticket(); return current; }
 public synchronized boolean owns(Ticket ticket) { return ticket==current && !ticket.closed; }
 public synchronized void release(Ticket ticket) { ticket.closed=true; }
}
