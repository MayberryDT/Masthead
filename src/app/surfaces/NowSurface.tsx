import type { ReactNode } from "react";

type Props = {
  toolbar: ReactNode;
  board: ReactNode;
};

export function NowSurface({ toolbar, board }: Props) {
  return (
    <section className="app-surface now-surface" aria-label="Now">
      {toolbar}
      {board}
    </section>
  );
}
