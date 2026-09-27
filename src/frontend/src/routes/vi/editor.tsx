import { clientOnly } from "@solidjs/start";
import { Title } from "@solidjs/meta";
import { RouteState } from "../routeState";

const EditorShell = clientOnly(() => import("../../editor/EditorShell"));

export function ViEditorSurface(props: { pathname?: string }) {
  return (
    <RouteState locale="vi" pathname={props.pathname ?? "/vi/editor"}>
      <Title>Hytic</Title>
      <EditorShell />
    </RouteState>
  );
}

export default function ViEditor() { return <ViEditorSurface />; }
