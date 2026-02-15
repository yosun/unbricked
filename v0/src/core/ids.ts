import { ulid } from "ulid";

export type BrickedId<K extends string> = `${K}_${string}`;

export function makeId<K extends string>(kind: K): BrickedId<K> {
  return `${kind}_${ulid()}` as BrickedId<K>;
}
