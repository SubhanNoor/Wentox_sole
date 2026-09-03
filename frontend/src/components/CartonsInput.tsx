import { forwardRef, useEffect, useState } from 'react';
import { formatCartons } from '@/lib/utils';

/**
 * The carton quantity field, wherever cartons are typed.
 *
 * Cartons take ONE DECIMAL PLACE (migration 030, per the user 2026-09-02) — 0.5, 1.5, 10.5 are
 * all valid quantities. That needs more than `step={0.1}` and parseFloat, because a controlled
 * `<input type="number">` bound straight to a number cannot be typed into:
 *
 *     type "1"   -> 1     -> renders "1"    ok
 *     type "1."  -> 1     -> renders "1"    the decimal point is wiped as it's typed
 *     type "0"   -> 0     -> renders ""     (0 is falsy in the caller's `value || ''`)
 *
 * so "1.5" and "0.5" were both unreachable. This keeps the half-typed TEXT locally and reports
 * the parsed number upward, and only re-syncs the text when the number changes from outside
 * (a grid row loaded back into the strip, the strip reset after a commit) — never while the
 * operator is mid-decimal, since parseFloat('1.') === 1 already matches the value it reported.
 */
interface CartonsInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'step'> {
  value: number;
  onChange: (cartons: number) => void;
}

const CartonsInput = forwardRef<HTMLInputElement, CartonsInputProps>(function CartonsInput(
  { value, onChange, ...rest }, ref,
) {
  const [text, setText] = useState(() => (value ? formatCartons(value) : ''));

  useEffect(() => {
    const typed = parseFloat(text) || 0;
    if (typed !== value) setText(value ? formatCartons(value) : '');
    // Only on an external value change — `text` is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      ref={ref}
      type="number"
      step={0.1}
      value={text}
      onChange={e => {
        setText(e.target.value);
        onChange(parseFloat(e.target.value) || 0);
      }}
      {...rest}
    />
  );
});

export default CartonsInput;
