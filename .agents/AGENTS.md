# UI/UX Frontend Design System Guidelines

## 1. Card Components Standard
All summary cards (e.g. Weekly Records, Monthly Records, Overall Records, Customer Cards, Setup Summary Cards) across the application must strictly adhere to the following design specifications:

- **Container Layout**: Roomy & spacious container max-width (`style={{ maxWidth: 1400 }}`).
- **Grid Layout**: 3-column responsive grid spacing (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`).
- **Base Card Style**:
  ```tsx
  className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
  ```
- **Hover Effects**:
  - **Lift Animation**: `hover:-translate-y-1.5` with `transition-all duration-300`.
  - **Golden Edge Ring**: `hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)]`.
  - **Elevated Shadow**: `hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)]`.
  - **Title Accent**: `group-hover:text-[var(--brand-navy)] transition-colors`.
- **Card Content**:
  - **Header**: Customer / Entity Name (`font-lora font-bold text-lg text-slate-900`) + Pill City/Category badge.
  - **Subtitle**: Entity ID / Code in mono (`font-mono text-xs text-slate-400`).
  - **Footer Bar**: Action badge / pill + Hover Arrow shift (`group-hover:translate-x-1 transition-transform`).

---

## 2. Dropdown & Select Control Standard
All filter dropdowns (e.g. Month Filter, Year Select, Category Select, Status Filter) must use custom popover dropdown styling matching the site design:

- **Button Trigger**:
  ```tsx
  <div className="relative min-w-[170px]" ref={dropdownRef}>
    <button
      type="button"
      onClick={() => setIsOpen(!isOpen)}
      className="flex items-center justify-between w-full pl-10 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium text-slate-[#700] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs"
    >
      <Calendar className="absolute left-3.5 top-2.5 text-slate-400" size={17} />
      <span className="truncate text-slate-800 font-semibold">{selectedLabel}</span>
      <ChevronDown className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`} size={16} />
    </button>
  </div>
  ```
- **Custom Options List Popup**:
  - Selected item: `bg-[var(--brand-gold)] text-white font-semibold` with `<Check size={14} />`.
  - Hovering options: `hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]`.
  - Container: `rounded-xl border border-slate-200/90 shadow-xl bg-white`.

---

## 3. Filter Toolbar & Top Bar Layout Standard
- Outer toolbar container spans full width (`w-full` inside `maxWidth: 1400`).
- Left Side: Search input (`max-w-md`).
- Right Side: Custom Popover Dropdowns + Record Count badge (`flex items-center gap-3`).

---

## 4. Table Action Buttons Standard (Edit & Print Icons)
All data tables rendering row-level actions must use standard compact icon action buttons:
- Edit Button (`Edit2` icon): `p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer`
- Print Button (`Printer` icon): `p-1.5 rounded-lg hover:bg-amber-50 text-slate-500 hover:text-[var(--brand-gold)] transition-colors cursor-pointer`

---

## 5. Customer Detail View & Animation Standard
- Entrance animation: `animate-in fade-in slide-in-from-bottom-3 duration-300`.
- Exit animation: Managed via `isClosing` state + 200ms timeout (`opacity-0 translate-y-2 scale-98`).
- Layout: Round `ArrowLeft` button, title in `font-lora font-bold text-xl text-slate-900`, styled pill-box `Back to Customers` button (`bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl`), and standardized table headers (`Date`, `Sys ID`, `Bill No.`, `Sub-Customer`, `Cartons`, `Pairs`, `Bilty No. / Adda`, `Invoice Value`, `Actions`).

---

## 6. Predefined Quick Filter Pills Standard
All predefined category/status quick filter pill groups (e.g. Overall Trail category pills, Sale Bills Find & Update quick filters, Reports Hub tab pills) must use the following standard styling:
- **Active Pill State**: `bg-[#111c2a] text-[#B08D57] shadow-sm font-bold` (dark navy box with brand gold text accent).
- **Inactive Pill State**: `bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200` (clean subtle light gray pill with hover highlight).
- **Container Layout**: Flex container with gap spacing (`flex flex-wrap items-center gap-1.5`).
