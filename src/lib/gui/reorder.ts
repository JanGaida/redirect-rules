// * Pure index math shared by all drag-and-drop reorders (ADR 0017 spirit:
//   sequence rules in one place, presentation calls it).

/**
 * Final index after removing `from` and inserting at a drop target.
 *
 * @param from        - Current index of the dragged item.
 * @param target      - Drop target index (before adjustment).
 * @param insertAfter - Drop below the target's midpoint?
 * @param length      - Item count BEFORE the removal.
 */
export function moveIndex(from: number, target: number, insertAfter: boolean, length: number): number {
    if (length <= 0) return 0;
    let index = insertAfter ? target + 1 : target;
    if (from < index) index -= 1;
    return Math.max(0, Math.min(index, length - 1));
}

/** Immutable item move — invalid indexes return a shallow copy unchanged. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
    if (from < 0 || from >= items.length) return [...items];
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
    return next;
}

/** Immutable boolean-flag move (lock arrays). */
export function moveFlag(flags: readonly boolean[], from: number, to: number): boolean[] {
    return moveItem(flags, from, to);
}

/** Remaps an item index across a move (selection/fold keys). */
export function remapIndex(index: number, from: number, to: number): number {
    if (index === from) return to;
    if (from < to && index > from && index <= to) return index - 1;
    if (from > to && index >= to && index < from) return index + 1;
    return index;
}

/** Index after removing one item. */
export function shiftIndexAfterRemove(index: number, removed: number): number {
    if (index <= removed) return index;
    return index - 1;
}

/** Index after inserting one item. */
export function shiftIndexAfterInsert(index: number, insertedAt: number): number {
    return index >= insertedAt ? index + 1 : index;
}
