import { useEffect, useRef, useState } from "react";
import { Temporal } from "../time/temporal";
import { formatDate, formatTime, parseDate, parseTime } from "./dates";
import { CalendarIcon } from "./icons";

/*
 * Date and time fields that always read dd/mm/yyyy and 00:00. The browser's
 * own date and time inputs follow the computer's region settings instead,
 * which on many Windows set-ups means 10/23/2026 09:00 AM.
 */

interface FieldProps<T> {
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  /** Called when focus leaves the field, after any typed value is saved. */
  onBlur?: () => void;
}

/**
 * A text box that shows `format(value)` and saves what is typed on Enter or
 * when focus leaves, if `parse` understands it. Up and down arrows step it.
 */
function TypedField<T>({
  value,
  onChange,
  format,
  parse,
  step,
  placeholder,
  size,
  className,
  autoFocus,
  disabled,
  onBlur,
  "aria-label": label,
  children,
}: FieldProps<T> & {
  format: (value: T) => string;
  parse: (text: string) => T | null;
  step: (value: T, by: number) => T;
  placeholder: string;
  size: number;
  children?: React.ReactNode;
}) {
  const shown = value === null ? "" : format(value);
  const [text, setText] = useState(shown);
  const wrapper = useRef<HTMLSpanElement>(null);
  useEffect(() => setText(shown), [shown]);

  const commit = () => {
    const parsed = parse(text);
    if (parsed !== null && format(parsed) !== shown) onChange(parsed);
    else setText(shown);
  };

  const invalid = text.trim() !== "" && text !== shown && parse(text) === null;
  return (
    <span ref={wrapper} className={`typed-field${className ? ` ${className}` : ""}`}>
      <input
        type="text"
        inputMode="numeric"
        className={invalid ? "invalid" : undefined}
        value={text}
        size={size}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape" && text !== shown) {
            e.stopPropagation();
            setText(shown);
          } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value !== null) {
            e.preventDefault();
            onChange(step(parse(text) ?? value, e.key === "ArrowUp" ? 1 : -1));
          }
        }}
        onBlur={(e) => {
          commit();
          if (!wrapper.current?.contains(e.relatedTarget as Node | null)) onBlur?.();
        }}
      />
      {children}
    </span>
  );
}

/** A day, typed as 23/10/2026 or picked from a calendar. */
export function DateInput(props: FieldProps<Temporal.PlainDate>) {
  const today = Temporal.Now.plainDateISO();
  return (
    <TypedField
      {...props}
      format={(d) => formatDate(d)}
      parse={(t) => parseDate(t, today)}
      step={(d, by) => d.add({ days: by })}
      placeholder="dd/mm/yyyy"
      size={10}
    >
      <DatePickButton value={props.value} onPick={props.onChange} disabled={props.disabled} />
    </TypedField>
  );
}

/** A time on the 24-hour clock, typed as 09:30, 930 or 9. Arrows step a quarter hour. */
export function TimeInput(props: FieldProps<Temporal.PlainTime>) {
  return (
    <TypedField
      {...props}
      format={formatTime}
      parse={parseTime}
      step={(t, by) => t.add({ minutes: 15 * by }).round({ smallestUnit: "minutes", roundingIncrement: 15, roundingMode: by > 0 ? "floor" : "ceil" })}
      placeholder="00:00"
      size={5}
    />
  );
}

/** A day and a time, side by side. */
export function DateTimeInput({
  value,
  onChange,
  className,
  disabled,
  "aria-label": label,
}: Omit<FieldProps<Temporal.PlainDateTime>, "value"> & { value: Temporal.PlainDateTime }) {
  return (
    <span className={`datetime-field${className ? ` ${className}` : ""}`}>
      <DateInput
        value={value.toPlainDate()}
        onChange={(day) => onChange(day.toPlainDateTime(value.toPlainTime()))}
        disabled={disabled}
        aria-label={label && `${label}: day`}
      />
      <TimeInput
        value={value.toPlainTime()}
        onChange={(time) => onChange(value.toPlainDate().toPlainDateTime(time))}
        disabled={disabled}
        aria-label={label && `${label}: time`}
      />
    </span>
  );
}

/**
 * A calendar button. It opens the system's month picker, whose grid reads the
 * same everywhere, from a hidden date input; the field beside it shows the result.
 */
export function DatePickButton({
  value,
  onPick,
  disabled,
  title = "Pick a day",
  className,
}: {
  value: Temporal.PlainDate | null;
  onPick: (day: Temporal.PlainDate) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <span className={`date-pick${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        title={title}
        aria-label={title}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const input = picker.current;
          if (!input) return;
          input.value = value?.toString() ?? "";
          try {
            input.showPicker();
          } catch {
            input.focus();
          }
        }}
      >
        <CalendarIcon />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => e.target.value && onPick(Temporal.PlainDate.from(e.target.value))}
      />
    </span>
  );
}
