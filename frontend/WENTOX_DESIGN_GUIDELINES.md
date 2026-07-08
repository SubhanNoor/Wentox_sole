# Wentox ERP UI & Design Guidelines

This document outlines the visual language, typography, colors, layout structures, and icon standards for the Wentox ERP platform. Adherence to these guidelines ensures a cohesive, premium, and clean user experience.

---

## 1. Brand Identity & Colors
Wentox ERP uses a professional, high-contrast, premium dark navy and muted gold aesthetic.

| Element | Hex Code | Purpose / CSS Usage |
| :--- | :--- | :--- |
| **Primary Navy** | `#111c2a` | App header, navigation sidebar, active tab highlights, and primary text colors. |
| **Accent Gold** | `#B08D57` | Button borders/backgrounds, status badges, active indicators, and links. |
| **Secondary Accent** | `#d97706` (Amber) | Alert icons, warnings, and pending indicators. |
| **Background Light** | `#f8fafc` | Main screen body background. |
| **White Card** | `#ffffff` | Clean container boxes. |
| **Slate Borders** | `#e2e8f0` | Thin, clean lines separating layout elements. |

---

## 2. Typography & Fonts
*   **Font Family:** Clean, readable system sans-serif (e.g., `Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica Neue`).
*   **Rules:**
    *   Avoid default serif fonts.
    *   Do **not** use monospace font styles for main UI text or labels. Monospace is reserved exclusively for system codes, transaction IDs, and currency amounts.
    *   **Main Headings (Page titles):** `font-lora` with medium font weight for a clean editorial feel.
    *   **UI Labels & Directory Content:** Sans-serif, medium/semibold, with uniform sizing (`text-xs` for labels, `text-sm` for table/card values).

---

## 3. Page Layouts & Tabbed Navigation
Always use a two-view structure for configuration pages, managed via React state:

### Directory (List) View
*   Do **not** wrap the directory list in an outer white card. Let the cards sit flat directly on the light-grey background.
*   **Header:** Features page title, description, a search input styled with `soleria-input bg-white` and a search icon.
*   **Action button:** An Add/Register button positioned at the top right of the tab bar.

### Form (Edit / Create) View
*   Always wrapped inside a `.card-white p-6 md:p-8 bg-white border` container.
*   **Header:** Features a back arrow button (`ArrowLeft`) to easily cancel out.
*   **Structure:** Grid inputs inside rounded sub-sections.
*   **Actions:** Right-aligned "Cancel" and "Save Details" buttons.

---

## 4. Standardized Icon Set
To prevent inconsistencies, use **only** the following Lucide React icons for standard actions:

| Action | Icon name | Import Statement | Visual Style |
| :--- | :--- | :--- | :--- |
| **Create New** | `Plus` | `import { Plus } from 'lucide-react'` | Gold/Navy buttons or text links |
| **Save Details** | `Save` | `import { Save } from 'lucide-react'` | Gold solid button |
| **Edit Item** | `Edit2` | `import { Edit2 } from 'lucide-react'` | Muted slate pencil icon button, hover gold |
| **Delete / Remove** | `Trash2` | `import { Trash2 } from 'lucide-react'` | Muted slate trash icon button, hover red |
| **Search Filter** | `Search` | `import { Search } from 'lucide-react'` | Muted slate icon inside search input |
| **Go Back** | `ArrowLeft` | `import { ArrowLeft } from 'lucide-react'` | Left-aligned circular arrow button |
| **Settings / Config** | `Settings` | `import { Settings } from 'lucide-react'` | Small icon next to settings header |

---

## 5. Directory Card Standards
Every directory card (e.g., Accounts, Cities, Sub-Customers) must follow this HTML/React code structure:

```tsx
<div
  key={item.id}
  className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
  style={{ borderColor: 'var(--border-color)' }}
  onClick={handleSelect}
>
  <div>
    {/* Card Top: Code on left, Gold status/badge on right */}
    <div className="flex items-center justify-between mb-3.5">
      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
        CODE: {item.id}
      </span>
      <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider">
        {badgeText}
      </span>
    </div>

    {/* Card Middle: Initial avatar box + Name */}
    <div className="flex items-start gap-3 mb-4">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
        {initialLetter}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-slate-900 group-hover:text-amber-800 transition-colors leading-tight text-[15px] truncate">
          {item.name}
        </h4>
        <p className="text-[11px] text-slate-400 font-medium mt-0.5 uppercase tracking-wider">
          {subtitle}
        </p>
      </div>
    </div>
  </div>

  {/* Card Bottom: Standardized action icon buttons */}
  <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
    <button
      onClick={handleSelect}
      className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
      title="Edit Details"
    >
      <Edit2 size={15} />
    </button>
    <button
      onClick={handleDelete}
      className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
      title="Delete Item"
    >
      <Trash2 size={15} />
    </button>
  </div>
</div>
```
