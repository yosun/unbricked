import { ulid } from "ulid";
export function makeId(kind) {
    return `${kind}_${ulid()}`;
}
