package com.siprix;
public final class SiprixCore {
 public static final int kOK=0;
 public static final class IdOutArg {public int value;}
 public enum PlayerState {STARTED,STOPPED,FAILED}
 public int stopCode=0,byeCode=0,stops=0,byes=0;public boolean throwStop=false,throwBye=false;
 public int callRecordFile(int id,String file){return kOK;}
 public int callPlayTone(int id,String tone,int ms,IdOutArg out){if(id<=0||!tone.equals("1")||ms!=3000)throw new AssertionError("Unexpected tone");out.value=701;return kOK;}
 public int callStopRecordFile(int id){stops++;if(throwStop)throw new IllegalStateException("stub stop failed");return stopCode;}
 public int callBye(int id){byes++;if(throwBye)throw new IllegalStateException("stub bye failed");return byeCode;}
}
