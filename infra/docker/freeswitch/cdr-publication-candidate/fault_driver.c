/* Native helper fault checks with owned synthetic files only. */
#include <stdlib.h>
#include "cdr_atomic_publish.h"
static const char *fault;
static unsigned writes;
static ssize_t test_write(int fd,const void *body,size_t n)
{
 writes++;
 if(!strcmp(fault,"write")&&writes>1){errno=EIO;return -1;}
 if(!strcmp(fault,"zero"))return 0;
 if(!strcmp(fault,"eintr")&&writes==1){errno=EINTR;return -1;}
 if((!strcmp(fault,"write")||!strcmp(fault,"short"))&&n>1)n/=2;
 return write(fd,body,n);
}
static int test_sync(int fd)
{
 struct stat st;if(fstat(fd,&st))return -1;
 if((!strcmp(fault,"file-fsync")&&S_ISREG(st.st_mode))||(!strcmp(fault,"dir-fsync")&&S_ISDIR(st.st_mode))){errno=EIO;return -1;}
 if(fsync(fd))return -1;
 if(!strcmp(fault,"crash-after-file-sync")&&S_ISREG(st.st_mode))_Exit(81);
 return 0;
}
static int test_close(int fd)
{
 int rc=close(fd);if(!strcmp(fault,"close")){errno=EIO;return -1;}return rc;
}
static int test_rename(int fd,const char *a,const char *b)
{
 int rc;if(!strcmp(fault,"rename")){errno=EIO;return -1;}
 rc=cdr_rename_exclusive(fd,a,b);
 if(!rc&&!strcmp(fault,"crash-after-rename"))_Exit(82);
 return rc;
}
int main(int argc,char **argv)
{
 static const char body[]="%3Ccdr%3E%3Cvariables%3E%3Cuuid%3E00000000-0000-4000-8000-000000000001%3C%2Fuuid%3E%3C%2Fvariables%3E%3C%2Fcdr%3E";
 struct cdr_publish_ops ops={test_write,test_sync,test_close,test_rename};int fd;enum cdr_publication result;
 if(argc!=3)return 64;fault=argv[2];fd=open(argv[1],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return 70;
 result=cdr_publish_at(fd,".00000000-0000-4000-8000-000000000001.cdr.xml.nonce.pending","00000000-0000-4000-8000-000000000001.cdr.xml",body,sizeof(body)-1,&ops);
 if(close(fd))return 71;printf("{\"publication\":%d,\"writes\":%u}\n",result,writes);return 0;
}
