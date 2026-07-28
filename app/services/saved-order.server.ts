import prisma from "../db.server";

/**
 * F4 — saved order lists (buyer favourites / recurring orders). Company-scoped.
 * The per-plan cap is enforced here on create.
 */

export class SavedListCapError extends Error {
  constructor(public cap: number) {
    super(`Saved-list limit reached (${cap}).`);
    this.name = "SavedListCapError";
  }
}

export interface SavedListRow {
  id: string;
  name: string;
  itemCount: number;
}

export async function listSavedLists(companyId: string): Promise<SavedListRow[]> {
  const lists = await prisma.savedOrderList.findMany({
    where: { companyId },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });
  return lists.map((l) => ({ id: l.id, name: l.name, itemCount: l._count.items }));
}

export async function countSavedLists(companyId: string): Promise<number> {
  return prisma.savedOrderList.count({ where: { companyId } });
}

export interface SavedItemInput {
  variantId: string;
  qty: number;
}

/** Create a saved list from cart items, enforcing the plan cap. */
export async function createSavedList(
  companyId: string,
  name: string,
  items: SavedItemInput[],
  cap: number,
): Promise<{ id: string }> {
  const count = await countSavedLists(companyId);
  if (count >= cap) throw new SavedListCapError(cap);
  const clean = items
    .filter((i) => i.variantId && Number.isInteger(i.qty) && i.qty >= 1)
    .map((i) => ({ variantId: i.variantId, qty: i.qty }));
  const list = await prisma.savedOrderList.create({
    data: {
      companyId,
      name: name.trim() || "Saved list",
      items: { create: clean },
    },
    select: { id: true },
  });
  return list;
}

/** Items of a saved list, ownership-scoped to the company. */
export async function getSavedListItems(companyId: string, listId: string): Promise<SavedItemInput[]> {
  const list = await prisma.savedOrderList.findFirst({
    where: { id: listId, companyId },
    include: { items: true },
  });
  if (!list) return [];
  return list.items.map((i) => ({ variantId: i.variantId, qty: i.qty }));
}

export async function deleteSavedList(companyId: string, listId: string): Promise<void> {
  await prisma.savedOrderList.deleteMany({ where: { id: listId, companyId } });
}
