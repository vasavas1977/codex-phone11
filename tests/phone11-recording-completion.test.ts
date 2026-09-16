import { expect, it, vi } from 'vitest';
import { createCloudRecordingRepository } from '../server/cloud-recordings/repository';

it('does not advertise or expose corrupt ready analysis', async () => {
  const row={call_uuid:'call1',tenant_id:10,number:'123',direction:'outbound',started_at:new Date(),recording_status:'ready',summary_status:'ready',transcript:'Speaker 1: hello',summary:{summary:' ',actionItems:[],language:'en'}};
  const query=vi.fn().mockResolvedValue({rows:[row]});
  const repo=createCloudRecordingRepository({query} as any);
  expect(await repo.detail(1,'call1')).toMatchObject({summaryStatus:'failed'});
  expect((await repo.detail(1,'call1')).summary).toBeUndefined();
});

it('requeues invalid internal results without saving their payload', async () => {
  const query=vi.fn(async(sql:string) => ({rows:sql.startsWith('SELECT')?[{attempts:1}]:[]}));
  const client={query,release:vi.fn()};
  const repo=createCloudRecordingRepository({connect:async()=>client} as any);
  await expect(repo.finishJob({callUuid:'call1',tenantId:10,storageKey:'key',leaseToken:'lease'}, {transcript:'unlabeled',summary:{summary:'Recap',actionItems:[],language:'en'}})).resolves.toBe(true);
  const updates=query.mock.calls as unknown as [string,unknown[]][];
  expect(updates.find(([sql])=>sql.startsWith('UPDATE phone11_cloud_recordings'))?.[1]).toEqual(['call1','queued',null,null]);
  expect(updates.find(([sql])=>sql.startsWith('UPDATE phone11_recording_jobs'))?.[1]).toContain('invalid_result:parse');
});
