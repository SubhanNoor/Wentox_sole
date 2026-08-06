# Wentox UI/UX Frontend Design System Guidelines

This document contains the official design specifications for UI components across the Wentox application. All future pages, tabs, and components must adhere to these guidelines.

---

## 1. Card Components Standard

All summary cards (e.g. Weekly Records, Monthly Records, Overall Records, Customer Cards, Setup Summary Cards) must strictly follow these layout, sizing, and interaction rules:

### A. Container & Grid Specifications
- **Page Container**: Roomy & spacious container max-width (`style={{ maxWidth: 1400 }}`).
- **Grid Layout**: 3-column responsive grid spacing (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`).

### B. Base Card Styling & Hover Effects
- **Base Class**:
  ```tsx
  className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
  ```
- **Key Interactive Effects**:
  1. **Lift Animation**: `hover:-translate-y-1.5` with `transition-all duration-300`.
  2. **Golden Edge Ring**: `hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)]`.
  3. **Elevated Golden Shadow**: `hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)]`.
  4. **Title Accent**: `group-hover:text-[var(--brand-navy)] transition-colors`.
  5. **Footer Arrow Shift**: `group-hover:translate-x-1 transition-transform`.

### C. Complete Card Component Template
```tsx
<div className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]">
  <div>
    {/* Header: Title + Pill Badge */}
    <div className="flex items-start justify-between gap-2 mb-1.5">
      <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors line-clamp-1">
        {CustomerName}
      </h4>
      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0">
        {CityBadge}
      </span>
    </div>

    {/* Subtitle Code */}
    <div className="font-mono text-xs text-slate-400 mb-2">
      Customer ID: <span className="font-semibold text-slate-600">#{CustomerID}</span>
    </div>
  </div>

  {/* Footer Bar */}
  <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-2">
    <div className="flex items-center gap-1.5 bg-amber-50/90 text-amber-900 px-3 py-1 rounded-full text-xs font-semibold border border-amber-200/70">
      <FileText size={13} className="text-amber-600" />
      <span>{BillCount} Bills</span>
    </div>
    <span className="text-amber-700 font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
      View Details <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
    </span>
  </div>
</div>
```

---

## 2. Custom Popover Dropdown Standard

All filter dropdowns (e.g. Month Filter, Year Select, Category Select, Status Filter) must use custom popover menu styling matching the site's gold and navy design system. **Do NOT use native browser `<select>` dropdowns.**

### A. Popover Component Architecture
```tsx
<div className="relative min-w-[170px]" ref={dropdownRef}>
  {/* Trigger Button */}
  <button
    type="button"
    onClick={() => setIsOpen(!isOpen)}
    className="flex items-center justify-between w-full pl-10 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs"
  >
    <Calendar className="absolute left-3.5 top-2.5 text-slate-400" size={17} />
    <span className="truncate text-slate-800 font-semibold">{selectedLabel}</span>
    <ChevronDown
      className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`}
      size={16}
    />
  </button>

  {/* Custom Options List Popup */}
  {isOpen && (
    <div
      className="absolute right-0 w-48 top-[calc(100%+6px)] z-50 py-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl max-h-60 overflow-y-auto scrollbar-thin"
      style={{ boxShadow: '0 14px 34px rgba(27,42,65,0.14)' }}
    >
      <button
        type="button"
        onClick={() => { onSelect('all'); setIsOpen(false); }}
        className={`w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
          selectedValue === 'all'
            ? 'bg-[var(--brand-gold)] text-white'
            : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
        }`}
      >
        <span>All Items</span>
        {selectedValue === 'all' && <Check size={14} className="text-white" />}
      </button>
      <div className="my-1 border-t border-slate-100" />
      {optionsList.map(opt => {
        const isSelected = selectedValue === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => { onSelect(opt.value); setIsOpen(false); }}
            className={`w-full text-left px-3.5 py-2 text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${
              isSelected
                ? 'bg-[var(--brand-gold)] text-white font-semibold'
                : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
            }`}
          >
            <span>{opt.label}</span>
            {isSelected && <Check size={14} className="text-white" />}
          </button>
        );
      })}
    </div>
  )}
</div>
```

---

## 3. Filter Toolbar & Top Bar Layout Standard

Filter toolbars across records pages must be clean, spacious, and balanced:

- **Outer Toolbar Container**: Full width across the page container (`w-full` inside `maxWidth: 1400`).
  ```tsx
  className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white shadow-2xs"
  ```
- **Left Side**: Search Input field with search icon (`max-w-md`).
- **Right Side**: Custom Popover Dropdowns + Record Count badge (`flex items-center gap-3`).

---

## 4. Table Action Buttons Standard (Edit & Print Icons)

All data tables rendering row-level actions (e.g. Sale Bills tables in Weekly, Monthly, Overall, and Find & Update tabs) must use standard compact icon action buttons:

