import type { LogbookExcerpt, LogbookSessionDetail } from "../app/daemonClient";
import { LogbookInspector } from "./logbook/LogbookInspector";

type Props = {
  session?: LogbookSessionDetail;
  excerpts?: LogbookExcerpt[];
  loading?: boolean;
  onClose: () => void;
};

export function SessionLibraryDetail({ excerpts = [], ...props }: Props) {
  return <LogbookInspector excerpts={excerpts} {...props} />;
}
