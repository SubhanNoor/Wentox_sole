# Text Contrast & Boldness — Style Rules

Small checklist for the "field labels bold, typed text black, highlight bar dark" fix requested
by the user (2026-08-26). Already applied to `PurchasePage.tsx`, `PurchaseReturnPage.tsx`,
`ReceiptsPage.tsx`, `ExpensesPage.tsx`, and the shared `SearchModal.tsx`/`SearchableSelect.tsx`
components — apply the same four rules to any other entry-form page.

## 1. Field labels ("headings of the box") → bold

Every `<label>` above an input/picker:

```diff
-<label className="block text-xs font-medium text-slate-600 mb-1">Vendor</label>
+<label className="block text-xs font-bold text-slate-900 mb-1">Vendor</label>
```

(Some pages used `font-semibold` instead of `font-medium` for the same label — same fix either
way: → `font-bold text-slate-900`.)

## 2. Typed/real text → black, placeholders → readable but lighter

- `.soleria-input` (global, `src/index.css`): `color: #000000` (was the dark-navy heading tint,
  `var(--dark-heading)` — too washed out).
- `.soleria-input::placeholder`: `color: #64748b` (slate-500) — darkened from the browser default,
  still visibly lighter than real text so the two don't get confused.
- Picker trigger buttons (Vendor/Account/"Find X" buttons built from a `<button>` + `<span>`, not a
  real `<input>`) — same idea, applied inline since they don't go through `.soleria-input`:
  ```diff
  -<span className={value ? 'text-slate-800 font-semibold' : 'text-slate-400'}>
  +<span className={value ? 'text-black font-semibold' : 'text-slate-500'}>
  ```
- **Exception — leave alone**: fields that are deliberately read-only/locked (a master field once
  a document/voucher exists, a computed System Bill/Voucher No.) keep `bg-slate-100
  text-slate-500` — that greyed-out look is the intentional "you can't type here" signal from
  earlier work. Don't blacken those; it would erase the distinction.

## 3. Highlight bar in `SearchModal`/`SearchableSelect` → dark, not pale cream

Both components' keyboard/hover-highlighted row used a nearly-invisible `bg-[#fbf7f0]`. Changed to
solid navy with white bold text, so it reads clearly against the selected-row gold:

```diff
 className={
   isSelected
-    ? 'bg-[var(--brand-gold)] text-white font-semibold'
+    ? 'bg-[var(--brand-gold)] text-white font-bold'
     : isHighlighted
-    ? 'bg-[#fbf7f0] text-[var(--brand-navy)]'
-    : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
+    ? 'bg-[var(--brand-navy)] text-white font-bold'
+    : 'text-black hover:bg-[var(--brand-navy)] hover:text-white'
 }
```

Search box inside these modals: same text-black/placeholder-slate-500 treatment as §2.

## 4. Card/section headings → bold

`font-lora font-semibold text-lg text-slate-800` → `font-lora font-bold text-lg text-slate-900`
on every card title ("Raw Material Purchase", "Recorded Purchases", `SearchModal`'s own `title`
prop heading, etc.).

## Where this still needs applying

- [ ] `SaleReturnPage.tsx` — reverted (2026-08-26): the user meant Purchase Return, not Sale
      Return, and Purchase Return was already done. Not touched.
- [x] `PurchasePage.tsx`
- [x] `PurchaseReturnPage.tsx`
- [x] `ReceiptsPage.tsx`
- [x] `ExpensesPage.tsx`
- [x] `SearchModal.tsx` / `SearchableSelect.tsx` (shared, so every page picking through them
      already benefits from §3 automatically)
