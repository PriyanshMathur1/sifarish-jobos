"use client";

/** Toggles every checkbox with the given `name` inside its closest <form>. */
export function SelectAllCheckbox({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      onChange={(e) => {
        const form = e.currentTarget.closest("form");
        if (!form) return;
        const boxes = form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`);
        boxes.forEach((b) => {
          b.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
