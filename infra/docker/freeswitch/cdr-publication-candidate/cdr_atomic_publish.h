/* Source-only upstream prototype. Not an attested deployed FreeSWITCH module. */
#ifndef PHONE11_CDR_ATOMIC_PUBLISH_H
#define PHONE11_CDR_ATOMIC_PUBLISH_H
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#if defined(__linux__)
#include <sys/syscall.h>
#endif
/* A visible final name always follows full checked write, file fsync and close.
 * COMPLETE additionally means directory fsync succeeded. On any other outcome
 * preserve every created pending/final entry; never retry close or overwrite. */
enum cdr_publication { CDR_PUBLICATION_COMPLETE=0, CDR_PUBLICATION_RETAINED=1,
                       CDR_PUBLICATION_UNCERTAIN=2 };
struct cdr_publish_ops {
 ssize_t (*write_file)(int,const void *,size_t);
 int (*sync_fd)(int);
 int (*close_file)(int);
 int (*rename_exclusive)(int,const char *,const char *);
};
static int cdr_rename_exclusive(int dirfd,const char *from,const char *to)
{
#if defined(__linux__) && defined(SYS_renameat2)
 return (int)syscall(SYS_renameat2,dirfd,from,dirfd,to,1U); /* RENAME_NOREPLACE */
#elif defined(__APPLE__)
 /* Local prototype tests only; not Linux adapter/build qualification. */
 return renameatx_np(dirfd,from,dirfd,to,RENAME_EXCL);
#else
 (void)dirfd;(void)from;(void)to;errno=ENOTSUP;return -1;
#endif
}
static int cdr_leaf(const char *name)
{
 size_t i,n;if(!name)return 0;n=strlen(name);if(!n||n>160)return 0;
 for(i=0;i<n;i++)if(!((name[i]>='a'&&name[i]<='z')||(name[i]>='A'&&name[i]<='Z')||
 (name[i]>='0'&&name[i]<='9')||name[i]=='_'||name[i]=='-'||name[i]=='.'))return 0;
 return strcmp(name,".")&&strcmp(name,"..");
}
static enum cdr_publication cdr_publish_at(int dirfd,const char *pending,
 const char *final,const void *body,size_t length,const struct cdr_publish_ops *injected)
{
 static const struct cdr_publish_ops native={write,fsync,close,cdr_rename_exclusive};
 const struct cdr_publish_ops *ops=injected?injected:&native;
 struct stat dir,file,named;int fd=-1,saved=0;size_t offset=0;unsigned interrupts=0;
 if(!cdr_leaf(pending)||!cdr_leaf(final)||pending[0]!='.'||final[0]=='.'||
    !strcmp(pending,final)||!body||!length){errno=EINVAL;return CDR_PUBLICATION_RETAINED;}
 if(fstat(dirfd,&dir)||!S_ISDIR(dir.st_mode)||dir.st_uid!=geteuid()||
    (dir.st_mode&07777)!=0700){errno=EPERM;return CDR_PUBLICATION_RETAINED;}
 fd=openat(dirfd,pending,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
 if(fd<0)return CDR_PUBLICATION_RETAINED;
 if(fstat(fd,&file)||!S_ISREG(file.st_mode)||file.st_uid!=geteuid()||
    (file.st_mode&07777)!=0600||file.st_nlink!=1){saved=EPERM;goto retained;}
 while(offset<length){
  ssize_t n=ops->write_file(fd,(const char *)body+offset,length-offset);
  if(n<0&&errno==EINTR&&++interrupts<=64)continue;
  if(n<=0||(size_t)n>length-offset){saved=n<0?errno:EIO;goto retained;}
  offset+=(size_t)n;
 }
 if(fstat(fd,&file)||file.st_size<0||(size_t)file.st_size!=length||file.st_nlink!=1||file.st_uid!=geteuid()||(file.st_mode&07777)!=0600){saved=EIO;goto retained;}
 if(ops->sync_fd(fd)){saved=errno;goto retained;}
 /* POSIX close failure can leave descriptor state ambiguous: never retry it. */
 if(ops->close_file(fd)){saved=errno;fd=-1;errno=saved;return CDR_PUBLICATION_UNCERTAIN;}
 fd=-1;
 if(fstatat(dirfd,pending,&named,AT_SYMLINK_NOFOLLOW)||!S_ISREG(named.st_mode)||
    named.st_dev!=file.st_dev||named.st_ino!=file.st_ino||named.st_uid!=file.st_uid||
    named.st_nlink!=1||(named.st_mode&07777)!=0600||named.st_size!=file.st_size){errno=ESTALE;return CDR_PUBLICATION_RETAINED;}
 if(ops->rename_exclusive(dirfd,pending,final))return CDR_PUBLICATION_UNCERTAIN;
 if(ops->sync_fd(dirfd))return CDR_PUBLICATION_UNCERTAIN;
 return CDR_PUBLICATION_COMPLETE;
retained:
 if(fd>=0&&ops->close_file(fd)){errno=saved?saved:EIO;return CDR_PUBLICATION_UNCERTAIN;}
 errno=saved?saved:EIO;return CDR_PUBLICATION_RETAINED;
}
#endif
