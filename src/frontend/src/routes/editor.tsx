import { clientOnly } from "@solidjs/start";
import { Title } from "@solidjs/meta";
import { RouteState } from "./routeState";

const EditorShell = clientOnly(() => import("../editor/EditorShell"));

export function EditorSurface(props: { pathname?: string }) {
  return (
    <RouteState locale="en" pathname={props.pathname ?? "/editor"}>
      <Title>Hytic</Title>
      <EditorShell />
    </RouteState>
  );
}

export default function EditorRoute() { return <EditorSurface />; }
