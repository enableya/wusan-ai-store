import type {DatabaseSync} from 'node:sqlite';

// The arguments are trusted SQL expressions from server code, never request input.
// A browser identifier is a first-party persistent cookie, not a hardware fingerprint.
export function sameDeviceReferralSql(inviter:string,owner:string,buyer:string){
  return `(${inviter}=${buyer} OR EXISTS (
    SELECT 1 FROM customer_browsers inviter_device
    JOIN customer_browsers shared_account ON shared_account.owner_hash=inviter_device.owner_hash
    WHERE inviter_device.customer_id=${inviter} AND (
      shared_account.customer_id=${buyer} OR EXISTS (
        SELECT 1 FROM customer_browsers buyer_device
        WHERE buyer_device.customer_id=shared_account.customer_id AND buyer_device.owner_hash=${owner}
      )
    )
  ))`;
}
export function isSameDeviceReferral(db:DatabaseSync,owner:string,inviter:string,buyer?:string|null){
  return !!db.prepare('SELECT '+sameDeviceReferralSql('$inviter','$owner','$buyer')+' AS blocked')
    .get({$inviter:inviter,$owner:owner,$buyer:buyer??null})?.blocked;
}
