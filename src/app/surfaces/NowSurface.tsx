import type { ReactNode } from "react";

type Props = {
  toolbar: ReactNode;
  board: ReactNode;
};

export function NowSurface({ toolbar, board }: Props) {
  return (
    <section id="board" className="app-surface now-surface" aria-label="Board">
      {toolbar}
      {board}
    </section>
  );
}
