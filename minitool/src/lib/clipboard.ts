/** Select visible text for the user to copy manually with the system's text controls. */
export function selectManualCopyText(field: HTMLTextAreaElement): void {
  field.select();
  field.setSelectionRange(0, field.value.length);
}
