import {describe,expect,it} from 'vitest';
import {hasExactCdrOwnership,ownershipFromTrustedRoute} from '../server/pbx/cdr-ownership';

describe('immutable CDR ownership',()=>{
 it('maps a trusted outbound owner to the caller',()=>expect(ownershipFromTrustedRoute({tenantId:10,extensionId:11,userId:2,direction:'outbound'})).toEqual({callerUserId:2,calleeUserId:null}));
 it('maps a trusted inbound owner to the callee',()=>expect(ownershipFromTrustedRoute({tenantId:10,extensionId:11,userId:2,direction:'inbound'})).toEqual({callerUserId:null,calleeUserId:2}));
 it.each([
  null,
  {tenantId:10,extensionId:11},
  {tenantId:10,extensionId:11,userId:0,direction:'outbound'},
  {tenantId:10,extensionId:11,userId:2,direction:'internal'},
 ])('fails closed for missing or ambiguous trusted identity: %j',route=>expect(ownershipFromTrustedRoute(route as any)).toEqual({callerUserId:null,calleeUserId:null}));
 it('requires the stored role and user to match exactly',()=>{
  const owner={callerUserId:2,calleeUserId:null};
  expect(hasExactCdrOwnership({caller_user_id:2,callee_user_id:null},owner)).toBe(true);
  expect(hasExactCdrOwnership({caller_user_id:null,callee_user_id:null},owner)).toBe(false);
  expect(hasExactCdrOwnership({caller_user_id:2,callee_user_id:3},owner)).toBe(false);
 });
});
