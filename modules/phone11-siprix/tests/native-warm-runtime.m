// Reuse the production bridge/mock SDK harness; no live SDK calls, SIP traffic, or device actions.
#define main baseline_runtime_main
#include "native-runtime.m"
#undef main

static Phone11Siprix *warmBridge;
static id warmResult;
static NSString *warmError;
static RCTPromiseResolveBlock warmResolve;
static RCTPromiseRejectBlock warmReject;
static NSString *request = @"00000000-0000-4000-8000-000000000001";
static NSString *transferRequest = @"00000000-0000-4000-8000-000000000002";
static NSDictionary *warmConfig;
static void drain(void) { flush(); flush(); }
static NSString *boot(void) {
  if (warmBridge) [warmBridge destroy:warmResolve rejecter:warmReject];
  sdkCode=0; transferCode=0; mockHold=HoldStateNone; inlineHeld=NO; inlineTransferSuccess=NO; mixerCode=0; emitMixerSwitch=YES;
  warmBridge=[Phone11Siprix new]; [warmBridge startObserving];
  [warmBridge initialize:@{} resolver:warmResolve rejecter:warmReject];
  CHECK(!warmError && !lastInit.singleCallMode.boolValue && [warmResult[@"warmTransferAvailable"] boolValue]);
  [warmBridge createAccount:warmConfig resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; drain();
  [warmBridge makeCall:@"10" destination:@"2002" resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
  NSString *original=warmResult[@"callId"];
  [sdkDelegate onCallConnected:original.intValue hdrFrom:@"test" hdrTo:@"2002" withVideo:NO]; drain();
  CHECK([P11SiprixRuntime.shared.calls[original][@"state"] isEqual:@"connected"]);
  return original;
}
static void begin(NSString *original) {
  [warmBridge beginConsultation:original destination:@"3003" requestId:request resolver:warmResolve rejecter:warmReject];
  CHECK(!warmError && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"holding"]);
}
static NSString *connectConsultation(NSString *original) {
  begin(original);
  mockHold=HoldStateLocal; [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
  CHECK(!P11SiprixRuntime.shared.calls[original][@"consultationCallId"] && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"held_ready"]);
  [warmBridge continueConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
  NSString *consult=P11SiprixRuntime.shared.calls[original][@"consultationCallId"];
  CHECK(consult && P11SiprixRuntime.shared.calls.count==2 && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"calling"]);
  CHECK([P11SiprixRuntime.shared.calls[consult][@"consultationParentId"] isEqual:original]);
  [sdkDelegate onCallConnected:consult.intValue hdrFrom:@"test" hdrTo:@"3003" withVideo:NO]; drain();
  CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"ready"]);
  return consult;
}
int main(void) {
  @autoreleasepool {
    warmResolve=^(id value){warmResult=value;warmError=nil;};
    warmReject=^(NSString *code,NSString *message,NSError *error){warmError=code;warmResult=nil;};
    warmConfig=@{@"sipServer":@"invalid.example",@"sipExtension":@"test",@"sipPassword":@"test-only-secret",@"transport":@"TLS"};
    NSString *original=boot();
    int beforeHolds=holds,beforeInvites=invites;
    [warmBridge beginConsultation:original destination:@"sip:bad@external.test" requestId:request resolver:warmResolve rejecter:warmReject];
    CHECK([warmError isEqual:@"E_INVALID_ARGUMENT"] && holds==beforeHolds && !P11SiprixRuntime.shared.calls[original][@"consultationAttempted"]);
    mockHold=HoldStateRemote;
    [warmBridge beginConsultation:original destination:@"3003" requestId:request resolver:warmResolve rejecter:warmReject];
    CHECK([warmError isEqual:@"E_CALL_STATE"] && holds==beforeHolds);
    mockHold=HoldStateNone; begin(original);
    CHECK(invites==beforeInvites); // Command acceptance never calls destination before hold confirmation.
    [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject];
    CHECK(!warmError && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"canceling"]);
    mockHold=HoldStateLocal; [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    CHECK(invites==beforeInvites && holds==beforeHolds+2 && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"returning"]);
    mockHold=HoldStateRemote; [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"returned"] && [P11SiprixRuntime.shared.calls[original][@"holdState"] intValue]==HoldStateRemote);
    // Duplicate delayed hold reports cannot launch another consultation, including after cancellation.
    [sdkDelegate onCallHeld:original.intValue holdState:HoldStateNone]; drain(); mockHold=HoldStateNone;
    [warmBridge beginConsultation:original destination:@"4004" requestId:transferRequest resolver:warmResolve rejecter:warmReject];
    CHECK([warmError isEqual:@"E_CALL_STATE"] && invites==beforeInvites);
    [sdkDelegate onCallHeld:original.intValue holdState:HoldStateLocal]; drain(); CHECK(invites==beforeInvites);

    original=boot(); inlineHeld=YES; begin(original); drain(); inlineHeld=NO; mockHold=HoldStateLocal;
    CHECK(!P11SiprixRuntime.shared.calls[original][@"consultationCallId"]);
    [warmBridge continueConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
    NSString *consult=P11SiprixRuntime.shared.calls[original][@"consultationCallId"];
    CHECK(consult && P11SiprixRuntime.shared.calls.count==2); // Inline SDK callback is queued safely.
    int beforeByes=byes,beforeRejects=rejects;
    [warmBridge makeCall:@"10" destination:@"4004" resolver:warmResolve rejecter:warmReject]; CHECK([warmError isEqual:@"E_CALL_ACTIVE"]);
    [sdkDelegate onCallIncoming:999 accId:10 withVideo:NO hdrFrom:@"extra" hdrTo:@"test"]; drain();
    CHECK(rejects==beforeRejects+1 && P11SiprixRuntime.shared.calls.count==2);
    [warmBridge cancelConsultation:original requestId:transferRequest resolver:warmResolve rejecter:warmReject];
    CHECK([warmError isEqual:@"E_CONSULTATION_CHANGED"] && byes==beforeByes);
    [warmBridge completeConsultation:original requestId:request transferRequestId:transferRequest resolver:warmResolve rejecter:warmReject]; CHECK([warmError isEqual:@"E_CALL_STATE"]);
    [warmBridge setHold:original held:NO resolver:warmResolve rejecter:warmReject]; CHECK([warmError isEqual:@"E_CONSULTATION_ACTIVE"]);
    [warmBridge transferCall:consult destination:@"4004" requestId:transferRequest resolver:warmResolve rejecter:warmReject]; CHECK([warmError isEqual:@"E_CONSULTATION_ACTIVE"]);
    [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject];
    CHECK(!warmError && byes==beforeByes+1 && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"canceling"]);
    int holdsBeforeEnd=holds;
    [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK(!warmError && byes==beforeByes+1 && holds==holdsBeforeEnd);
    [sdkDelegate onCallTerminated:consult.intValue statusCode:487]; drain();
    CHECK(P11SiprixRuntime.shared.calls[original] && holds==holdsBeforeEnd+1 && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"returning"]);
    mockHold=HoldStateNone; [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"returned"]);

    original=boot(); begin(original); mockHold=HoldStateLocal; sdkCode=-20; beforeInvites=invites;
    [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    CHECK(invites==beforeInvites);
    [warmBridge continueConsultation:original requestId:request resolver:warmResolve rejecter:warmReject];
    CHECK(invites==beforeInvites+1 && P11SiprixRuntime.shared.calls.count==1 && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"return_failed"]);
    sdkCode=0; [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject];
    CHECK(!warmError && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"returning"]);
    mockHold=HoldStateNone; [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"returned"]);

    original=boot(); begin(original); beforeInvites=invites;
    [sdkDelegate onCallTerminated:original.intValue statusCode:200]; drain();
    [sdkDelegate onCallHeld:original.intValue holdState:HoldStateLocal]; drain();
    CHECK(!P11SiprixRuntime.shared.calls[original] && invites==beforeInvites);
    original=boot(); consult=connectConsultation(original); beforeByes=byes;
    [sdkDelegate onCallTerminated:original.intValue statusCode:200]; drain();
    CHECK(!P11SiprixRuntime.shared.calls[original] && byes==beforeByes+1 && P11SiprixRuntime.shared.calls[consult]);
    [sdkDelegate onCallTerminated:consult.intValue statusCode:487]; drain(); CHECK(P11SiprixRuntime.shared.calls.count==0);

    original=boot(); consult=connectConsultation(original); beforeByes=byes;
    int beforeAttended=attendedInvocations;
    [warmBridge completeConsultation:original requestId:request transferRequestId:transferRequest resolver:warmResolve rejecter:warmReject];
    CHECK(!warmError && attendedInvocations==beforeAttended+1 && attendedFrom==original.intValue && attendedTo==consult.intValue && byes==beforeByes);
    [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK([warmError isEqual:@"E_TRANSFER_PENDING"] && byes==beforeByes);
    [sdkDelegate onCallTransferred:original.intValue statusCode:486]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"transfer_failed"] && P11SiprixRuntime.shared.calls.count==2 && byes==beforeByes);
    [warmBridge completeConsultation:original requestId:request transferRequestId:@"00000000-0000-4000-8000-000000000003" resolver:warmResolve rejecter:warmReject];
    CHECK(warmError && attendedInvocations==beforeAttended+1);
    [sdkDelegate onCallTransferred:original.intValue statusCode:0]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"transferStatusCode"] intValue]==486); // Late success cannot overwrite failure.
    [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK(!warmError && byes==beforeByes+1);
    [sdkDelegate onCallTerminated:consult.intValue statusCode:200]; drain();
    mockHold=HoldStateNone; [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain(); CHECK(P11SiprixRuntime.shared.calls[original]);
    [warmBridge transferCall:original destination:@"4004" requestId:@"00000000-0000-4000-8000-000000000003" resolver:warmResolve rejecter:warmReject]; CHECK([warmError isEqual:@"E_TRANSFER_ATTEMPTED"]);

    original=boot(); consult=connectConsultation(original); beforeByes=byes; beforeAttended=attendedInvocations; transferCode=-20;
    [warmBridge completeConsultation:original requestId:request transferRequestId:transferRequest resolver:warmResolve rejecter:warmReject];
    CHECK([warmError isEqual:@"E_SIPRIX_-20"] && attendedInvocations==beforeAttended+1 && byes==beforeByes && P11SiprixRuntime.shared.calls.count==2);
    transferCode=0; [sdkDelegate onCallTransferred:original.intValue statusCode:0]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"transfer_failed"] && !P11SiprixRuntime.shared.calls[original][@"transferStatusCode"]);
    [warmBridge completeConsultation:original requestId:request transferRequestId:transferRequest resolver:warmResolve rejecter:warmReject]; CHECK(warmError && attendedInvocations==beforeAttended+1);

    original=boot(); consult=connectConsultation(original); beforeByes=byes; inlineTransferSuccess=YES;
    [warmBridge completeConsultation:original requestId:request transferRequestId:transferRequest resolver:warmResolve rejecter:warmReject]; CHECK(!warmError); drain(); inlineTransferSuccess=NO;
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"completed"] && byes==beforeByes && P11SiprixRuntime.shared.calls.count==2);
    // SDK/provider owns successful termination; the bridge never forcibly disconnects either leg.
    [sdkDelegate onCallTerminated:original.intValue statusCode:200]; drain(); CHECK(byes==beforeByes && P11SiprixRuntime.shared.calls[consult]);
    [sdkDelegate onCallTerminated:consult.intValue statusCode:200]; drain(); CHECK(P11SiprixRuntime.shared.calls.count==0);

    original=boot(); begin(original); mockHold=HoldStateLocal;
    [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    [warmBridge continueConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
    consult=P11SiprixRuntime.shared.calls[original][@"consultationCallId"];
    emitMixerSwitch=NO; [sdkDelegate onCallConnected:consult.intValue hdrFrom:@"" hdrTo:@"" withVideo:NO]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"switching"] && switchedCall==consult.intValue);
    beforeAttended=attendedInvocations;
    [warmBridge completeConsultation:original requestId:request transferRequestId:transferRequest resolver:warmResolve rejecter:warmReject]; CHECK(warmError && attendedInvocations==beforeAttended);
    [sdkDelegate onCallSwitched:consult.intValue]; drain(); CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"ready"]);
    [warmBridge sendDtmf:original digits:@"1" resolver:warmResolve rejecter:warmReject]; CHECK(!warmError && dtmfCall==consult.intValue);
    [warmBridge setMute:original muted:YES resolver:warmResolve rejecter:warmReject];
    CHECK(!warmError && [P11SiprixRuntime.shared.calls[consult][@"muted"] boolValue] && [P11SiprixRuntime.shared.calls[original][@"muted"] boolValue]);
    [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
    [sdkDelegate onCallTerminated:consult.intValue statusCode:200]; drain();
    mockHold=HoldStateNone; [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"restoring_audio"] && switchedCall==original.intValue);
    [sdkDelegate onCallSwitched:consult.intValue]; drain(); CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"restoring_audio"]);
    [sdkDelegate onCallSwitched:original.intValue]; drain(); CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"returned"]);

    original=boot(); begin(original); mockHold=HoldStateLocal;
    [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    [warmBridge continueConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
    consult=P11SiprixRuntime.shared.calls[original][@"consultationCallId"]; mixerCode=-20;
    [sdkDelegate onCallConnected:consult.intValue hdrFrom:@"" hdrTo:@"" withVideo:NO]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"consultation_failed"]);
    [sdkDelegate onCallSwitched:consult.intValue]; drain(); CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"consultation_failed"]);
    [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
    [sdkDelegate onCallTerminated:consult.intValue statusCode:487]; drain();
    mockHold=HoldStateNone; [sdkDelegate onCallHeld:original.intValue holdState:mockHold]; drain();
    CHECK([P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"return_failed"]);
    mixerCode=0; [warmBridge cancelConsultation:original requestId:request resolver:warmResolve rejecter:warmReject]; drain(); CHECK(!warmError && [P11SiprixRuntime.shared.calls[original][@"consultationPhase"] isEqual:@"returned"]);

    original=boot(); consult=connectConsultation(original); beforeByes=byes;
    [warmBridge completeConsultation:original requestId:request transferRequestId:transferRequest resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
    [sdkDelegate onCallTerminated:original.intValue statusCode:200]; drain();
    CHECK(!P11SiprixRuntime.shared.calls[original] && P11SiprixRuntime.shared.calls[consult] && byes==beforeByes);
    [sdkDelegate onCallTransferred:original.intValue statusCode:0]; drain(); CHECK(byes==beforeByes && P11SiprixRuntime.shared.calls[consult]);
    [sdkDelegate onCallTerminated:consult.intValue statusCode:200]; drain(); CHECK(P11SiprixRuntime.shared.calls.count==0 && byes==beforeByes);

    // Both SDK orders may leave a live leg with an uncertain original outcome.
    // Only explicit user End may send BYE to that remaining consultation.
    for (NSNumber *callbackFirst in @[@YES,@NO]) {
      original=boot(); consult=connectConsultation(original); beforeByes=byes;
      [warmBridge completeConsultation:original requestId:request transferRequestId:transferRequest resolver:warmResolve rejecter:warmReject]; CHECK(!warmError);
      if (callbackFirst.boolValue) { [sdkDelegate onCallTransferred:original.intValue statusCode:0]; drain(); }
      [sdkDelegate onCallTerminated:original.intValue statusCode:200]; drain();
      if (!callbackFirst.boolValue) { [sdkDelegate onCallTransferred:original.intValue statusCode:486]; drain(); }
      CHECK(byes==beforeByes && P11SiprixRuntime.shared.calls[consult]);
      [warmBridge hangupCall:consult resolver:warmResolve rejecter:warmReject];
      CHECK(!warmError && byes==beforeByes+1 && P11SiprixRuntime.shared.calls[consult]);
      [sdkDelegate onCallTerminated:consult.intValue statusCode:200]; drain();
      CHECK(P11SiprixRuntime.shared.calls.count==0 && byes==beforeByes+1);
      [warmBridge hangupCall:consult resolver:warmResolve rejecter:warmReject]; CHECK(warmError && byes==beforeByes+1);
    }

    original=boot(); begin(original); id<SiprixEventDelegate> retired=sdkDelegate;
    NSString *replacement=boot(); beforeInvites=invites;
    [retired onCallHeld:original.intValue holdState:HoldStateLocal]; drain();
    CHECK(invites==beforeInvites && P11SiprixRuntime.shared.calls.count==1 && P11SiprixRuntime.shared.calls[replacement]);
    P11SiprixRuntime.shared.wakeContext=@{@"callUUID":@"native-owned-test"};
    [warmBridge beginConsultation:replacement destination:@"3003" requestId:request resolver:warmResolve rejecter:warmReject]; CHECK([warmError isEqual:@"E_UNSUPPORTED"]);
    [warmBridge getSnapshot:warmResolve rejecter:warmReject]; CHECK(![warmResult[@"warmTransferAvailable"] boolValue]);
    P11SiprixRuntime.shared.wakeContext=nil;
    [warmBridge destroy:warmResolve rejecter:warmReject]; CHECK(!warmError);
    printf("PASS: %d warm consultation assertions (mock SDK; default-off source only)\n",assertions);
  }
  return 0;
}
