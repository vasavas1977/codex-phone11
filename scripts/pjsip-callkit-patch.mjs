export function patchCallKitAudioStartup(source) {
  const marker = "// Phone11: CallKit owns sound-device activation.";
  if (source.includes(marker)) return source;
  const anchor = 'if (status != PJ_SUCCESS) NSLog(@"Error starting pjsua");';
  if (!source.includes(anchor)) {
    throw new Error("PJSIP startup changed; review CallKit audio patch before building");
  }
  return source.replace(anchor, `${anchor}\n    ${marker}\n    pjsua_set_no_snd_dev();`);
}
