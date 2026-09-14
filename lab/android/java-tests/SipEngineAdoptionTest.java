package ai.phone11.siprix;

/** Pure JVM checks for adopting an existing registered Siprix engine. */
public final class SipEngineAdoptionTest {
  private static final long NOW = 4_000_000L;
  private static final String BINDING = "11111111-1111-4111-8111-111111111111";
  private static final String CALL = "33333333-3333-4333-8333-333333333333";

  private static final class Memory implements Phone11PendingWakeStore.Persistence {
    String value;
    public String read() { return value; }
    public void write(String next) { value = next; }
    public void clear() { value = null; }
  }

  private static final class Commands implements Phone11SipEngineAdoption.Commands {
    int answered = -1;
    int declined = -1;
    boolean succeed = true;
    public boolean answer(int callId) { answered = callId; return succeed; }
    public boolean decline(int callId) { declined = callId; return succeed; }
  }

  private static Phone11PendingWakeStore.Snapshot pending(long expiresAt) {
    Phone11PendingWakeStore store = new Phone11PendingWakeStore(new Memory());
    store.bind(new Phone11PendingWakeStore.Binding(BINDING, 7, 11, "device", "session",
        NOW + 90_000), NOW);
    store.receive(new Phone11PendingWakeStore.Wake(1, CALL, BINDING, expiresAt), NOW);
    return store.snapshot();
  }

  private static void check(boolean value, String reason) {
    if (!value) throw new AssertionError(reason);
  }

  public static void main(String[] args) {
    int assertions = 0;
    Phone11PendingWakeStore.Snapshot wake = pending(NOW + 30_000);
    Phone11SipEngineAdoption adoption = new Phone11SipEngineAdoption();
    check(adoption.adopt(wake, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_UNAVAILABLE,
        "no engine cannot adopt"); assertions++;

    Commands first = new Commands();
    adoption.attach(1, first);
    check(adoption.adopt(wake, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_NOT_REGISTERED,
        "unregistered engine cannot adopt"); assertions++;
    adoption.accountRegistration(1, 10, true);
    check(adoption.adopt(wake, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_AMBIGUOUS,
        "wake without incoming SDK call cannot adopt"); assertions++;
    adoption.incoming(1, 10, 20);
    check(adoption.adopt(wake, NOW) == Phone11SipEngineAdoption.Decision.ADOPTED,
        "one registered account and incoming call adopt"); assertions++;
    check(adoption.adopt(wake, NOW) == Phone11SipEngineAdoption.Decision.DUPLICATE,
        "same wake adoption is idempotent"); assertions++;
    check(adoption.answer("44444444-4444-4444-8444-444444444444", BINDING, NOW)
        == Phone11SipEngineAdoption.Decision.REJECTED_WRONG_OWNER,
        "different call cannot answer"); assertions++;
    check(first.answered == -1, "rejected action never reaches SDK"); assertions++;
    first.succeed = false;
    check(adoption.answer(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_COMMAND,
        "SDK failure keeps ownership"); assertions++;
    first.succeed = true;
    check(adoption.answer(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.ANSWERED,
        "owned answer succeeds"); assertions++;
    check(first.answered == 20, "answer targets adopted SDK call"); assertions++;
    check(adoption.answer(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_TERMINAL,
        "answered action cannot replay"); assertions++;
    adoption.terminated(1, 20);
    check(adoption.answer(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_WRONG_OWNER,
        "termination releases owner"); assertions++;

    adoption.incoming(1, 10, 21);
    check(adoption.adopt(wake, NOW) == Phone11SipEngineAdoption.Decision.ADOPTED,
        "new ringing SDK call may adopt pending owner"); assertions++;
    check(adoption.decline(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.DECLINED,
        "owned decline succeeds"); assertions++;
    check(first.declined == 21, "decline targets adopted SDK call"); assertions++;
    check(adoption.decline(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_WRONG_OWNER,
        "decline cannot replay"); assertions++;

    adoption.incoming(1, 10, 22);
    adoption.adopt(wake, NOW);
    check(adoption.cancel(CALL, "wrong-binding", NOW)
        == Phone11SipEngineAdoption.Decision.REJECTED_WRONG_OWNER,
        "wrong cancellation cannot clear"); assertions++;
    check(first.declined == 21, "wrong cancellation never reaches SDK"); assertions++;
    check(adoption.cancel(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.CLEARED,
        "owned cancellation clears"); assertions++;
    check(first.declined == 22, "owned cancellation rejects ringing SDK call"); assertions++;

    adoption.incoming(1, 10, 23);
    adoption.adopt(wake, NOW);
    adoption.logout();
    check(first.declined == 23, "logout rejects and releases ringing owner"); assertions++;
    check(adoption.answer(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_WRONG_OWNER,
        "logout removes owner without creating an engine"); assertions++;

    adoption.accountRegistration(1, 10, true);
    adoption.incoming(1, 10, 24);
    adoption.adopt(wake, NOW);
    Commands replacement = new Commands();
    adoption.attach(2, replacement);
    check(adoption.answer(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_WRONG_OWNER,
        "generation replacement removes prior owner"); assertions++;
    adoption.accountRegistration(1, 10, true);
    adoption.incoming(1, 10, 25);
    check(adoption.adopt(wake, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_NOT_REGISTERED,
        "stale engine callbacks are ignored"); assertions++;

    adoption.accountRegistration(2, 10, true);
    adoption.incoming(2, 10, 26);
    check(adoption.adopt(wake, NOW) == Phone11SipEngineAdoption.Decision.ADOPTED,
        "replacement engine can adopt after registration"); assertions++;
    adoption.accountRegistration(2, 10, false);
    check(adoption.answer(CALL, BINDING, NOW) == Phone11SipEngineAdoption.Decision.REJECTED_WRONG_OWNER,
        "unregistration releases its adopted owner"); assertions++;

    Phone11SipEngineAdoption expired = new Phone11SipEngineAdoption();
    Commands expiryCommands = new Commands();
    expired.attach(3, expiryCommands);
    expired.accountRegistration(3, 10, true);
    expired.incoming(3, 10, 27);
    Phone11PendingWakeStore.Snapshot shortWake = pending(NOW + 1);
    check(expired.adopt(shortWake, NOW) == Phone11SipEngineAdoption.Decision.ADOPTED,
        "bounded wake can adopt before expiry"); assertions++;
    check(expired.answer(CALL, BINDING, NOW + 1)
        == Phone11SipEngineAdoption.Decision.REJECTED_EXPIRED,
        "expiry releases owner"); assertions++;
    check(expiryCommands.declined == 27, "expiry rejects the ringing SDK call"); assertions++;

    System.out.println("PASS: " + assertions
        + " Android existing-engine adoption assertions (L0; no SDK or provider work)");
  }
}
