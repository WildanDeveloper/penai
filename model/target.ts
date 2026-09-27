/** An asset the operator has authorised for this engagement. */

export interface Target {
  id: string;
  value: string;
  kind: 'ip' | 'cidr' | 'host' | 'url';
  note?: string;
  addedAt: string;
}
