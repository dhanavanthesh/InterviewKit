import type { PropsWithChildren } from "react";
import { Workspace } from "../../components/workspace";
export default function KitsLayout({ children }: PropsWithChildren) {
  return <Workspace>{children}</Workspace>;
}
