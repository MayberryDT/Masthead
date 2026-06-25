import { useContext } from "react";
import { MastheadConnectionContext } from "./MastheadConnectionProvider";

export function useMastheadConnection() {
  const context = useContext(MastheadConnectionContext);
  if (!context) throw new Error("useMastheadConnection must be used inside MastheadConnectionProvider");
  return context;
}
