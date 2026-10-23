/** Keyboard viewport belongs to the dialog; it must not resize the 3D workspace. */
export function bindDialogViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const update = () => {
    const header = document.querySelector('.minitool-header');
    const pageHeader = header ?? document.querySelector('.site-header');
    root.style.setProperty('--dialog-header-space', `${pageHeader ? Math.max(0, pageHeader.getBoundingClientRect().bottom - (viewport?.offsetTop || 0)) : 0}px`);
    root.style.setProperty('--dialog-native-header', `${header ? Math.max(64, header.getBoundingClientRect().bottom - (viewport?.offsetTop || 0)) : 0}px`);
    root.style.setProperty('--dialog-height', `${viewport?.height || window.innerHeight}px`);
    root.style.setProperty('--dialog-width', `${viewport?.width || window.innerWidth}px`);
    root.style.setProperty('--dialog-top', `${viewport?.offsetTop || 0}px`);
    root.style.setProperty('--dialog-left', `${viewport?.offsetLeft || 0}px`);
  };
  update();
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  return () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    for (const key of ['height', 'width', 'top', 'left', 'native-header', 'header-space']) root.style.removeProperty(`--dialog-${key}`);
  };
}
