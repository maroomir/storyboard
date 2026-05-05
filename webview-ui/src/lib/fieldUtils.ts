import type { CardAttributeValue } from "./types"

export function replaceArrayItem<T>(items: readonly T[], index: number, nextItem: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? nextItem : item))
}

export function removeArrayItem<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index)
}

export function renameRecordKey(
  record: Record<string, CardAttributeValue>,
  previousKey: string,
  nextKey: string
): Record<string, CardAttributeValue> {
  const nextRecord: Record<string, CardAttributeValue> = {}

  for (const [key, value] of Object.entries(record)) {
    nextRecord[key === previousKey ? nextKey : key] = value
  }

  return nextRecord
}

export function removeRecordKey(
  record: Record<string, CardAttributeValue>,
  targetKey: string
): Record<string, CardAttributeValue> {
  const nextRecord = { ...record }
  delete nextRecord[targetKey]
  return nextRecord
}
