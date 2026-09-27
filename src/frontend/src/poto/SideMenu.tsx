/**
 * Port of the legacy `side-menu` popup (`Ug`) — a small "about" panel opened from
 * the top-bar hamburger. Rendered inside a <side-menu> wrapper for CSS-hook parity.
 */
export function SideMenu() {
  return (
    <side-menu>
      <footer class="flex-col gap-050">
        <div class="flex-row gap-075 y-bottom mg-b-100">
          <img src="/assets/poto_logo.svg" class="side-menu__logo" alt="Hytic" draggable={false} />
          <span data-pro-badge>PRO</span>
        </div>
        <span class="text-xs text-darker side-menu__note">
          Hytic — a local-first color editor. Your files stay privately on your device and are never
          uploaded to a server.
        </span>
      </footer>
    </side-menu>
  );
}