- **Container**: `flex items-center justify-center gap-2`
- **Edit Action Button (`Edit2` icon)**:
  - Base class: `p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer`
  - Icon size: `<Edit2 size={15} />`
  - Tooltip: `title="Edit Bill"`
- **Print Action Button (`Printer` icon)**:
  - Base class: `p-1.5 rounded-lg hover:bg-amber-50 text-slate-500 hover:text-[var(--brand-gold)] transition-colors cursor-pointer`
  - Icon size: `<Printer size={15} />`
  - Tooltip: `title="Print Bill"`

---

## 5. Customer Detail View & Animation Standard

When opening a detailed record view from a summary card (and navigating back to the summary grid):

- **Entrance Animation**: `animate-in fade-in slide-in-from-bottom-3 duration-300`
- **Exit Animation**: Managed via `isClosing` state and 200ms timeout (`opacity-0 translate-y-2 scale-98`)
- **Card Wrapper**:
  ```tsx
  <div className={`card-white p-6 bg-white border border-slate-200/80 shadow-md rounded-2xl transition-all duration-200 ${
    isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'
  }`}>
  ```
- **Header Structure**:
  - Round back icon button (`w-10 h-10 rounded-full border border-slate-200/80 hover:bg-slate-50 text-slate-600 flex items-center justify-center shadow-2xs hover:scale-105 cursor-pointer`).
  - Title in `font-lora font-bold text-xl text-slate-900`.
  - Right-aligned **Back to Customers Box Button**:
    ```tsx
    <button
      type="button"
      onClick={handleBack}
      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all shadow-2xs hover:shadow-xs cursor-pointer hover:-translate-x-0.5"
    >
      <ArrowLeft size={14} className="text-amber-700" />
      <span>Back to Customers</span>
    </button>
    ```
- **Table Headers**: `Date`, `Sys ID`, `Bill No.`, `Sub-Customer`, `Cartons`, `Pairs`, `Bilty No. / Adda`, `Invoice Value`, `Actions`.

---

## 6. SearchableSelect Component Standard

The `SearchableSelect` component is a **searchable dropdown** used when the option list is long and requires live filtering by typing. It differs from the Custom Popover Dropdown (§2) in that it contains an embedded search input.

> **Rule**: Use `SearchableSelect` when the list has more than ~10 items or when the user must type to find their selection (e.g. Customer Account, Vendor, Business Account, Bank, Cheque). Use the Custom Popover Dropdown (§2) for short, fixed lists (e.g. Month, Year, Status).

### Usage

```tsx
import SearchableSelect from '@/components/SearchableSelect';

<SearchableSelect
  options={[
    { value: 'id1', label: 'Option Label 1' },
    { value: 'id2', label: 'Option Label 2' },
  ]}
  value={selectedValue}
  onChange={(val) => setSelectedValue(val)}
  placeholder="Search and select..."
  searchPlaceholder="Type to filter..."  {/* optional */}
/>
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `options` | `{ value: string; label: string }[]` | ✅ | The full list of selectable options |
| `value` | `string` | ✅ | The currently selected value |
| `onChange` | `(value: string) => void` | ✅ | Callback fired when user selects an option |
| `placeholder` | `string` | — | Text shown when nothing is selected |
| `searchPlaceholder` | `string` | — | Placeholder inside the search input field |

### Behavior
- Clicking the trigger opens a popover panel with an embedded `<input type="text" />` search field at the top.
- The search input auto-focuses when the popover opens.
- Typing filters the option list in real-time (case-insensitive substring match on `label`).
- Clicking an option selects it, calls `onChange`, and closes the popover.
- Clicking outside the popover closes it without changing the selection.
- The trigger button displays the selected option's `label`, or the `placeholder` if nothing is selected.

### Do NOT replace SearchableSelect with a Custom Popover Dropdown (§2)
The Custom Popover Dropdown is only for short, fixed option lists. SearchableSelect must be kept for any field where users search through many items.

---

## 7. Predefined Quick Filter Pills Standard

All predefined category/status quick filter pill groups (e.g. Overall Trail category pills, Sale Bills Find & Update quick audit pills, Reports Hub tab pills) must strictly adhere to the following styling and layout rules:

### A. Active Pill State
`bg-[#111c2a] text-[#B08D57] shadow-sm font-bold` (dark navy box with brand gold text accent).

### B. Inactive Pill State
`bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200` (clean subtle light gray pill with hover highlight).

### C. Container & Alignment Layout
- Outer container: `flex flex-wrap items-center gap-1.5 border-t pt-3 mt-3 border-slate-100` inside a card container (`card-white p-5 bg-white border border-slate-200/80 rounded-2xl mb-5 shadow-2xs`).
- Left side: Label with icon (e.g. `<Filter size={13} /> Quick Filter:`).
- Right side: Quick filter pill buttons aligned inline.
