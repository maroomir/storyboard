import { AnimatePresence, motion } from "framer-motion"
import type React from "react"
import { useId, useState } from "react"

export type TabItem = {
  readonly id: string
  readonly label: string
  readonly panel: React.ReactNode
}

export type TabsProps = {
  readonly items: readonly TabItem[]
  readonly initialId?: string
}

export function Tabs({ items, initialId }: TabsProps): React.ReactElement {
  const baseId = useId()
  const firstId = items[0]?.id ?? ""
  const [activeId, setActiveId] = useState(initialId ?? firstId)
  const active = items.find((item) => item.id === activeId) ?? items[0]

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1 border-b border-sb-border pb-1" role="tablist">
        {items.map((item) => {
          const selected = item.id === active?.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              id={`${baseId}-tab-${item.id}`}
              aria-controls={`${baseId}-panel-${item.id}`}
              className={
                selected
                  ? "rounded-t border border-b-0 border-sb-border bg-sb-bg-widget px-2 py-1 text-sm font-medium text-sb-fg"
                  : "rounded-t border border-transparent px-2 py-1 text-sm text-sb-fg-muted hover:bg-sb-bg-list-hover"
              }
              onClick={() => setActiveId(item.id)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      <AnimatePresence mode="wait">
        {active ? (
          <motion.div
            key={active.id}
            role="tabpanel"
            id={`${baseId}-panel-${active.id}`}
            aria-labelledby={`${baseId}-tab-${active.id}`}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.18 }}
            className="min-h-0 min-w-0"
          >
            {active.panel}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
