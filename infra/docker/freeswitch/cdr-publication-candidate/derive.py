"""Upstream-reference prototype only, never a deployed module derivation."""
import difflib,hashlib,json
from pathlib import Path
P=Path(__file__).resolve().parent;SHA='cc21d03d205979eb1c99f2db4d3d9f6eb4465eab64b676f8fdadd6368df811fc';sha=lambda b:hashlib.sha256(b).hexdigest()
def candidate():
 raw=(P/'upstream-v1.10.12-mod_xml_cdr.c').read_bytes();assert sha(raw)==SHA;s=raw.decode()
 s=s.replace('#include <switch_curl.h>','#include <switch_curl.h>\n#if defined(__linux__) || defined(__APPLE__)\n#include "cdr_atomic_publish.h"\n#endif',1).replace('\tchar *base_err_log_dir;','\tchar *base_err_log_dir;\n\tchar *completed_err_log_dir; /* New separate namespace, opt-in only. */',1)
 wrapper='''/* Source-only prototype; no automatic replay or modification of old spool. */
static switch_status_t publish_completed_error(switch_core_session_t *session, const char *prefix, const char *body)
{
#if defined(__linux__) || defined(__APPLE__)
 int dirfd, closed; enum cdr_publication result;
 char *final = NULL, *pending = NULL;
 switch_uuid_t random; char nonce[SWITCH_UUID_FORMATTED_LENGTH + 1];
 dirfd = open(globals.completed_err_log_dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
 if (dirfd < 0) return SWITCH_STATUS_FALSE;
 switch_uuid_get(&random); switch_uuid_format(nonce, &random);
 final = switch_mprintf("%s%s.cdr.xml", prefix, switch_core_session_get_uuid(session));
 if (final) pending = switch_mprintf(".%s.%s.pending", final, nonce);
 result = pending ? cdr_publish_at(dirfd, pending, final, body, strlen(body), NULL) : CDR_PUBLICATION_RETAINED;
 closed = close(dirfd); /* Never retry an ambiguous close. */
 switch_safe_free(pending); switch_safe_free(final);
 if (closed != 0) result = CDR_PUBLICATION_UNCERTAIN;
 if (result != CDR_PUBLICATION_COMPLETE) {
  switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_ERROR, "CDR completed publication retained or uncertain; code=%d\\n", (int)result);
  return SWITCH_STATUS_FALSE;
 }
 return SWITCH_STATUS_SUCCESS;
#else
 (void)session; (void)prefix; (void)body;
 return SWITCH_STATUS_FALSE;
#endif
}
'''
 mark='static switch_status_t set_xml_cdr_log_dirs(void)';assert s.count(mark)==1;s=s.replace(mark,wrapper+mark)
 mark='\t\t/* if we are here the web post failed for some reason */';assert s.count(mark)==1;s=s.replace(mark,mark+'''\n        if (globals.completed_err_log_dir) {
            if (publish_completed_error(session, a_prefix, xml_text) != SWITCH_STATUS_SUCCESS) goto error;
            goto success;
        }
''')
 mark='\t\t\t} else if (!strcasecmp(var, "err-log-dir")) {';assert s.count(mark)==1;s=s.replace(mark,'''\t\t\t} else if (!strcasecmp(var, "error-completed-dir") && !zstr(val)) {
                /* Explicit preprovisioned absolute directory; never create or rotate it. */
                if (val[0] != '/') {
                    switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_ERROR, "error-completed-dir must be absolute\\n");
                    switch_xml_free(cfg);
                    switch_event_unbind(&globals.node);
                    switch_core_remove_state_handler(&state_handlers);
                    switch_thread_rwlock_destroy(globals.log_path_lock);
                    return SWITCH_STATUS_FALSE;
                }
                globals.completed_err_log_dir = switch_core_strdup(globals.pool, val);
'''+mark)
 return raw,s.encode()
if __name__=='__main__':
 old,new=candidate();(P/'candidate-mod_xml_cdr.c').write_bytes(new);path='src/mod/xml_int/mod_xml_cdr/';patch=''.join(difflib.unified_diff(old.decode().splitlines(True),new.decode().splitlines(True),fromfile='a/'+path+'mod_xml_cdr.c',tofile='b/'+path+'mod_xml_cdr.c'));header=(P/'cdr_atomic_publish.h').read_text();patch+=''.join(difflib.unified_diff([],header.splitlines(True),fromfile='/dev/null',tofile='b/'+path+'cdr_atomic_publish.h'));(P/'upstream-prototype.patch').write_text(patch);print(json.dumps({'upstreamSha256':sha(old),'candidateSha256':sha(new),'patchSha256':sha(patch.encode())}))
