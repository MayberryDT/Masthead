import type { IconWeight } from "@phosphor-icons/react";

export const iconSizes = {
  sidebar: 18,
  toolbar: 16,
  cardMeta: 14,
  inline: 14,
  panel: 16
} as const;

export type IconSizeToken = keyof typeof iconSizes;

export const iconWeights = {
  sidebarInactive: "regular",
  sidebarSelected: "bold",
  toolbar: "regular",
  cardMeta: "regular",
  inline: "regular",
  panel: "regular"
} satisfies Record<string, IconWeight>;
